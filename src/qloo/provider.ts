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
import { resultArray, toCandidate, toEntityRef, toTasteScores } from './normalize.js';
import { PLACE_TYPE, resolveEntity, resolveTag } from './resolve.js';

/**
 * Measured on 25 October 2026: with up to four tag signals Qloo answered a ranking request in
 * between 0.2 and 13 seconds, and with five or more it took thirty to sixty seconds.
 */
export const MAX_TAG_SIGNALS = 4;
/**
 * Entity signals sent in one ranking request, counting the names the person likes, the venue that
 * fell through and any example places. Example places were measured with up to eight.
 */
export const MAX_ENTITY_SIGNALS = 8;
const EXEMPLARS_PER_TAG = 3;
/** More places than needed are asked for, because those already in the pool are dropped. */
const EXEMPLAR_FETCH = 6;
const RANK_TIMEOUT_MS = 25_000;
const LIGHT_TIMEOUT_MS = 15_000;

function translate(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof QlooError)
    return new ProviderError(error.code, error.message, error.retryable);
  return new ProviderError('QLOO_NETWORK', 'The Qloo request could not be completed.', true);
}

/** Live adapter. Every value it returns came from the Qloo API in this process. */
export interface QlooProviderOptions {
  /**
   * Send vibe tags as example places (the default). When false the tags are sent as tag signals,
   * which is how the first version worked and is kept so the two can be compared.
   */
  vibeExemplars?: boolean;
}

export class QlooTasteProvider implements TasteProvider {
  readonly descriptor: ProviderDescriptor;
  readonly #client: QlooClient | null;
  readonly #clock: () => Date;
  readonly #vibeExemplars: boolean;

