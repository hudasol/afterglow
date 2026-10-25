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
      return await resolveTag(
        client,
        kind,
        input,
        ctx.traces,
        kind === 'category' ? PLACE_TYPE : undefined,
      );
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
        const candidate = toCandidate(value, retrievedAt);
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
    };
    interface Variant {
      query: QueryParams;
      note?: string;
    }
    const full: QueryParams = {
      ...base,
      ...(request.entityIds.length > 0 ? { 'signal.interests.entities': request.entityIds } : {}),
      ...(request.tagIds.length > 0 ? { 'signal.interests.tags': request.tagIds } : {}),
      'feature.explainability': true,
    };
    const variants: Variant[] = [{ query: full }];
    if (request.entityIds.length > 0 && request.tagIds.length > 0) {
      variants.push({
        query: { ...full, 'signal.interests.tags': undefined },
        note: 'Qloo did not accept tag signals together with entity signals, so only the entity signals were applied.',
      });
    }
    variants.push({
      query: { ...full, 'feature.explainability': undefined },
      note: 'Qloo did not accept the explainability option, so no explanation text is available for this ranking.',
    });

    let lastError: unknown;
    for (const variant of variants) {
      try {
        const response = await client.get('/v2/insights', variant.query, ctx.traces);
        const scores = toTasteScores(response, new Set(ids));
        return { scores, ...(variant.note ? { degradedNote: variant.note } : {}) };
      } catch (error) {
        lastError = error;
        if (!(error instanceof QlooError) || error.code !== 'QLOO_BAD_REQUEST') break;
      }
    }
    throw translate(lastError);
  }
}
