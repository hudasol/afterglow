import { describe, expect, it } from 'vitest';
import type { CallTrace } from '../../src/domain/case.js';
import { isKnown } from '../../src/domain/evidence.js';
import { deriveEffectivePlan } from '../../src/domain/plan.js';
import type { Candidate } from '../../src/domain/venue.js';
import { OverpassClient } from '../../src/openstreetmap/overpass.js';
import { OsmPlaceFactsProvider } from '../../src/openstreetmap/provider.js';
import { makeAnchor, makeCandidate } from '../helpers/fixtures.js';

/* Invented venues and invented tags. Nothing here describes a real place. */

// 2026-11-07 is a Saturday. The plan starts at 19:30 local time and lasts two hours.
const NOW = new Date('2026-10-25T09:00:00Z');

function place(id: string, name: string, lat: number, lon: number): Candidate {
  return {
    ...makeCandidate({ id, name, point: { lat, lon } }),
    source: 'qloo',
  };
}

function setup(elements: unknown[] | Error) {
  const requests: string[] = [];
  const client = new OverpassClient({
    url: 'https://overpass.test/api/interpreter',
    timeoutMs: 1000,
    userAgent: 'afterglow-test',
    fetchImpl: (async (_url: string, init: RequestInit) => {
      requests.push(String(init.body));
      if (elements instanceof Error) throw elements;
      return new Response(JSON.stringify({ elements }), { status: 200 });
    }) as typeof fetch,
  });
  return { provider: new OsmPlaceFactsProvider(client, () => NOW), requests };
}

const ctx = () => ({ traces: [] as CallTrace[] });
const planWith = (
  ...constraints: Parameters<typeof makeAnchor>[0] extends infer T
    ? T extends { hardConstraints?: infer H }
      ? NonNullable<H>
      : never
    : never
) => deriveEffectivePlan(makeAnchor({ hardConstraints: constraints }), [], []);

