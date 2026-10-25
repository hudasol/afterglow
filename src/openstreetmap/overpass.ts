import { z } from 'zod';
import type { CallTrace } from '../domain/case.js';
import { distanceKm, type GeoPoint } from '../domain/geo.js';

/*
 * A small client for the public Overpass API, which serves OpenStreetMap data. It sends one request
 * per search for every place that is not cached, describes only public coordinates of venues, and
 * keeps its answers for a while so that repeated searches do not hit the shared service again.
 */

export type OverpassErrorCode =
  | 'OSM_NETWORK'
  | 'OSM_TIMEOUT'
  | 'OSM_RATE_LIMIT'
  | 'OSM_UPSTREAM'
  | 'OSM_REJECTED'
  | 'OSM_BAD_RESPONSE';

export class OverpassError extends Error {
  readonly code: OverpassErrorCode;
  readonly status: number | undefined;
  /** True when another endpoint may well answer. A rejected query will not fare better elsewhere. */
  readonly retryable: boolean;
  constructor(code: OverpassErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'OverpassError';
    this.code = code;
    this.status = status;
    this.retryable = code !== 'OSM_REJECTED';
  }
}

const elementSchema = z.object({
  type: z.enum(['node', 'way', 'relation']),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});
const responseSchema = z.object({
  elements: z.array(elementSchema),
  remark: z.string().optional(),
});

export interface OsmElement {
  ref: string;
  position: GeoPoint;
  tags: Record<string, string>;
}

export interface OverpassOptions {
  /** One endpoint, or several tried in order when the earlier ones fail. */
  url: string | readonly string[];
  /** How long to wait for each endpoint. */
  timeoutMs: number;
  userAgent: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  maxCachedPoints?: number;
}

const AMENITIES =
  'restaurant|bar|pub|cafe|fast_food|food_court|biergarten|ice_cream|nightclub|theatre|cinema|arts_centre|music_venue';
const TOURISM = 'museum|gallery|attraction|artwork';
const MAX_ELEMENTS = 800;

