import { ProviderError } from '../application/ports.js';
import type {
  PoolRequest,
  ProviderContext,
  ProviderDescriptor,
  RankRequest,
  RankResponse,
  TasteProvider,
} from '../application/ports.js';
import type { ResolutionKind, TasteResolution } from '../domain/case.js';
import type { Candidate } from '../domain/venue.js';
import type { QlooClient, QueryParams } from './client.js';
import { QlooError } from './errors.js';
import { resultArray, toCandidate, toTasteScores } from './normalize.js';
import { PLACE_TYPE, resolveEntity, resolveTag } from './resolve.js';

/**
 * Measured on 25 October 2026: with up to four tag signals Qloo answered a ranking request in
 * between 0.2 and 13 seconds, and with five or more it took thirty to sixty seconds.
 */
export const MAX_TAG_SIGNALS = 4;
const RANK_TIMEOUT_MS = 25_000;
const LIGHT_TIMEOUT_MS = 15_000;

function translate(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof QlooError)
    return new ProviderError(error.code, error.message, error.retryable);
  return new ProviderError('QLOO_NETWORK', 'The Qloo request could not be completed.', true);
}

/** Live adapter. Every value it returns came from the Qloo API in this process. */
export class QlooTasteProvider implements TasteProvider {
  readonly descriptor: ProviderDescriptor;
  readonly #client: QlooClient | null;
  readonly #clock: () => Date;

  constructor(client: QlooClient | null, clock: () => Date = () => new Date()) {
    this.#client = client;
    this.#clock = clock;
    this.descriptor = { mode: 'live', label: 'Qloo hackathon API', configured: client !== null };
  }

  #require(): QlooClient {
    if (!this.#client) {
      throw new ProviderError(
        'QLOO_NOT_CONFIGURED',
        'No Qloo API key is configured on this server, so live mode is unavailable.',
      );
    }
    return this.#client;
  }

  async resolve(
    kind: ResolutionKind,
    input: string,
    ctx: ProviderContext,
  ): Promise<TasteResolution> {
    const client = this.#require();
    try {
      if (kind === 'entity' || kind === 'original_venue') {
        return await resolveEntity(client, kind, input, ctx.city ?? '', ctx.traces);
      }
      // Both kinds of tag are used to rank places, so only tags that apply to places are wanted.
      return await resolveTag(client, kind, input, ctx.traces, PLACE_TYPE);
    } catch (error) {
      throw translate(error);
    }
  }

  async fetchPool(request: PoolRequest, ctx: ProviderContext): Promise<Candidate[]> {
    const client = this.#require();
    const query: QueryParams = {
      'filter.type': PLACE_TYPE,
      'filter.location.query': request.city,
      ...(request.categoryTagId ? { 'filter.tags': request.categoryTagId } : {}),
      take: request.take,
    };
    try {
      const response = await client.get('/v2/insights', query, ctx.traces);
      const retrievedAt = this.#clock().toISOString();
      const seen = new Set<string>();
      const pool: Candidate[] = [];
      for (const value of resultArray(response, 'entities')) {
        const candidate = toCandidate(value, retrievedAt, request.facts);
        if (candidate && !seen.has(candidate.id)) {
          seen.add(candidate.id);
          pool.push(candidate);
        }
      }
      return pool;
    } catch (error) {
      throw translate(error);
    }
  }

  async rank(request: RankRequest, ctx: ProviderContext): Promise<RankResponse> {
    const client = this.#require();
    const ids = [...new Set(request.candidateIds)];
    if (ids.length === 0) return { scores: [] };
    if (request.entityIds.length === 0 && request.tagIds.length === 0) {
      throw new ProviderError(
        'NO_TASTE_SIGNALS',
        'No resolved taste signals are available to rank with.',
      );
    }

    const base: QueryParams = {
      'filter.type': PLACE_TYPE,
      'filter.results.entities': ids,
      take: ids.length,
      ...(request.entityIds.length > 0 ? { 'signal.interests.entities': request.entityIds } : {}),
    };

    // Qloo answers quickly with a few tag signals and slowly with many, so the request starts
    // with at most MAX_TAG_SIGNALS of them and, if Qloo cannot answer, tries lighter requests
    // that keep the names the person likes. Each step down is reported to the person.
    const tags = [...new Set(request.tagIds)].slice(0, MAX_TAG_SIGNALS);
    interface Rung {
      tags: string[];
      timeoutMs: number;
      attempts: number;
    }
    const rungs: Rung[] = [{ tags, timeoutMs: RANK_TIMEOUT_MS, attempts: 1 }];
    if (tags.length > 2) {
      rungs.push({ tags: tags.slice(0, 2), timeoutMs: RANK_TIMEOUT_MS, attempts: 2 });
    }
    if (tags.length > 0 && request.entityIds.length > 0) {
      rungs.push({ tags: [], timeoutMs: LIGHT_TIMEOUT_MS, attempts: 3 });
    }

    let lastError: unknown;
    for (const [index, rung] of rungs.entries()) {
      for (const explain of [true, false]) {
        const query: QueryParams = {
          ...base,
          ...(rung.tags.length > 0 ? { 'signal.interests.tags': rung.tags } : {}),
          ...(explain ? { 'feature.explainability': true } : {}),
        };
        try {
          const response = await client.get('/v2/insights', query, ctx.traces, {
            timeoutMs: rung.timeoutMs,
            maxAttempts: rung.attempts,
          });
          const notes: string[] = [];
          if (index > 0) notes.push(this.#stepDownNote(lastError, tags.length, rung.tags.length));
          if (!explain) {
            notes.push(
              'Qloo did not accept the explainability option, so no explanation text is available for this ranking.',
            );
          }
          return {
            scores: toTasteScores(response, new Set(ids)),
            appliedTagIds: rung.tags,
            ...(notes.length > 0 ? { degradedNote: notes.join(' ') } : {}),
          };
        } catch (error) {
          lastError = error;
          if (error instanceof QlooError && error.code === 'QLOO_BAD_REQUEST' && explain) continue;
          // A problem with the key or the allowance is the same for every lighter request.
          if (
            !(error instanceof QlooError) ||
            error.code === 'QLOO_AUTH' ||
            error.code === 'QLOO_BUDGET_EXHAUSTED' ||
            error.code === 'QLOO_NOT_CONFIGURED'
          ) {
            throw translate(error);
          }
          break;
        }
      }
    }
    throw translate(lastError);
  }

  #stepDownNote(cause: unknown, asked: number, sent: number): string {
    if (sent === 0) {
      return cause instanceof QlooError && cause.code === 'QLOO_BAD_REQUEST'
        ? 'Qloo did not accept tag signals together with entity signals, so only the entity signals were applied.'
        : 'Qloo could not answer with the vibe signals, so only the names you like and the venue that fell through were applied.';
    }
    return `Qloo could not answer with ${asked} vibe signals, so only the first ${sent} were applied.`;
  }
}
