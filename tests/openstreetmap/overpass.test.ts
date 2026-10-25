import { describe, expect, it } from 'vitest';
import type { CallTrace } from '../../src/domain/case.js';
import {
  buildQuery,
  OverpassClient,
  OverpassError,
  pointKey,
} from '../../src/openstreetmap/overpass.js';

/* The responses are invented to exercise the client. They say nothing about the live service. */

const point = { lat: 25.2048, lon: 55.2708 };
const body = (elements: unknown[]) => JSON.stringify({ elements });
const json = (text: string, status = 200) =>
  new Response(text, { status, headers: { 'content-type': 'application/json' } });

function client(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
  extra: { now?: () => number; ttl?: number } = {},
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const instance = new OverpassClient({
    url: 'https://overpass.test/api/interpreter',
    timeoutMs: 1000,
    userAgent: 'afterglow-test',
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }) as typeof fetch,
    ...(extra.now ? { now: extra.now } : {}),
    ...(extra.ttl !== undefined ? { cacheTtlMs: extra.ttl } : {}),
  });
  return { instance, calls };
}

describe('buildQuery', () => {
  it('asks only for named venues around each point and never includes a name or text from a person', () => {
    const query = buildQuery([point], 150);
    expect(query).toContain('(around:150,25.20480,55.27080)');
    expect(query).toContain('["name"]["amenity"');
    expect(query).toMatch(/out tags center \d+;/u);
  });
});

describe('OverpassClient', () => {
  it('posts one request, sends a user agent, and groups elements by point', async () => {
    const { instance, calls } = client(() =>
      json(
        body([
          { type: 'node', id: 7, lat: 25.2049, lon: 55.2709, tags: { name: 'Fixture Bistro' } },
          { type: 'way', id: 9, center: { lat: 40, lon: 40 }, tags: { name: 'Far Away' } },
          { type: 'node', id: 11, lat: 25.2049, lon: 55.2709 },
        ]),
      ),
    );
    const traces: CallTrace[] = [];
    const answer = await instance.nearby([point], 150, traces);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe('POST');
    expect((calls[0]?.init.headers as Record<string, string>)['user-agent']).toBe('afterglow-test');
    const near = answer.get(pointKey(point)) ?? [];
    expect(near.map((element) => element.ref)).toEqual(['node/7']);
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ cache: 'miss', status: 200, resultCount: 2 });
    expect(JSON.stringify(traces)).not.toContain('Fixture Bistro');
  });

  it('answers a repeated request from its cache until the entry expires', async () => {
    let clock = 0;
    const { instance, calls } = client(() => json(body([])), { now: () => clock, ttl: 1000 });
    const traces: CallTrace[] = [];
    await instance.nearby([point], 150, traces);
    await instance.nearby([point], 150, traces);
    expect(calls).toHaveLength(1);
    expect(traces[1]).toMatchObject({ cache: 'hit', attempts: 0 });
    clock = 2000;
    await instance.nearby([point], 150, traces);
    expect(calls).toHaveLength(2);
  });

  it.each([
    [429, 'OSM_RATE_LIMIT'],
    [504, 'OSM_UPSTREAM'],
  ])('turns status %i into %s and records the failed call', async (status, code) => {
    const { instance } = client(() => json('busy', status));
    const traces: CallTrace[] = [];
    await expect(instance.nearby([point], 150, traces)).rejects.toMatchObject({ code });
    expect(traces[0]?.error).toContain(code);
  });

  it('turns an unreadable body into a bad response error', async () => {
    const { instance } = client(() => json('<html>not json</html>'));
    await expect(instance.nearby([point], 150, [])).rejects.toBeInstanceOf(OverpassError);
    await expect(instance.nearby([point], 150, [])).rejects.toMatchObject({
      code: 'OSM_BAD_RESPONSE',
    });
  });

  it('refuses a partial answer that carries a runtime error remark', async () => {
    const { instance } = client(() =>
      json(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' })),
    );
    await expect(instance.nearby([point], 150, [])).rejects.toMatchObject({ code: 'OSM_UPSTREAM' });
  });

  it('reports a network failure without leaking the cause', async () => {
    const { instance } = client(() => {
      throw new TypeError('connect ECONNREFUSED 10.0.0.1:443');
    });
    const traces: CallTrace[] = [];
    await expect(instance.nearby([point], 150, traces)).rejects.toMatchObject({
      code: 'OSM_NETWORK',
    });
    expect(JSON.stringify(traces)).not.toContain('10.0.0.1');
  });

  it('does not cache a failed lookup', async () => {
    let fail = true;
    const { instance, calls } = client(() => (fail ? json('x', 503) : json(body([]))));
    await expect(instance.nearby([point], 150, [])).rejects.toBeInstanceOf(OverpassError);
    fail = false;
    await instance.nearby([point], 150, []);
    expect(calls).toHaveLength(2);
  });
});
