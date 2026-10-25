import {
  ProviderError,
  type PoolRequest,
  type ProviderContext,
  type ProviderDescriptor,
  type RankRequest,
  type RankResponse,
  type TasteProvider,
} from '../application/ports.js';
import type { ResolutionKind, ResolvedRef, TasteResolution } from '../domain/case.js';
import { isKnown } from '../domain/evidence.js';
import type { Candidate, TasteScore } from '../domain/venue.js';
import { normaliseName } from '../domain/venue.js';
import {
  SIMULATED_CITY,
  SIMULATION_LABEL,
  catalogue,
  categoryTagIds,
  simulatedEntities,
  simulatedTags,
} from './catalogue.js';

const ENTITY_WEIGHT = 0.5;

export const SIMULATED_AFFINITY_FORMULA =
  'Simulated affinity = weight of the venue tags that match the chosen signals divided by the total ' +
  'signal weight. A chosen tag has weight 1. A tag implied by a chosen entity, or by the venue that ' +
  'fell through, has weight 0.5. ' +
  'This is a stand in for the demo and is not how Qloo calculates affinity.';

function ref(
  value: { id: string; name: string; type: string; description: string },
  extra: Partial<ResolvedRef> = {},
): ResolvedRef {
  return {
    id: value.id,
    name: value.name,
    type: value.type,
    description: value.description,
    ...extra,
  };
}

function pick<T extends { name: string }>(
  items: readonly T[],
  input: string,
): { exact: T[]; partial: T[] } {
  const wanted = normaliseName(input);
  const exact = items.filter((item) => normaliseName(item.name) === wanted);
  const partial = items.filter(
    (item) => normaliseName(item.name) !== wanted && normaliseName(item.name).includes(wanted),
  );
  return { exact, partial };
}

/**
 * The demo provider. It serves an invented catalogue for the invented city of Harbourvale and
 * labels every result as simulated. It implements the same port as the live Qloo adapter so the
 * rest of the application cannot tell the difference, and the interface always can.
 */
export class SimulatedTasteProvider implements TasteProvider {
  readonly descriptor: ProviderDescriptor = {
    mode: 'demo',
    label: SIMULATION_LABEL,
    configured: true,
    supportedCities: [SIMULATED_CITY],
  };

  async resolve(
    kind: ResolutionKind,
    input: string,
    _ctx: ProviderContext,
  ): Promise<TasteResolution> {
    if (kind === 'category') {
      const match = Object.values(categoryTagIds).find(
        (category) => normaliseName(category.name) === normaliseName(input),
      );
      return match
        ? {
            kind,
            input,
            status: 'resolved',
            selected: { id: match.id, name: match.name, type: 'simulated:category' },
            method: 'simulation',
          }
        : { kind, input, status: 'not_found' };
    }

    if (kind === 'original_venue') {
      const { exact } = pick(
        catalogue.map((venue) => venue.candidate),
        input,
      );
      const found = exact[0];
      if (!found || exact.length !== 1) return { kind, input, status: 'not_found' };
      return {
        kind,
        input,
        status: 'resolved',
        method: 'simulation',
        selected: {
          id: found.id,
          name: found.name,
          type: 'simulated:place',
          ...(isKnown(found.facts.location) ? { location: found.facts.location.value } : {}),
        },
      };
    }

    const pool = kind === 'tag' ? simulatedTags : simulatedEntities;
    const { exact, partial } = pick(pool, input);
    if (exact.length === 1 && exact[0]) {
      return { kind, input, status: 'resolved', selected: ref(exact[0]), method: 'simulation' };
    }
    const candidates = (exact.length > 0 ? exact : partial).slice(0, 5);
    if (candidates.length === 0) return { kind, input, status: 'not_found' };
    return {
      kind,
      input,
      status: 'ambiguous',
      candidates: candidates.map((item) => ref(item)),
      warnings: [
        exact.length > 0
          ? 'Several simulated entries share this name. Choose the intended one.'
          : 'No simulated entry matched exactly. Choose the intended one or skip this signal.',
      ],
    };
  }

  async fetchPool(request: PoolRequest, _ctx: ProviderContext): Promise<Candidate[]> {
    if (normaliseName(request.city) !== normaliseName(SIMULATED_CITY)) return [];
    const category = Object.entries(categoryTagIds).find(
      ([, tag]) => tag.id === request.categoryTagId,
    )?.[0];
    return catalogue
      .filter((venue) => !category || venue.category === category)
      .map((venue) => venue.candidate)
      .slice(0, request.take);
  }

  async rank(request: RankRequest, _ctx: ProviderContext): Promise<RankResponse> {
    if (request.entityIds.length === 0 && request.tagIds.length === 0) {
      throw new ProviderError(
        'NO_TASTE_SIGNALS',
        'No resolved taste signals are available to rank with.',
      );
    }
    const weights = new Map<string, number>();
    for (const id of request.tagIds) {
      const tag = simulatedTags.find((candidate) => candidate.id === id);
      if (tag)
        weights.set(normaliseName(tag.name), (weights.get(normaliseName(tag.name)) ?? 0) + 1);
    }
    for (const id of request.entityIds) {
      const entity = simulatedEntities.find((candidate) => candidate.id === id);
      // A place id is the venue that fell through. It contributes its own tags as a signal.
      const lostVenueTags = entity
        ? entity.associatedTags
        : (catalogue.find((venue) => venue.candidate.id === id)?.tags ?? []);
      for (const tag of lostVenueTags) {
        const key = normaliseName(tag);
        weights.set(key, (weights.get(key) ?? 0) + ENTITY_WEIGHT);
      }
    }
    const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
    if (total === 0) return { scores: [] };

    const wanted = new Set(request.candidateIds);
    const scored = catalogue
      .filter((venue) => wanted.has(venue.candidate.id))
      .map((venue) => {
        const matches = venue.tags.filter((tag) => weights.has(normaliseName(tag)));
        const matched = matches.reduce(
          (sum, tag) => sum + (weights.get(normaliseName(tag)) ?? 0),
          0,
        );
        return {
          id: venue.candidate.id,
          affinity: Math.min(1, matched / total),
          matches,
        };
      })
      .sort((a, b) => b.affinity - a.affinity || a.id.localeCompare(b.id, 'en'));

    const scores: TasteScore[] = scored.map((entry, index) => ({
      candidateId: entry.id,
      rank: index + 1,
      affinity: Number(entry.affinity.toFixed(4)),
      explanation:
        entry.matches.length > 0
          ? [`Simulated: shares the tags ${entry.matches.join(', ')} with the chosen signals.`]
          : ['Simulated: shares no tags with the chosen signals.'],
    }));
    return { scores };
  }
}
