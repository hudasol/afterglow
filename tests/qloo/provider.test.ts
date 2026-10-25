import { describe, expect, it, vi } from 'vitest';
import { QlooClient } from '../../src/qloo/client.js';
import { toCandidate, toTasteScores, readPoint, resultArray } from '../../src/qloo/normalize.js';
import { QlooTasteProvider } from '../../src/qloo/provider.js';
import {
  jsonResponse,
  syntheticPlaceResponse,
  syntheticSearchResponse,
  syntheticTagResponse,
} from '../helpers/qloo-fixtures.js';

function providerWith(handler: (url: URL) => Response | Promise<Response>) {
  const seen: URL[] = [];
  const client = new QlooClient({
    apiKey: 'test-key-never-real',
    baseUrl: 'https://hackathon.api.qloo.com',
    timeoutMs: 1000,
    sleep: async () => {},
    fetch: (async (input: Request | URL | string) => {
      const url = new URL(String(input));
      seen.push(url);
      return handler(url);
    }) as typeof fetch,
  });
  return { provider: new QlooTasteProvider(client, () => new Date('2026-10-24T00:00:00Z')), seen };
}

describe('normalisers', () => {
  it('reads a point only from explicitly named coordinates', () => {
    expect(readPoint({ lat: 1, lon: 2 })).toEqual({ lat: 1, lon: 2 });
    expect(readPoint({ latitude: 1, longitude: 2 })).toEqual({ lat: 1, lon: 2 });
    expect(readPoint([1, 2])).toBeUndefined();
    expect(readPoint({ lat: 100, lon: 0 })).toBeUndefined();
  });

  it('accepts results as an array or as an object keyed by kind', () => {
    expect(resultArray({ results: [1, 2] }, 'entities')).toEqual([1, 2]);
    expect(resultArray({ results: { entities: [3] } }, 'entities')).toEqual([3]);
    expect(resultArray({ results: { other: [4] } }, 'entities')).toEqual([4]);
    expect(resultArray(null, 'entities')).toEqual([]);
  });

  it('records only the facts the response states and leaves the rest unknown', () => {
    const [first, second, third] = syntheticPlaceResponse.results.entities.map((e) =>
      toCandidate(e, '2026-10-24T00:00:00Z'),
    );
    expect(first?.facts.priceLevel).toMatchObject({ status: 'known', value: 2 });
    expect(
      first?.facts.priceLevel.status === 'known' && first.facts.priceLevel.provenance.source,
    ).toBe('qloo');
    expect(first?.facts.location).toMatchObject({
      status: 'known',
      value: { lat: 10.01, lon: 10 },
    });
    expect(first?.facts.openWindow.status).toBe('unknown');
    expect(first?.facts.dietary.status).toBe('unknown');
    expect(first?.taste.tagNames).toEqual(['Jazz', 'Candlelit']);
    expect(second?.facts.location.status).toBe('unknown');
    // A bare coordinate array and a zero price level are not trusted.
    expect(third?.facts.location.status).toBe('unknown');
    expect(third?.facts.priceLevel.status).toBe('unknown');
  });

  it('turns provider order into ranks and keeps affinity separate', () => {
    const scores = toTasteScores(syntheticPlaceResponse, new Set(['p-1', 'p-2', 'p-3']));
    expect(scores.map((s) => [s.candidateId, s.rank, s.affinity])).toEqual([
      ['p-1', 1, 0.82],
      ['p-2', 2, 0.31],
      ['p-3', 3, undefined],
    ]);
    expect(scores[0]?.explanation).toEqual(['Matches tag jazz']);
    expect(
      toTasteScores(syntheticPlaceResponse, new Set(['p-2'])).map((s) => s.candidateId),
    ).toEqual(['p-2']);
  });
});

