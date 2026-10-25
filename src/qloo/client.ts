import type { CallTrace } from '../domain/case.js';
import { QlooError } from './errors.js';

export type QueryValue =
  string | number | boolean | readonly (string | number)[] | undefined | null;
export type QueryParams = Record<string, QueryValue>;

export interface QlooClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxAttempts?: number;
  maxResponseBytes?: number;
  /** Calls allowed per UTC day. 0 disables the cap. */
  dailyCallCap?: number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_BYTES = 2_000_000;
const MAX_RETRY_AFTER_MS = 5_000;
const BASE_BACKOFF_MS = 300;

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function validateBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new QlooError('QLOO_NOT_CONFIGURED', 'The Qloo base URL is not a valid URL.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new QlooError('QLOO_NOT_CONFIGURED', 'The Qloo base URL must use HTTPS.');
  }
  if (url.username || url.password) {
    throw new QlooError('QLOO_NOT_CONFIGURED', 'The Qloo base URL must not contain credentials.');
  }
  return url;
}

export function serialiseQuery(query: QueryParams): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      pairs.push([name, value.join(',')]);
    } else {
      pairs.push([name, String(value)]);
    }
  }
  return pairs.sort(([a], [b]) => a.localeCompare(b, 'en'));
}

/** Shortens long identifier lists and truncates values so a trace stays small and readable. */
export function redactParams(pairs: readonly [string, string][]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of pairs) {
    const parts = value.split(',');
    result[name] =
      parts.length > 4
        ? `${parts.slice(0, 3).join(',')} and ${parts.length - 3} more (${parts.length} values)`
        : value.length > 200
          ? `${value.slice(0, 200)}...`
          : value;
  }
  return result;
}

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

export class QlooClient {
  readonly #apiKey: string;
  readonly #base: URL;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #maxBytes: number;
  readonly #dailyCap: number;
  readonly #cacheTtlMs: number;
  readonly #cacheMax: number;
  readonly #fetch: typeof fetch;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;
  readonly #now: () => number;
  readonly #cache = new Map<string, CacheEntry>();
  #usageDay = '';
  #usageCount = 0;

  constructor(options: QlooClientOptions) {
    if (!options.apiKey) {
      throw new QlooError('QLOO_NOT_CONFIGURED', 'No Qloo API key is configured.');
    }
    this.#apiKey = options.apiKey;
    this.#base = validateBaseUrl(options.baseUrl);
    this.#timeoutMs = options.timeoutMs;
    this.#maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.#maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_BYTES;
    this.#dailyCap = options.dailyCallCap ?? 0;
    this.#cacheTtlMs = options.cacheTtlMs ?? 10 * 60_000;
    this.#cacheMax = options.cacheMaxEntries ?? 200;
    this.#fetch = options.fetch ?? fetch;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#random = options.random ?? Math.random;
    this.#now = options.now ?? Date.now;
  }

  /** Calls made today (UTC) that reached the network. Cache hits are not counted. */
  get callsToday(): number {
    this.#rollUsageDay();
    return this.#usageCount;
  }

  #rollUsageDay(): void {
    const day = new Date(this.#now()).toISOString().slice(0, 10);
    if (day !== this.#usageDay) {
      this.#usageDay = day;
      this.#usageCount = 0;
    }
  }

