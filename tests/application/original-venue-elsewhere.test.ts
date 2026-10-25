import { describe, expect, it } from 'vitest';
import type {
  PoolRequest,
  ProviderContext,
  RankRequest,
  RankResponse,
  TasteProvider,
} from '../../src/application/ports.js';
import type { ResolutionKind, TasteResolution } from '../../src/domain/case.js';
import type { Candidate } from '../../src/domain/venue.js';
import { makeAnchor, makeCandidate } from '../helpers/fixtures.js';
import { makeService } from '../helpers/service.js';

/*
 * An invented provider. A search for the venue's name finds one entry, and that entry is in a
 * different country from the city of the plan, as happened with real Qloo data on 25 October 2026.
 */
class StubLive implements TasteProvider {
  readonly descriptor = { mode: 'live' as const, label: 'Stub live provider', configured: true };
  ranked: RankRequest | undefined;
  constructor(private readonly branchInCity: boolean) {}

  async resolve(kind: ResolutionKind, input: string): Promise<TasteResolution> {
    const elsewhere = kind === 'original_venue' ? { lat: 33.42, lon: -111.94 } : undefined;
    return {
      kind,
      input,
      status: 'resolved',
      selected: { id: `ref-${input}`, name: input, ...(elsewhere ? { location: elsewhere } : {}) },
      method: 'exact',
    };
  }
  async fetchPool(_request: PoolRequest, _ctx: ProviderContext): Promise<Candidate[]> {
    const places = Array.from({ length: 6 }, (_, index) =>
      makeCandidate({
        id: `p${index}`,
        name: `Place ${index}`,
        point: { lat: 25.2 + index * 0.002, lon: 55.27 },
      }),
    );
    return this.branchInCity
      ? [
          ...places,
          makeCandidate({
            id: 'branch',
            name: 'Original Table Testville',
            point: { lat: 25.2, lon: 55.272 },
          }),
        ]
      : places;
  }
  async rank(request: RankRequest): Promise<RankResponse> {
    this.ranked = request;
    return { scores: [], appliedTagIds: [] };
  }
}

const open = (live: StubLive) =>
  makeService({ live }).service.openCase('session-a', {
    mode: 'live',
    anchor: makeAnchor({
      city: 'Testville',
      tasteEntities: [],
      tasteTags: ['jazz'],
      useOriginalVenueAsSignal: true,
      hardConstraints: [{ kind: 'max_distance_km', km: 5 }],
    }),
    disruption: { kind: 'venue_unavailable' },
  });

describe('an original venue found in another country', () => {
  it('does not rule out every place on a distance that was measured from the wrong spot', async () => {
    const live = new StubLive(false);
    const view = await open(live);
    expect(view.options.length).toBe(6);
    expect(view.options.every((o) => o.feasibility !== 'rejected')).toBe(true);
    expect(view.options.every((o) => o.feasibility === 'needs_verification')).toBe(true);
    expect(view.options[0]?.gate.verdicts.map((v) => v.outcome)).toContain('unknown');
  });

  it('leaves it out as a taste signal and says why', async () => {
    const live = new StubLive(false);
    const view = await open(live);
    expect(live.ranked?.entityIds).toEqual([]);
    expect(view.run?.appliedSignals.lostVenue).toBeUndefined();
    expect(view.run?.tasteNote).toContain('only entry Qloo has under the name Original Table');
  });

  it('uses the place of that name in the city, and does not offer it back', async () => {
    const live = new StubLive(true);
    const view = await open(live);
    expect(live.ranked?.entityIds).toEqual(['branch']);
    const branch = view.options.find((o) => o.candidate.id === 'branch');
    expect(branch?.feasibility).toBe('rejected');
    expect(branch?.rejectionReasons.join(' ')).toContain('recovering from');
    const others = view.options.filter((o) => o.candidate.id !== 'branch');
    expect(others.every((o) => o.gate.verdicts.every((v) => v.outcome !== 'fail'))).toBe(true);
  });
});
