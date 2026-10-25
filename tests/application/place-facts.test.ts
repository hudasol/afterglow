import { describe, expect, it } from 'vitest';
import {
  type PoolRequest,
  type ProviderContext,
  type RankResponse,
  type TasteProvider,
} from '../../src/application/ports.js';
import type { ResolutionKind, TasteResolution } from '../../src/domain/case.js';
import type { Candidate } from '../../src/domain/venue.js';
import { OverpassClient } from '../../src/openstreetmap/overpass.js';
import { OsmPlaceFactsProvider } from '../../src/openstreetmap/provider.js';
import { makeAnchor, makeCandidate } from '../helpers/fixtures.js';
import { makeService } from '../helpers/service.js';

/*
 * A stand in for the live provider and a stand in for OpenStreetMap, both invented for these
 * tests. They exercise how the application uses a second source of facts. They say nothing about
 * what the real services return.
 */

const SESSION = 'session-a';

function qlooPlace(id: string, name: string, lat: number): Candidate {
  return { ...makeCandidate({ id, name, point: { lat, lon: 55.27 } }), source: 'qloo' };
}

class StubLive implements TasteProvider {
  readonly descriptor = { mode: 'live' as const, label: 'Stub live provider', configured: true };
  lastRequest: PoolRequest | undefined;
  constructor(readonly pool: Candidate[]) {}
  async resolve(kind: ResolutionKind, input: string): Promise<TasteResolution> {
    return {
      kind,
      input,
      status: 'resolved',
      selected: { id: `ref-${input}`, name: input, location: { lat: 25.2, lon: 55.27 } },
      method: 'exact',
    };
  }
  async fetchPool(request: PoolRequest, _ctx: ProviderContext): Promise<Candidate[]> {
    this.lastRequest = request;
    return this.pool;
  }
  async rank(): Promise<RankResponse> {
    return { scores: [] };
  }
}

function osmReturning(elements: unknown[] | Error) {
  let requests = 0;
  const client = new OverpassClient({
    url: 'https://overpass.test/api/interpreter',
    timeoutMs: 1000,
    userAgent: 'afterglow-test',
    fetchImpl: (async () => {
      requests += 1;
      if (elements instanceof Error) throw elements;
      return new Response(JSON.stringify({ elements }), { status: 200 });
    }) as typeof fetch,
  });
  return { provider: new OsmPlaceFactsProvider(client), requests: () => requests };
}

const pool = [
  qlooPlace('q1', 'Late Bistro', 25.2001),
  qlooPlace('q2', 'Early Cafe', 25.205),
  qlooPlace('q3', 'Mystery Grill', 25.21),
];
const tagged = (id: number, name: string, lat: number, hours: string) => ({
  type: 'node',
  id,
  lat,
  lon: 55.27,
  tags: { name, opening_hours: hours },
});

const openAtPlanTime = () =>
  makeAnchor({
    hardConstraints: [{ kind: 'open_at_plan_time' }],
    useOriginalVenueAsSignal: false,
  });
const disruption = { kind: 'venue_unavailable' } as const;

describe('the plan context given to the taste provider', () => {
  it('carries the local day and time of the plan and its dietary requirements', async () => {
    const live = new StubLive(pool);
    const { service } = makeService({ live });
    await service.openCase(SESSION, {
      mode: 'live',
      anchor: makeAnchor({
        hardConstraints: [{ kind: 'dietary', requirement: 'vegetarian' }],
        useOriginalVenueAsSignal: false,
      }),
      disruption,
    });
    // 7 November 2026 is a Saturday, and the plan starts at 19:30 local time.
    expect(live.lastRequest?.facts).toEqual({
      weekday: 6,
      startMinute: 19 * 60 + 30,
      dietaryNeeded: ['vegetarian'],
    });
  });
});

