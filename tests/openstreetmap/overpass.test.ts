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

  describe('with more than one endpoint', () => {
    const urls = ['https://first.test/api/interpreter', 'https://second.test/api/interpreter'];
    const build = (respond: (url: string) => Response) => {
      const asked: string[] = [];
      const instance = new OverpassClient({
        url: urls,
        timeoutMs: 1000,
        userAgent: 'afterglow-test',
        fetchImpl: (async (url: string) => {
          asked.push(url);
          return respond(url);
        }) as typeof fetch,
      });
      return { instance, asked };
    };

    it('moves to the next endpoint when the first is overloaded, and records which one answered', async () => {
      const { instance, asked } = build((url) =>
        url.startsWith('https://first') ? json('bad gateway', 502) : json(body([])),
      );
      const traces: CallTrace[] = [];
      await instance.nearby([point], 150, traces);
      expect(asked).toEqual(urls);
      expect(traces[0]).toMatchObject({
        attempts: 2,
        status: 200,
        params: { host: 'second.test' },
      });
    });

    it('does not move on when the query itself is refused', async () => {
      const { instance, asked } = build(() => json('bad query', 400));
      await expect(instance.nearby([point], 150, [])).rejects.toMatchObject({
        code: 'OSM_REJECTED',
      });
      expect(asked).toEqual([urls[0]]);
    });

    it('reports the last failure when every endpoint fails', async () => {
      const { instance, asked } = build((url) =>
        url.startsWith('https://first') ? json('x', 429) : json('x', 503),
      );
      const traces: CallTrace[] = [];
      await expect(instance.nearby([point], 150, traces)).rejects.toMatchObject({
        code: 'OSM_UPSTREAM',
      });
      expect(asked).toEqual(urls);
      expect(traces[0]).toMatchObject({ attempts: 2, params: { host: 'second.test' } });
    });
  });

  describe('pausing after repeated failures', () => {
    const other = { lat: 25.3, lon: 55.4 };

    function pausing(statusFor: () => number) {
      let clock = 0;
      const calls: number[] = [];
      const instance = new OverpassClient({
        url: 'https://overpass.test/api/interpreter',
        timeoutMs: 1000,
        userAgent: 'afterglow-test',
        pauseAfterFailures: 2,
        pauseMs: 60_000,
        now: () => clock,
        fetchImpl: (async () => {
          calls.push(clock);
          const status = statusFor();
          return status === 200 ? json(body([])) : json('x', status);
        }) as typeof fetch,
      });
      return { instance, calls, advance: (ms: number) => (clock += ms) };
    }

    it('stops asking after two failed lookups in a row, and says so without waiting', async () => {
      const { instance, calls } = pausing(() => 502);
      await expect(instance.nearby([point], 150, [])).rejects.toMatchObject({
        code: 'OSM_UPSTREAM',
      });
      await expect(instance.nearby([other], 150, [])).rejects.toMatchObject({
        code: 'OSM_UPSTREAM',
      });
      const traces: CallTrace[] = [];
      await expect(instance.nearby([point], 150, traces)).rejects.toMatchObject({
        code: 'OSM_PAUSED',
      });
      expect(calls).toHaveLength(2);
      expect(traces[0]).toMatchObject({ attempts: 0, durationMs: 0 });
      expect(traces[0]?.error).toContain('OSM_PAUSED');
    });

    it('asks again once the pause is over, and a success clears the count', async () => {
      let status = 502;
      const { instance, calls, advance } = pausing(() => status);
      await expect(instance.nearby([point], 150, [])).rejects.toBeInstanceOf(OverpassError);
      await expect(instance.nearby([other], 150, [])).rejects.toBeInstanceOf(OverpassError);
      advance(60_001);
      status = 200;
      await instance.nearby([point], 150, []);
      expect(calls).toHaveLength(3);
      status = 502;
      await expect(instance.nearby([other], 150, [])).rejects.toMatchObject({
        code: 'OSM_UPSTREAM',
      });
      await expect(instance.nearby([{ lat: 25.31, lon: 55.41 }], 150, [])).rejects.toMatchObject({
        code: 'OSM_UPSTREAM',
      });
    });

    it('does not count a refused query as a service failure', async () => {
      const { instance, calls } = pausing(() => 400);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await expect(instance.nearby([point], 150, [])).rejects.toMatchObject({
          code: 'OSM_REJECTED',
        });
      }
      expect(calls).toHaveLength(3);
    });

    it('still answers from the cache while paused', async () => {
      let status = 200;
      const { instance } = pausing(() => status);
      await instance.nearby([point], 150, []);
      status = 502;
      await expect(instance.nearby([other], 150, [])).rejects.toBeInstanceOf(OverpassError);
      await expect(instance.nearby([{ lat: 25.31, lon: 55.41 }], 150, [])).rejects.toBeInstanceOf(
        OverpassError,
      );
      const traces: CallTrace[] = [];
      const answer = await instance.nearby([point], 150, traces);
      expect(answer.has(pointKey(point))).toBe(true);
      expect(traces[0]).toMatchObject({ cache: 'hit' });
    });
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