describe('QlooTasteProvider', () => {
  it('reports itself unconfigured without a client and refuses calls', async () => {
    const provider = new QlooTasteProvider(null);
    expect(provider.descriptor.configured).toBe(false);
    await expect(provider.fetchPool({ city: 'X', take: 5 }, { traces: [] })).rejects.toMatchObject({
      code: 'QLOO_NOT_CONFIGURED',
    });
  });

  it('asks the person to choose when a tag name matches more than one tag', async () => {
    const { provider } = providerWith(() => jsonResponse(syntheticTagResponse));
    const result = await provider.resolve('tag', 'jazz', { traces: [] });
    expect(result.status).toBe('ambiguous');
    expect(result.candidates?.map((c) => c.id)).toEqual([
      'urn:tag:genre:media:jazz',
      'urn:tag:genre:place:jazz',
    ]);
  });

  it('scopes a category tag to the place type and resolves an exact match', async () => {
    const { provider } = providerWith(() => jsonResponse(syntheticTagResponse));
    const result = await provider.resolve('category', 'jazz', { traces: [] });
    expect(result.status).toBe('resolved');
    expect(result.selected?.id).toBe('urn:tag:genre:place:jazz');
  });

  it('never resolves a non exact entity match on its own', async () => {
    const { provider } = providerWith(() => jsonResponse(syntheticSearchResponse));
    const exact = await provider.resolve('entity', 'Test Artist', { traces: [] });
    expect(exact.status).toBe('resolved');
    expect(exact.selected?.id).toBe('e-1');
    const loose = await provider.resolve('entity', 'Test Art', { traces: [] });
    expect(loose.status).toBe('ambiguous');
    expect(loose.selected).toBeUndefined();
  });

  it('builds the pool request without any taste signal', async () => {
    const { provider, seen } = providerWith(() => jsonResponse(syntheticPlaceResponse));
    const pool = await provider.fetchPool(
      { city: 'Testville', categoryTagId: 'urn:tag:x', take: 40 },
      { traces: [] },
    );
    expect(pool.map((c) => c.id)).toEqual(['p-1', 'p-2', 'p-3']);
    const params = seen[0]?.searchParams;
    expect(params?.get('filter.location.query')).toBe('Testville');
    expect(params?.get('filter.tags')).toBe('urn:tag:x');
    expect(params?.has('signal.interests.entities')).toBe(false);
  });

  it('ranks a fixed candidate list with entity and tag signals', async () => {
    const { provider, seen } = providerWith(() => jsonResponse(syntheticPlaceResponse));
    const response = await provider.rank(
      {
        city: 'Testville',
        candidateIds: ['p-1', 'p-2', 'p-3'],
        entityIds: ['e-1'],
        tagIds: ['urn:tag:a'],
      },
      { traces: [] },
    );
    const params = seen[0]?.searchParams;
    expect(params?.get('filter.results.entities')).toBe('p-1,p-2,p-3');
    expect(params?.get('signal.interests.entities')).toBe('e-1');
    expect(params?.get('signal.interests.tags')).toBe('urn:tag:a');
    expect(response.scores).toHaveLength(3);
    expect(response.degradedNote).toBeUndefined();
  });

  it('falls back openly when Qloo rejects the tag signal and says so', async () => {
    const handler = vi.fn((url: URL) =>
      url.searchParams.has('signal.interests.tags')
        ? new Response(JSON.stringify({ message: 'bad' }), { status: 400 })
        : jsonResponse(syntheticPlaceResponse),
    );
    const { provider } = providerWith(handler);
    const response = await provider.rank(
      { city: 'T', candidateIds: ['p-1'], entityIds: ['e-1'], tagIds: ['urn:tag:a'] },
      { traces: [] },
    );
    expect(response.scores).toHaveLength(1);
    expect(response.degradedNote).toContain('only the entity signals');
  });

  it('refuses to rank without any resolved signal', async () => {
    const { provider } = providerWith(() => jsonResponse(syntheticPlaceResponse));
    await expect(
      provider.rank(
        { city: 'T', candidateIds: ['p-1'], entityIds: [], tagIds: [] },
        { traces: [] },
      ),
    ).rejects.toMatchObject({ code: 'NO_TASTE_SIGNALS' });
  });

  it('turns an authentication failure into a stable error code', async () => {
    const { provider } = providerWith(() => new Response('{}', { status: 401 }));
    await expect(provider.fetchPool({ city: 'T', take: 1 }, { traces: [] })).rejects.toMatchObject({
      code: 'QLOO_AUTH',
    });
  });
});