describe('OsmPlaceFactsProvider', () => {
  it('does not contact OpenStreetMap when the plan depends on none of its facts', async () => {
    const { provider, requests } = setup([]);
    const pool = [place('a', 'Fixture Bistro', 25.2, 55.27)];
    const result = await provider.enrich(
      pool,
      planWith({ kind: 'max_price_level', level: 2 }),
      ctx(),
    );
    expect(requests).toHaveLength(0);
    expect(result).toMatchObject({ looked: 0, matched: 0, filled: 0 });
    expect(result.candidates).toEqual(pool);
  });

  it('fills opening hours from the matched place and records where they came from', async () => {
    const { provider, requests } = setup([
      {
        type: 'node',
        id: 42,
        lat: 25.2001,
        lon: 55.2701,
        tags: { name: 'Fixture Bistro', opening_hours: 'Mo-Su 12:00-23:30' },
      },
    ]);
    const result = await provider.enrich(
      [place('a', 'Fixture Bistro', 25.2, 55.27)],
      planWith({ kind: 'open_at_plan_time' }),
      ctx(),
    );
    expect(requests).toHaveLength(1);
    const fact = result.candidates[0]?.facts.openWindow;
    expect(fact && isKnown(fact) && fact.value).toEqual({ opensAt: 720, closesAt: 1410 });
    expect(fact && isKnown(fact) && fact.provenance).toMatchObject({
      source: 'openstreetmap',
      label: 'OpenStreetMap opening hours',
      detail: 'opening_hours=Mo-Su 12:00-23:30 on node/42',
      retrievedAt: NOW.toISOString(),
    });
    expect(result).toMatchObject({ looked: 1, matched: 1, filled: 1 });
  });

  it('leaves a fact unknown, with a reason, when no place matches', async () => {
    const { provider } = setup([
      { type: 'node', id: 1, lat: 25.2, lon: 55.27, tags: { name: 'Somewhere Else' } },
    ]);
    const result = await provider.enrich(
      [place('a', 'Fixture Bistro', 25.2, 55.27)],
      planWith({ kind: 'open_at_plan_time' }),
      ctx(),
    );
    const fact = result.candidates[0]?.facts.openWindow;
    expect(fact?.status).toBe('unknown');
    expect(fact?.status === 'unknown' && fact.reason).toMatch(/no matching OpenStreetMap place/u);
    expect(result).toMatchObject({ looked: 1, matched: 0, filled: 0 });
  });

  it('leaves a fact unknown when the matched place has no readable tag', async () => {
    const { provider } = setup([
      { type: 'node', id: 1, lat: 25.2, lon: 55.27, tags: { name: 'Fixture Bistro' } },
    ]);
    const result = await provider.enrich(
      [place('a', 'Fixture Bistro', 25.2, 55.27)],
      planWith({ kind: 'step_free_access' }),
      ctx(),
    );
    const fact = result.candidates[0]?.facts.stepFree;
    expect(fact?.status === 'unknown' && fact.reason).toMatch(/no readable tag/u);
    expect(result).toMatchObject({ matched: 1, filled: 0 });
  });

  it('only fills facts the plan depends on', async () => {
    const { provider } = setup([
      {
        type: 'node',
        id: 1,
        lat: 25.2,
        lon: 55.27,
        tags: { name: 'Fixture Bistro', wheelchair: 'yes', opening_hours: 'Mo-Su 10:00-23:00' },
      },
    ]);
    const result = await provider.enrich(
      [place('a', 'Fixture Bistro', 25.2, 55.27)],
      planWith({ kind: 'step_free_access' }),
      ctx(),
    );
    const facts = result.candidates[0]?.facts;
    expect(facts && isKnown(facts.stepFree)).toBe(true);
    expect(facts?.openWindow.status).toBe('unknown');
  });

  it('never overwrites a fact that is already known', async () => {
    const { provider, requests } = setup([
      {
        type: 'node',
        id: 1,
        lat: 25.2,
        lon: 55.27,
        tags: { name: 'Fixture Bistro', wheelchair: 'no' },
      },
    ]);
    const already = {
      ...place('a', 'Fixture Bistro', 25.2, 55.27),
      facts: {
        ...place('a', 'Fixture Bistro', 25.2, 55.27).facts,
        stepFree: {
          status: 'known' as const,
          value: true,
          provenance: { source: 'qloo' as const, label: 'Qloo' },
        },
      },
    };
    const result = await provider.enrich([already], planWith({ kind: 'step_free_access' }), ctx());
    expect(requests).toHaveLength(0);
    expect(result.candidates[0]).toEqual(already);
  });

  it('never sends simulated places or places without a known location', async () => {
    const { provider, requests } = setup([]);
    const simulated = makeCandidate({ id: 's', point: { lat: 1, lon: 1 } });
    const unlocated = { ...makeCandidate({ id: 'u' }), source: 'qloo' as const };
    const result = await provider.enrich(
      [simulated, unlocated],
      planWith({ kind: 'open_at_plan_time' }),
      ctx(),
    );
    expect(requests).toHaveLength(0);
    expect(result.looked).toBe(0);
  });

  it('degrades to unchanged candidates with a plain note when the service fails', async () => {
    const { provider } = setup(new TypeError('socket hang up'));
    const pool = [place('a', 'Fixture Bistro', 25.2, 55.27)];
    const result = await provider.enrich(pool, planWith({ kind: 'open_at_plan_time' }), ctx());
    expect(result.candidates).toEqual(pool);
    expect(result.note).toMatch(/unavailable \(OSM_NETWORK\)/u);
    expect(result.note).not.toMatch(/socket/u);
  });

  it('asks about at most forty places and says so', async () => {
    const { provider, requests } = setup([]);
    const pool = Array.from({ length: 45 }, (_, index) =>
      place(`p${index}`, `Fixture ${index}`, 25.2 + index * 0.001, 55.27),
    );
    const result = await provider.enrich(pool, planWith({ kind: 'open_at_plan_time' }), ctx());
    expect(result.looked).toBe(40);
    expect(result.note).toMatch(/first 40 places/u);
    const query = new URLSearchParams(requests[0]).get('data') ?? '';
    expect(query.match(/around:/gu) ?? []).toHaveLength(80);
  });

  it('reads the hours of the weekday the plan falls on', async () => {
    const { provider } = setup([
      {
        type: 'node',
        id: 1,
        lat: 25.2,
        lon: 55.27,
        tags: { name: 'Fixture Bistro', opening_hours: 'Mo-Fr 12:00-23:00; Sa-Su off' },
      },
    ]);
    const result = await provider.enrich(
      [place('a', 'Fixture Bistro', 25.2, 55.27)],
      planWith({ kind: 'open_at_plan_time' }),
      ctx(),
    );
    const fact = result.candidates[0]?.facts.openWindow;
    expect(fact && isKnown(fact) && fact.value.closedAllDay).toBe(true);
  });
});
