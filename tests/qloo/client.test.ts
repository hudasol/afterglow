import { describe, expect, it, vi } from 'vitest';
import type { CallTrace } from '../../src/domain/case.js';
import { QlooClient, redactParams, serialiseQuery } from '../../src/qloo/client.js';
import { QlooError } from '../../src/qloo/errors.js';
import { jsonResponse } from '../helpers/qloo-fixtures.js';

function makeClient(
  fetchImpl: typeof fetch,
  extra: Partial<ConstructorParameters<typeof QlooClient>[0]> = {},
) {
  return new QlooClient({
    apiKey: 'test-key-never-real',
    baseUrl: 'https://hackathon.api.qloo.com',
    timeoutMs: 1000,
    fetch: fetchImpl,
    sleep: async () => {},
    random: () => 0.5,
    ...extra,
  });
}

describe('QlooClient', () => {
  it('refuses to start without a key or with an insecure base URL', () => {
    expect(() => new QlooClient({ apiKey: '', baseUrl: 'https://x.test', timeoutMs: 1 })).toThrow(
      QlooError,
    );
    expect(
      () => new QlooClient({ apiKey: 'k', baseUrl: 'http://example.com', timeoutMs: 1 }),
    ).toThrow(/HTTPS/u);
    expect(
      () => new QlooClient({ apiKey: 'k', baseUrl: 'http://127.0.0.1:9', timeoutMs: 1 }),
    ).not.toThrow();
  });

  it('sends the key as a header, joins arrays, sorts parameters and never puts the key in the URL', async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const client = makeClient(async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return jsonResponse({ results: [] });
    });
    await client.get('/v2/insights', {
      'filter.type': 'urn:entity:place',
      ids: ['a', 'b'],
      take: 3,
      skip: undefined,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://hackathon.api.qloo.com/v2/insights?filter.type=urn%3Aentity%3Aplace&ids=a%2Cb&take=3',
    );
    expect(calls[0]?.headers.get('x-api-key')).toBe('test-key-never-real');
    expect(calls[0]?.url).not.toContain('test-key-never-real');
  });

  it('records a redacted trace and serves repeats from the cache', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ results: [{ entity_id: 'a' }] }));
    const client = makeClient(fetchSpy as unknown as typeof fetch);
    const traces: CallTrace[] = [];
    await client.get('/search', { query: 'jazz' }, traces);
    await client.get('/search', { query: 'jazz' }, traces);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(traces.map((t) => t.cache)).toEqual(['miss', 'hit']);
    expect(traces[0]?.resultCount).toBe(1);
    expect(JSON.stringify(traces)).not.toContain('test-key-never-real');
  });

  it('retries rate limits and server errors with bounded attempts, then succeeds', async () => {
    const statuses = [429, 503, 200];
    const sleep = vi.fn(async () => {});
    const fetchSpy = vi.fn(async () => {
      const status = statuses.shift() ?? 200;
      return status === 200
        ? jsonResponse({ results: [] })
        : new Response('{}', { status, headers: status === 429 ? { 'retry-after': '1' } : {} });
    });
    const client = makeClient(fetchSpy as unknown as typeof fetch, { sleep });
    const traces: CallTrace[] = [];
    await client.get('/search', { query: 'x' }, traces);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(traces[0]?.attempts).toBe(3);
  });

  it('gives up after the attempt limit with a structured error', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 500 }));
    const client = makeClient(fetchSpy as unknown as typeof fetch);
    const traces: CallTrace[] = [];
    await expect(client.get('/search', { query: 'x' }, traces)).rejects.toMatchObject({
      code: 'QLOO_UPSTREAM',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(traces[0]?.error).toContain('QLOO_UPSTREAM');
  });

  it('does not retry authentication or bad request errors', async () => {
    const auth = vi.fn(async () => new Response('{}', { status: 401 }));
    await expect(
      makeClient(auth as unknown as typeof fetch).get('/search', {}),
    ).rejects.toMatchObject({
      code: 'QLOO_AUTH',
    });
    expect(auth).toHaveBeenCalledTimes(1);

    const bad = vi.fn(
      async () => new Response(JSON.stringify({ message: 'bad param' }), { status: 400 }),
    );
    await expect(
      makeClient(bad as unknown as typeof fetch).get('/search', {}),
    ).rejects.toMatchObject({
      code: 'QLOO_BAD_REQUEST',
    });
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('maps a network failure and an abort to retryable errors', async () => {
    const network = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(
      makeClient(network as unknown as typeof fetch, { maxAttempts: 2 }).get('/x', {}),
    ).rejects.toMatchObject({
      code: 'QLOO_NETWORK',
    });
    expect(network).toHaveBeenCalledTimes(2);

    const abort = vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    await expect(
      makeClient(abort as unknown as typeof fetch, { maxAttempts: 1 }).get('/x', {}),
    ).rejects.toMatchObject({
      code: 'QLOO_TIMEOUT',
    });
  });

  it('rejects an oversized or malformed response', async () => {
    const big = makeClient(async () => jsonResponse({ pad: 'x'.repeat(5000) }), {
      maxResponseBytes: 1000,
    });
    await expect(big.get('/x', {})).rejects.toMatchObject({ code: 'QLOO_BAD_RESPONSE' });
    const notJson = makeClient(async () => new Response('<html>', { status: 200 }));
    await expect(notJson.get('/x', {})).rejects.toMatchObject({ code: 'QLOO_BAD_RESPONSE' });
  });

  it('enforces the daily call cap and resets on a new UTC day', async () => {
    let now = Date.parse('2026-10-24T10:00:00Z');
    const client = makeClient(async () => jsonResponse({ results: [] }), {
      dailyCallCap: 2,
      now: () => now,
    });
    await client.get('/a', {});
    await client.get('/b', {});
    await expect(client.get('/c', {})).rejects.toMatchObject({ code: 'QLOO_BUDGET_EXHAUSTED' });
    now = Date.parse('2026-10-25T00:00:01Z');
    await expect(client.get('/c', {})).resolves.toBeDefined();
    expect(client.callsToday).toBe(1);
  });
});

describe('query helpers', () => {
  it('serialises booleans and drops empty values', () => {
    expect(serialiseQuery({ a: true, b: [], c: undefined, d: null, e: 'x' })).toEqual([
      ['a', 'true'],
      ['e', 'x'],
    ]);
  });

  it('shortens long identifier lists in traces', () => {
    const redacted = redactParams([['filter.results.entities', 'a,b,c,d,e,f']]);
    expect(redacted['filter.results.entities']).toBe('a,b,c and 3 more (6 values)');
  });
});