export function pointKey(point: GeoPoint): string {
  return `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
}

export function buildQuery(points: readonly GeoPoint[], radiusM: number): string {
  const around = (point: GeoPoint) =>
    `(around:${radiusM},${point.lat.toFixed(5)},${point.lon.toFixed(5)})`;
  const clauses = points.flatMap((point) => [
    `nwr${around(point)}["name"]["amenity"~"^(${AMENITIES})$"];`,
    `nwr${around(point)}["name"]["tourism"~"^(${TOURISM})$"];`,
  ]);
  return `[out:json][timeout:25];\n(\n${clauses.join('\n')}\n);\nout tags center ${MAX_ELEMENTS};`;
}

interface CacheEntry {
  at: number;
  elements: OsmElement[];
}

interface Answer {
  elements: OsmElement[];
  status: number;
}

const ENDPOINT = 'overpass /api/interpreter';

export class OverpassClient {
  readonly #urls: readonly string[];
  readonly #options: OverpassOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #ttl: number;
  readonly #max: number;
  readonly #cache = new Map<string, CacheEntry>();

  constructor(options: OverpassOptions) {
    this.#options = options;
    this.#urls = typeof options.url === 'string' ? [options.url] : [...options.url];
    if (this.#urls.length === 0) throw new Error('At least one Overpass endpoint is needed.');
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#ttl = options.cacheTtlMs ?? 6 * 3_600_000;
    this.#max = options.maxCachedPoints ?? 2000;
  }

  /** Named venues of interest within radiusM of each point, keyed by pointKey. */
  async nearby(
    points: readonly GeoPoint[],
    radiusM: number,
    traces: CallTrace[],
  ): Promise<Map<string, OsmElement[]>> {
    const answer = new Map<string, OsmElement[]>();
    const missing: GeoPoint[] = [];
    for (const point of points) {
      const key = pointKey(point);
      const hit = this.#cache.get(key);
      if (hit && this.#now() - hit.at < this.#ttl) answer.set(key, hit.elements);
      else missing.push(point);
    }
    const params = { points: String(points.length), radius_m: String(radiusM) };
    if (missing.length === 0) {
      traces.push({
        endpoint: ENDPOINT,
        params,
        attempts: 0,
        durationMs: 0,
        cache: 'hit',
        resultCount: [...answer.values()].reduce((sum, list) => sum + list.length, 0),
      });
      return answer;
    }

    const started = this.#now();
    const query = buildQuery(missing, radiusM);
    let attempts = 0;
    let failure: OverpassError | null = null;
    let served: { host: string; result: Answer } | null = null;
    for (const url of this.#urls) {
      attempts += 1;
      try {
        served = { host: new URL(url).host, result: await this.#ask(url, query) };
        break;
      } catch (error) {
        if (!(error instanceof OverpassError)) throw error;
        failure = error;
        if (!error.retryable) break;
      }
    }
    const attemptParams = {
      ...params,
      uncached: String(missing.length),
      host: served?.host ?? hostOf(this.#urls[Math.min(attempts, this.#urls.length) - 1]),
    };

    if (!served) {
      const error =
        failure ?? new OverpassError('OSM_NETWORK', 'The OpenStreetMap request failed.');
      traces.push({
        endpoint: ENDPOINT,
        params: attemptParams,
        ...(error.status !== undefined ? { status: error.status } : {}),
        attempts,
        durationMs: this.#now() - started,
        cache: 'miss',
        error: `${error.code}: ${error.message}`.slice(0, 300),
      });
      throw error;
    }

    const { elements, status } = served.result;
    const radiusKm = radiusM / 1000;
    for (const point of missing) {
      const near = elements.filter((element) => distanceKm(point, element.position) <= radiusKm);
      const key = pointKey(point);
      answer.set(key, near);
      this.#cache.set(key, { at: this.#now(), elements: near });
    }
    while (this.#cache.size > this.#max) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }

    traces.push({
      endpoint: ENDPOINT,
      params: attemptParams,
      status,
      attempts,
      durationMs: this.#now() - started,
      cache: 'miss',
      resultCount: elements.length,
    });
    return answer;
  }

  async #ask(url: string, query: string): Promise<Answer> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': this.#options.userAgent,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(this.#options.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw timedOut
        ? new OverpassError('OSM_TIMEOUT', 'The OpenStreetMap request timed out.')
        : new OverpassError('OSM_NETWORK', 'The OpenStreetMap request failed.');
    }
    const status = response.status;
    if (status === 429) {
      throw new OverpassError('OSM_RATE_LIMIT', 'OpenStreetMap asked us to slow down.', status);
    }
    if (status >= 500) {
      throw new OverpassError(
        'OSM_UPSTREAM',
        `OpenStreetMap answered with status ${status}.`,
        status,
      );
    }
    if (!response.ok) {
      throw new OverpassError(
        'OSM_REJECTED',
        `OpenStreetMap refused the query (status ${status}).`,
        status,
      );
    }

    let body: z.infer<typeof responseSchema>;
    try {
      body = responseSchema.parse(await response.json());
    } catch {
      throw new OverpassError(
        'OSM_BAD_RESPONSE',
        'The OpenStreetMap answer was not in the expected form.',
        status,
      );
    }
    // Overpass reports some failures as a normal answer with a remark and a partial list.
    if (body.remark && /runtime error|out of memory|timed out/iu.test(body.remark)) {
      throw new OverpassError('OSM_UPSTREAM', 'OpenStreetMap could not finish the query.', status);
    }
    const elements: OsmElement[] = body.elements.flatMap((element) => {
      const position =
        element.center ??
        (element.lat !== undefined && element.lon !== undefined
          ? { lat: element.lat, lon: element.lon }
          : null);
      return position && element.tags
        ? [{ ref: `${element.type}/${element.id}`, position, tags: element.tags }]
        : [];
    });
    return { elements, status };
  }
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host : 'unknown';
  } catch {
    return 'unknown';
  }
}
