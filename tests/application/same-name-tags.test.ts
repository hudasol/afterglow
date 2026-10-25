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

/* An invented provider that resolves a tag to two Qloo style tags with the same name. */
class StubLive implements TasteProvider {
  readonly descriptor = { mode: 'live' as const, label: 'Stub live provider', configured: true };
  ranked: RankRequest | undefined;
  async resolve(kind: ResolutionKind, input: string): Promise<TasteResolution> {
    if (kind === 'tag') {
      return {
        kind,
        input,
        status: 'resolved',
        selected: { id: 'urn:tag:ambience:romantic', name: 'Romantic' },
        alsoUsed: [{ id: 'urn:tag:setting:romantic', name: 'Romantic' }],
        method: 'same_name_group',
      };
    }
    return {
      kind,
      input,
      status: 'resolved',
      selected: { id: `ref-${input}`, name: input, location: { lat: 25.2, lon: 55.27 } },
      method: 'exact',
    };
  }
  async fetchPool(_request: PoolRequest, _ctx: ProviderContext): Promise<Candidate[]> {
    return [makeCandidate({ id: 'p1', name: 'Place One', point: { lat: 25.2001, lon: 55.27 } })];
  }
  async rank(request: RankRequest): Promise<RankResponse> {
    this.ranked = request;
    return { scores: [] };
  }
}

describe('tags that share a name', () => {
  it('sends every tag of the group to the ranking, and lists the name once', async () => {
    const live = new StubLive();
    const { service } = makeService({ live });
    const view = await service.openCase('session-a', {
      mode: 'live',
      anchor: makeAnchor({ tasteTags: ['romantic'], useOriginalVenueAsSignal: false }),
      disruption: { kind: 'venue_unavailable' },
    });
    expect(live.ranked?.tagIds).toEqual(['urn:tag:ambience:romantic', 'urn:tag:setting:romantic']);
    expect(view.run?.appliedSignals.tagNames).toEqual(['Romantic']);
    const provenance = service.getProvenance('session-a', view.id);
    const choice = provenance.choices.find((c) => c.kind === 'tag');
    expect(choice?.alsoUsed).toEqual([{ id: 'urn:tag:setting:romantic', name: 'Romantic' }]);
  });
});

describe('tags that were sent', () => {
  it('lists only the tags the provider reports as sent', async () => {
    const live = new StubLive();
    live.rank = async (request) => {
      live.ranked = request;
      return { scores: [], appliedTagIds: ['urn:tag:setting:romantic'] };
    };
    const { service } = makeService({ live });
    const view = await service.openCase('session-b', {
      mode: 'live',
      anchor: makeAnchor({ tasteTags: ['romantic'], useOriginalVenueAsSignal: false }),
      disruption: { kind: 'venue_unavailable' },
    });
    expect(view.run?.appliedSignals.tagNames).toEqual(['Romantic']);
    const none = new StubLive();
    none.rank = async () => ({ scores: [], appliedTagIds: [] });
    const second = await makeService({ live: none }).service.openCase('session-c', {
      mode: 'live',
      anchor: makeAnchor({ tasteTags: ['romantic'], useOriginalVenueAsSignal: false }),
      disruption: { kind: 'venue_unavailable' },
    });
    expect(second.run?.appliedSignals.tagNames).toEqual([]);
  });
});
