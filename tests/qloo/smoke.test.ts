import { describe, expect, it } from 'vitest';
import { QlooClient } from '../../src/qloo/client.js';
import { runSmoke } from '../../src/qloo/smoke.js';
import { jsonResponse } from '../helpers/qloo-fixtures.js';

/** A synthetic Qloo stand in. It exercises the experiment's logic only and proves nothing about the real API. */
function fakeQloo(options: {
  poolSize: number;
  sensitive: boolean;
  rejectTags?: boolean;
}): typeof fetch {
  const places = Array.from({ length: options.poolSize }, (_, i) => ({
    entity_id: `p${i}`,
    name: `Fixture Place ${i}`,
    location: { lat: 10 + i / 100, lon: 10 },
    properties: { price_level: (i % 4) + 1, address: `${i} Test Road` },
  }));
  return (async (input: Request | URL | string) => {
    const url = new URL(String(input));
    const p = url.searchParams;
    if (url.pathname === '/search') {
      const query = p.get('query') ?? '';
      return jsonResponse({
        results: [{ entity_id: `e-${query}`, name: query, types: ['urn:entity:artist'] }],
      });
    }
    if (url.pathname === '/v2/tags') {
      const q = p.get('filter.query') ?? '';
      return jsonResponse({
        results: {
          tags: [
            {
              id: `urn:tag:${q}`,
              name: q,
              type: 'urn:tag:x',
              parents: [{ type: 'urn:entity:place' }],
            },
          ],
        },
      });
    }
    if (url.pathname === '/v2/insights') {
      if (p.has('signal.interests.tags') && options.rejectTags)
        return new Response('{}', { status: 400 });
      const wanted = p.get('filter.results.entities');
      if (!wanted) return jsonResponse({ results: { entities: places } });
      const reverse = p.get('signal.interests.entities') === 'e-Metallica';
      const ordered = options.sensitive && reverse ? [...places].reverse() : places;
      return jsonResponse({
        results: {
          entities: ordered.map((place, i) => ({
            ...place,
            query: { affinity: 1 - i / 100, explainability: ['x'] },
          })),
        },
      });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

function client(fetchImpl: typeof fetch) {
  return new QlooClient({
    apiKey: 'test-key-never-real',
    baseUrl: 'https://hackathon.api.qloo.com',
    timeoutMs: 1000,
    sleep: async () => {},
    fetch: fetchImpl,
  });
}

const options = {
  city: 'Testville',
  seedA: 'Miles Davis',
  seedB: 'Metallica',
  category: 'restaurant',
  poolSize: 20,
};

describe('qloo smoke experiment', () => {
  it('returns go when the pool is usable and the signal changes the ranking', async () => {
    const report = await runSmoke(
      client(fakeQloo({ poolSize: 20, sensitive: true })),
      options,
      new Date('2026-10-24T00:00:00Z'),
    );
    expect(report.verdict).toBe('go');
    expect(report.observed.poolSize).toBe(20);
    expect(report.observed.withLocation).toBe(20);
    expect(report.observed.withAffinity).toBe(20);
    expect(report.observed.signalSensitivity?.kendallTau).toBeLessThan(0);
    expect(JSON.stringify(report)).not.toContain('test-key-never-real');
  });

  it('checks that a place works as a taste signal and records the property shape without values', async () => {
    const report = await runSmoke(
      client(fakeQloo({ poolSize: 20, sensitive: true })),
      options,
      new Date('2026-10-24T00:00:00Z'),
    );
    expect(report.checks.find((c) => c.name === 'a place as a taste signal')?.ok).toBe(true);
    expect(report.observed.propertyShape).toEqual({ address: 'string', price_level: 'number' });
    expect(JSON.stringify(report.observed.propertyShape)).not.toContain('Test Road');
  });

  it('returns no go when different signals give the same ranking', async () => {
    const report = await runSmoke(
      client(fakeQloo({ poolSize: 20, sensitive: false })),
      options,
      new Date(),
    );
    expect(report.verdict).toBe('no_go');
    expect(report.reasons.join(' ')).toContain('nearly identical');
  });

  it('returns no go when the city yields too few places', async () => {
    const report = await runSmoke(
      client(fakeQloo({ poolSize: 4, sensitive: true })),
      options,
      new Date(),
    );
    expect(report.verdict).toBe('no_go');
    expect(report.checks.find((c) => c.name === 'place pool for the city')?.ok).toBe(false);
  });

  it('is conditional when tags are rejected but the core calls work', async () => {
    const report = await runSmoke(
      client(fakeQloo({ poolSize: 20, sensitive: true, rejectTags: true })),
      options,
      new Date(),
    );
    expect(report.verdict).toBe('conditional');
    expect(report.checks.find((c) => c.name === 'entity and tag signals together')?.ok).toBe(false);
  });

  it('returns no go on an authentication failure', async () => {
    const report = await runSmoke(
      client((async () => new Response('{}', { status: 401 })) as typeof fetch),
      options,
      new Date(),
    );
    expect(report.verdict).toBe('no_go');
    expect(report.checks[0]?.detail).toContain('QLOO_AUTH');
  });
});
