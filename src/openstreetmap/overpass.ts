import { z } from 'zod';
import type { CallTrace } from '../domain/case.js';
import { distanceKm, type GeoPoint } from '../domain/geo.js';

/*
 * A small client for the public Overpass API, which serves OpenStreetMap data. It sends one request
 * per search for every place that is not cached, describes only public coordinates of venues, and
 * keeps its answers for a while so that repeated searches do not hit the shared service again.
 */

export type OverpassErrorCode =
  'OSM_NETWORK' | 'OSM_TIMEOUT' | 'OSM_RATE_LIMIT' | 'OSM_UPSTREAM' | 'OSM_BAD_RESPONSE';

export class OverpassError extends Error {
  readonly code: OverpassErrorCode;
  constructor(code: OverpassErrorCode, message: string) {
    super(message);
    this.name = 'OverpassError';
    this.code = code;
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
  url: string;
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

export class OverpassClient {
  readonly #options: OverpassOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #ttl: number;
  readonly #max: number;
  readonly #cache = new Map<string, CacheEntry>();

  constructor(options: OverpassOptions) {
    this.#options = options;
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
        endpoint: 'overpass /api/interpreter',
        params,
        attempts: 0,
        durationMs: 0,
        cache: 'hit',
        resultCount: [...answer.values()].reduce((sum, list) => sum + list.length, 0),
      });
      return answer;
    }

    const started = this.#now();
    const fail = (code: OverpassErrorCode, message: string, status?: number): never => {
      traces.push({
        endpoint: 'overpass /api/interpreter',
        params: { ...params, uncached: String(missing.length) },
        ...(status !== undefined ? { status } : {}),
        attempts: 1,
        durationMs: this.#now() - started,
        cache: 'miss',
        error: `${code}: ${message}`.slice(0, 300),
      });
      throw new OverpassError(code, message);
    };

    let response: Response;
    try {
      response = await this.#fetch(this.#options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': this.#options.userAgent,
        },
        body: new URLSearchParams({ data: buildQuery(missing, radiusM) }),
        signal: AbortSignal.timeout(this.#options.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return fail(
        timedOut ? 'OSM_TIMEOUT' : 'OSM_NETWORK',
        timedOut ? 'The OpenStreetMap request timed out.' : 'The OpenStreetMap request failed.',
      );
    }
    if (response.status === 429)
      return fail('OSM_RATE_LIMIT', 'OpenStreetMap asked us to slow down.', 429);
    if (!response.ok) {
      return fail(
        'OSM_UPSTREAM',
        `OpenStreetMap answered with status ${response.status}.`,
        response.status,
      );
    }

    let body: z.infer<typeof responseSchema>;
    try {
      body = responseSchema.parse(await response.json());
    } catch {
      return fail(
        'OSM_BAD_RESPONSE',
        'The OpenStreetMap answer was not in the expected form.',
        response.status,
      );
    }
    // Overpass reports some failures as a normal answer with a remark and a partial list.
    if (body.remark && /runtime error|out of memory|timed out/iu.test(body.remark)) {
      return fail('OSM_UPSTREAM', 'OpenStreetMap could not finish the query.', response.status);
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
      endpoint: 'overpass /api/interpreter',
      params: { ...params, uncached: String(missing.length) },
      status: response.status,
      attempts: 1,
      durationMs: this.#now() - started,
      cache: 'miss',
      resultCount: elements.length,
    });
    return answer;
  }
}