  constructor(
    client: QlooClient | null,
    clock: () => Date = () => new Date(),
    options: QlooProviderOptions = {},
  ) {
    this.#client = client;
    this.#clock = clock;
    this.#vibeExemplars = options.vibeExemplars ?? true;
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

  /**
   * Places that carry a vibe, found in Qloo and kept out of the pool being ranked. Sent as entity
   * signals they give Qloo a taste to compare the pool with. A vibe tag sent on its own gave every
   * place the same score, and sent together with names it gave a score to only part of the pool.
   */
  async #findExemplars(
    tagIds: readonly string[],
    exclude: ReadonlySet<string>,
    ctx: ProviderContext,
  ): Promise<Exemplars[]> {
    const client = this.#require();
    const found: Exemplars[] = [];
    for (const tagId of tagIds) {
      try {
        const response = await client.get(
          '/v2/insights',
          { 'filter.type': PLACE_TYPE, 'filter.tags': tagId, take: EXEMPLAR_FETCH },
          ctx.traces,
          { timeoutMs: LIGHT_TIMEOUT_MS, maxAttempts: 2 },
        );
        const places = resultArray(response, 'entities')
          .map((value) => toEntityRef(value))
          .filter((ref): ref is NonNullable<typeof ref> => ref !== undefined)
          .filter((ref) => !exclude.has(ref.id))
          .slice(0, EXEMPLARS_PER_TAG)
          .map((ref) => ({ id: ref.id, name: ref.name }));
        if (places.length > 0) found.push({ tagId, places });
      } catch (error) {
        // A problem with the key or the allowance is the same for every request.
        if (
          error instanceof QlooError &&
          (error.code === 'QLOO_AUTH' || error.code === 'QLOO_BUDGET_EXHAUSTED')
        ) {
          throw translate(error);
        }
      }
    }
    return found;
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

    const names = [...new Set(request.entityIds)];
    const base: QueryParams = {
      'filter.type': PLACE_TYPE,
      'filter.results.entities': ids,
      take: ids.length,
    };

    // Qloo answers quickly with a few tag signals and slowly with many, so a request sent with
    // tags starts with at most MAX_TAG_SIGNALS of them and, if Qloo cannot answer, tries lighter
    // requests that keep the names the person likes. Each step down is reported to the person.
    const tags = [...new Set(request.tagIds)].slice(0, MAX_TAG_SIGNALS);
    interface Rung {
      entityIds: string[];
      tags: string[];
      timeoutMs: number;
      attempts: number;
      /** Set on the rung that sends example places in place of the tags. */
      exemplars?: Exemplars[];
    }
    const rungs: Rung[] = [];

    if (this.#vibeExemplars && tags.length > 0) {
      const exemplars = await this.#findExemplars(tags, new Set([...ids, ...names]), ctx);
      const entityIds = [...names, ...interleave(exemplars)].slice(0, MAX_ENTITY_SIGNALS);
      if (exemplars.length > 0 && entityIds.length > names.length) {
        const used = new Set(entityIds);
        rungs.push({
          entityIds,
          tags: [],
          timeoutMs: RANK_TIMEOUT_MS,
          attempts: 2,
          exemplars: exemplars
            .map((set) => ({ tagId: set.tagId, places: set.places.filter((p) => used.has(p.id)) }))
            .filter((set) => set.places.length > 0),
        });
      }
    }
    rungs.push({ entityIds: names, tags, timeoutMs: RANK_TIMEOUT_MS, attempts: 1 });
    if (tags.length > 2) {
      rungs.push({
        entityIds: names,
        tags: tags.slice(0, 2),
        timeoutMs: RANK_TIMEOUT_MS,
        attempts: 2,
      });
    }
    if (tags.length > 0 && names.length > 0) {
      rungs.push({ entityIds: names, tags: [], timeoutMs: LIGHT_TIMEOUT_MS, attempts: 3 });
    }

    let lastError: unknown;
    for (const [index, rung] of rungs.entries()) {
      for (const explain of [true, false]) {
        const query: QueryParams = {
          ...base,
          ...(rung.entityIds.length > 0 ? { 'signal.interests.entities': rung.entityIds } : {}),
          ...(rung.tags.length > 0 ? { 'signal.interests.tags': rung.tags } : {}),
          ...(explain ? { 'feature.explainability': true } : {}),
        };
        try {
          const response = await client.get('/v2/insights', query, ctx.traces, {
            timeoutMs: rung.timeoutMs,
            maxAttempts: rung.attempts,
          });
          const notes: string[] = [];
          if (index > 0) {
            notes.push(
              this.#stepDownNote(lastError, rungs[0]?.exemplars !== undefined, tags.length, rung),
            );
          }
          if (!explain) {
            notes.push(
              'Qloo did not accept the explainability option, so no explanation text is available for this ranking.',
            );
          }
          const exemplars = rung.exemplars;
          return {
            scores: toTasteScores(response, new Set(ids)),
            // A vibe sent as example places counts as applied, because that is how it was used.
            appliedTagIds: exemplars ? exemplars.map((set) => set.tagId) : rung.tags,
            ...(exemplars ? { exemplars } : {}),
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

  #stepDownNote(
    cause: unknown,
    triedExemplars: boolean,
    asked: number,
    rung: { tags: string[]; exemplars?: unknown },
  ): string {
    const sent = rung.tags.length;
    const prefix = triedExemplars
      ? 'Qloo could not answer with example places for the vibes. '
      : '';
    if (sent === 0) {
      return `${prefix}${
        cause instanceof QlooError && cause.code === 'QLOO_BAD_REQUEST'
          ? 'Qloo did not accept tag signals together with entity signals, so only the entity signals were applied.'
          : 'Qloo could not answer with the vibe signals, so only the names you like and the venue that fell through were applied.'
      }`;
    }
    if (triedExemplars && sent === asked) {
      return `${prefix}The vibe tags were sent as tags instead.`;
    }
    return `${prefix}Qloo could not answer with ${asked} vibe signals, so only the first ${sent} were applied.`;
  }
}

/** One vibe tag and the example places sent in its place. */
export interface Exemplars {
  tagId: string;
  places: Array<{ id: string; name: string }>;
}

/** Takes one place from each vibe in turn, so no single vibe uses up the entity signals. */
function interleave(sets: readonly Exemplars[]): string[] {
  const ids: string[] = [];
  const longest = Math.max(0, ...sets.map((set) => set.places.length));
  for (let index = 0; index < longest; index += 1) {
    for (const set of sets) {
      const place = set.places[index];
      if (place && !ids.includes(place.id)) ids.push(place.id);
    }
  }
  return ids;
}