describe('live search with a second source of place facts', () => {
  it('lets OpenStreetMap hours decide the gate, and says where they came from', async () => {
    const osm = osmReturning([
      tagged(1, 'Late Bistro', 25.2001, 'Mo-Su 12:00-23:00'),
      tagged(2, 'Early Cafe', 25.205, 'Mo-Su 07:00-17:00'),
    ]);
    const { service } = makeService({ live: new StubLive(pool), placeFacts: osm.provider });
    const view = await service.openCase(SESSION, {
      mode: 'live',
      anchor: openAtPlanTime(),
      disruption,
    });

    const byName = (name: string) => view.options.find((o) => o.candidate.name === name);
    expect(byName('Late Bistro')?.feasibility).toBe('feasible');
    expect(byName('Late Bistro')?.gate.verdicts[0]).toMatchObject({
      outcome: 'pass',
      basis: 'openstreetmap',
      evidence: 'opening_hours=Mo-Su 12:00-23:00 on node/1',
    });
    expect(byName('Early Cafe')?.feasibility).toBe('rejected');
    expect(byName('Early Cafe')?.rejectionReasons[0]).toMatch(/does not cover the plan/u);
    expect(byName('Mystery Grill')?.feasibility).toBe('needs_verification');

    expect(view.run?.placeFacts).toEqual({
      source: 'openstreetmap',
      looked: 3,
      matched: 2,
      filled: 2,
    });
  });

  it('shows the lookup in the trace and in the evidence, without any place name', async () => {
    const osm = osmReturning([tagged(1, 'Late Bistro', 25.2001, 'Mo-Su 12:00-23:00')]);
    const { service } = makeService({ live: new StubLive(pool), placeFacts: osm.provider });
    const view = await service.openCase(SESSION, {
      mode: 'live',
      anchor: openAtPlanTime(),
      disruption,
    });

    const trace = service.getTrace(SESSION, view.id);
    const acts = trace.cycles[0]?.steps.filter((step) => step.phase === 'act') ?? [];
    expect(acts.some((step) => /Asked OpenStreetMap about 3 places/u.test(step.text))).toBe(true);

    const provenance = service.getProvenance(SESSION, view.id);
    expect(provenance.sentToPlaceFacts).toMatchObject({ places: 3 });
    const overpass = provenance.calls.latestSearch.filter((call) =>
      call.endpoint.startsWith('overpass'),
    );
    expect(overpass).toHaveLength(1);
    expect(JSON.stringify(provenance.calls)).not.toMatch(/Late Bistro|25\.2001/u);
  });

  it('keeps every fact unknown, and says so, when OpenStreetMap cannot be reached', async () => {
    const osm = osmReturning(new TypeError('offline'));
    const { service } = makeService({ live: new StubLive(pool), placeFacts: osm.provider });
    const view = await service.openCase(SESSION, {
      mode: 'live',
      anchor: openAtPlanTime(),
      disruption,
    });
    expect(view.options.every((o) => o.feasibility === 'needs_verification')).toBe(true);
    expect(view.run?.placeFacts?.note).toMatch(/unavailable \(OSM_NETWORK\)/u);
    expect(view.run?.placeFacts).toMatchObject({ looked: 3, filled: 0 });
  });

  it('does not look anything up when the plan has no requirement that needs it', async () => {
    const osm = osmReturning([]);
    const { service } = makeService({ live: new StubLive(pool), placeFacts: osm.provider });
    const view = await service.openCase(SESSION, {
      mode: 'live',
      anchor: makeAnchor({ useOriginalVenueAsSignal: false }),
      disruption,
    });
    expect(osm.requests()).toBe(0);
    expect(view.run?.placeFacts).toBeNull();
  });

  it('never contacts OpenStreetMap for the labelled demo', async () => {
    const osm = osmReturning([]);
    const { service } = makeService({ placeFacts: osm.provider });
    await service.openCase(SESSION, {
      mode: 'demo',
      anchor: makeAnchor({
        city: 'Harbourvale',
        hardConstraints: [{ kind: 'open_at_plan_time' }],
      }),
      disruption,
    });
    expect(osm.requests()).toBe(0);
  });

  it('lets the person override what the map says', async () => {
    const osm = osmReturning([tagged(2, 'Early Cafe', 25.205, 'Mo-Su 07:00-17:00')]);
    const { service } = makeService({ live: new StubLive(pool), placeFacts: osm.provider });
    const view = await service.openCase(SESSION, {
      mode: 'live',
      anchor: openAtPlanTime(),
      disruption,
    });
    // The map says closed at 19:30. The person phoned and was told it is open late tonight.
    const early = view.options.find((o) => o.candidate.name === 'Early Cafe');
    expect(early?.feasibility).toBe('rejected');
    // A rejected option leaves the active list, so the person reviews it from the removed list
    // and attests before the next search. The attestation must win over the map.
    const after = await service.attestFact(SESSION, view.id, {
      candidateId: early?.candidate.id ?? '',
      constraintKey: 'open_at_plan_time',
      satisfied: true,
    });
    const reopened = after.options.find((o) => o.candidate.name === 'Early Cafe');
    expect(reopened?.gate.verdicts[0]).toMatchObject({ outcome: 'pass', basis: 'user_attested' });
  });
});