  #spend(): void {
    this.#rollUsageDay();
    if (this.#dailyCap > 0 && this.#usageCount >= this.#dailyCap) {
      throw new QlooError(
        'QLOO_BUDGET_EXHAUSTED',
        'The daily Qloo call allowance for this deployment has been used. Try again tomorrow.',
      );
    }
    this.#usageCount += 1;
  }

  async get(
    endpoint: string,
    query: QueryParams,
    traces?: CallTrace[],
    options: { bypassCache?: boolean; timeoutMs?: number; maxAttempts?: number } = {},
  ): Promise<unknown> {
    const pairs = serialiseQuery(query);
    const params = redactParams(pairs);
    const cacheKey = `${endpoint}?${pairs.map(([k, v]) => `${k}=${v}`).join('&')}`;

    const cached = options.bypassCache ? undefined : this.#cache.get(cacheKey);
    if (cached && cached.expiresAt > this.#now()) {
      traces?.push({
        endpoint,
        params,
        attempts: 0,
        durationMs: 0,
        cache: 'hit',
        resultCount: countResults(cached.value),
      });
      return cached.value;
    }

    const url = new URL(endpoint.replace(/^\//u, ''), `${this.#base.href.replace(/\/?$/u, '/')}`);
    for (const [name, value] of pairs) url.searchParams.append(name, value);

    const started = this.#now();
    let attempts = 0;
    let lastError: QlooError | undefined;
    let lastStatus: number | undefined;
    const maxAttempts = options.maxAttempts ?? this.#maxAttempts;

    while (attempts < maxAttempts) {
      attempts += 1;
      this.#spend();
      try {
        const { status, body, retryAfterMs } = await this.#once(
          url,
          options.timeoutMs ?? this.#timeoutMs,
        );
        lastStatus = status;
        if (status >= 200 && status < 300) {
          const value = parseJson(body);
          this.#remember(cacheKey, value);
          traces?.push({
            endpoint,
            params,
            status,
            attempts,
            durationMs: this.#now() - started,
            cache: 'miss',
            resultCount: countResults(value),
          });
          return value;
        }
        const error = errorForStatus(status, body);
        if (!error.retryable || attempts >= maxAttempts) throw error;
        lastError = error;
        await this.#sleep(this.#backoff(attempts, retryAfterMs));
      } catch (caught) {
        const error = caught instanceof QlooError ? caught : toQlooError(caught);
        if (!error.retryable || attempts >= maxAttempts) {
          traces?.push({
            endpoint,
            params,
            ...(lastStatus !== undefined || error.status !== undefined
              ? { status: error.status ?? (lastStatus as number) }
              : {}),
            attempts,
            durationMs: this.#now() - started,
            cache: 'miss',
            error: `${error.code}: ${error.message}`.slice(0, 300),
          });
          throw error;
        }
        lastError = error;
        await this.#sleep(this.#backoff(attempts));
      }
    }
    throw lastError ?? new QlooError('QLOO_UPSTREAM', 'The Qloo request did not complete.');
  }

  #backoff(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
    const exponential = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    return Math.round(exponential * (0.5 + this.#random() / 2));
  }

  #remember(key: string, value: unknown): void {
    this.#cache.set(key, { expiresAt: this.#now() + this.#cacheTtlMs, value });
    while (this.#cache.size > this.#cacheMax) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
  }

  async #once(
    url: URL,
    timeoutMs: number,
  ): Promise<{ status: number; body: string; retryAfterMs?: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.#fetch(url, {
        method: 'GET',
        headers: { 'X-Api-Key': this.#apiKey, Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'error',
      });
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > this.#maxBytes) {
        throw new QlooError(
          'QLOO_BAD_RESPONSE',
          'The Qloo response was larger than the allowed size.',
        );
      }
      const body = await response.text();
      if (body.length > this.#maxBytes) {
        throw new QlooError(
          'QLOO_BAD_RESPONSE',
          'The Qloo response was larger than the allowed size.',
        );
      }
      const retryAfter = Number(response.headers.get('retry-after'));
      return {
        status: response.status,
        body,
        ...(Number.isFinite(retryAfter) && retryAfter > 0
          ? { retryAfterMs: retryAfter * 1000 }
          : {}),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new QlooError('QLOO_BAD_RESPONSE', 'Qloo returned a response that was not valid JSON.');
  }
}

function errorForStatus(status: number, body: string): QlooError {
  const detail = safeDetail(body);
  if (status === 401 || status === 403) {
    return new QlooError('QLOO_AUTH', 'Qloo rejected the credential. Check the configured key.', {
      status,
    });
  }
  if (status === 404)
    return new QlooError('QLOO_NOT_FOUND', `Qloo returned not found.${detail}`, { status });
  if (status === 429) {
    return new QlooError('QLOO_RATE_LIMIT', 'Qloo is rate limiting this key.', {
      status,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new QlooError('QLOO_UPSTREAM', `Qloo returned status ${status}.`, {
      status,
      retryable: true,
    });
  }
  return new QlooError(
    'QLOO_BAD_REQUEST',
    `Qloo rejected the request (status ${status}).${detail}`,
    { status },
  );
}

function safeDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const message = record['message'] ?? record['error'] ?? record['detail'];
      if (typeof message === 'string' && message) return ` ${message.slice(0, 160)}`;
    }
  } catch {
    // The body was not JSON. It is not echoed back.
  }
  return '';
}

function toQlooError(caught: unknown): QlooError {
  if (caught instanceof Error && caught.name === 'AbortError') {
    return new QlooError('QLOO_TIMEOUT', 'The Qloo request timed out.', { retryable: true });
  }
  return new QlooError('QLOO_NETWORK', 'The Qloo request could not be completed.', {
    retryable: true,
  });
}

export function countResults(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const results = (value as Record<string, unknown>)['results'];
  if (Array.isArray(results)) return results.length;
  if (results && typeof results === 'object') {
    for (const inner of Object.values(results as Record<string, unknown>)) {
      if (Array.isArray(inner)) return inner.length;
    }
  }
  return undefined;
}
