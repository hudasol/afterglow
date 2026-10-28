import { distanceKm, type GeoPoint } from './geo.js';
import { isKnown, type Fact } from './evidence.js';
import type { Candidate, TasteScore } from './venue.js';

/** Weights of the app composite. They are shown in the interface next to every score. */
export const SCORE_WEIGHTS = { taste: 0.75, practical: 0.25 } as const;
const DISTANCE_CAP_KM = 10;

export const SCORE_FORMULA =
  'Recovery score = 0.75 x taste score + 0.25 x closeness score. ' +
  'Taste score is the Qloo affinity rescaled across the places that passed the gate, so the lowest scored place is 0 and the highest is 1, ' +
  'or a rank based value when Qloo gave no affinity. ' +
  'Closeness score is 1 minus distance to the original venue over 10 km. ' +
  'When a component is unavailable the remaining weights are renormalised.';

/** Affinity values closer together than this carry no information about order. */
const FLAT_AFFINITY_RANGE = 1e-6;

export function distanceToOriginal(
  candidate: Candidate,
  originalLocation: Fact<GeoPoint>,
): number | null {
  if (!isKnown(candidate.facts.location) || !isKnown(originalLocation)) return null;
  return distanceKm(candidate.facts.location.value, originalLocation.value);
}

export function closenessScore(km: number | null): number | null {
  if (km === null) return null;
  return Math.max(0, 1 - Math.min(km, DISTANCE_CAP_KM) / DISTANCE_CAP_KM);
}

export interface TasteBasis {
  value: number;
  basis: 'affinity' | 'rank';
}

/**
 * Taste value in 0..1 for every scored candidate in one ranking response.
 *
 * Qloo's affinity has no calibrated scale, and across one pool its values often lie within a
 * range of 0.1. Blended unchanged with a closeness score that spans 0 to 1, the 0.75 weight on
 * taste would be a weight in name only, because distance would settle the order. Affinity is
 * therefore rescaled across the places that can be offered (`within`, or every scored place when
 * it is not given), so the weights describe how much each part may move the order. When every
 * affinity is the same the taste value is 0.5 for all, which leaves the order to closeness.
 */
export function tasteValues(
  scores: readonly TasteScore[],
  within?: ReadonlySet<string>,
): Map<string, TasteBasis> {
  const result = new Map<string, TasteBasis>();
  const inScope = within ? scores.filter((score) => within.has(score.candidateId)) : scores;
  const affinities = inScope
    .map((score) => score.affinity)
    .filter((value): value is number => value !== undefined && value >= 0 && value <= 1);
  const low = affinities.length > 0 ? Math.min(...affinities) : 0;
  const range = (affinities.length > 0 ? Math.max(...affinities) : 0) - low;
  const count = inScope.length;
  const position = new Map(
    [...inScope].sort((a, b) => a.rank - b.rank).map((score, index) => [score.candidateId, index]),
  );
  for (const score of scores) {
    if (score.affinity !== undefined && score.affinity >= 0 && score.affinity <= 1) {
      const value = range < FLAT_AFFINITY_RANGE ? 0.5 : (score.affinity - low) / range;
      result.set(score.candidateId, { value, basis: 'affinity' });
    } else {
      const place = position.get(score.candidateId);
      const value = count <= 1 || place === undefined ? 1 : 1 - place / (count - 1);
      result.set(score.candidateId, { value, basis: 'rank' });
    }
  }
  return result;
}

/**
 * What a ranking response says about how far taste could decide the order. It reports two things the
 * person would otherwise not see: that the provider scored only part of the pool, and that it gave
 * every place it scored the same affinity, in which case the order within a group follows distance.
 */
export function describeTasteCoverage(
  scores: readonly TasteScore[],
  poolSize: number,
): string | null {
  const notes: string[] = [];
  const affinities = scores
    .map((score) => score.affinity)
    .filter((value): value is number => value !== undefined);
  const flat =
    affinities.length >= 2 &&
    affinities.length === scores.length &&
    Math.max(...affinities) - Math.min(...affinities) < 1e-9;
  if (flat) {
    notes.push(
      'Qloo gave every place it scored the same taste score for these signals, so within each group of places the order follows distance.',
    );
  }
  if (scores.length > 0 && scores.length < poolSize) {
    notes.push(
      `Qloo scored ${scores.length} of ${poolSize} places. Within each group of places, those it did not score come last.`,
    );
  }
  return notes.length > 0 ? notes.join(' ') : null;
}

export interface ScoreBreakdown {
  composite: number;
  tasteComponent: number | null;
  tasteBasis: TasteBasis['basis'] | null;
  closenessComponent: number | null;
  distanceKm: number | null;
}

export function compositeScore(
  taste: TasteBasis | undefined,
  distance: number | null,
): ScoreBreakdown {
  const closeness = closenessScore(distance);
  const parts: { weight: number; value: number }[] = [];
  if (taste) parts.push({ weight: SCORE_WEIGHTS.taste, value: taste.value });
  if (closeness !== null) parts.push({ weight: SCORE_WEIGHTS.practical, value: closeness });
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const composite =
    totalWeight === 0
      ? 0
      : parts.reduce((sum, part) => sum + part.weight * part.value, 0) / totalWeight;
  return {
    composite,
    tasteComponent: taste ? taste.value : null,
    tasteBasis: taste ? taste.basis : null,
    closenessComponent: closeness,
    distanceKm: distance,
  };
}

export interface BaselineKey {
  distanceKm: number | null;
  priceLevel: number | null;
  name: string;
}

/**
 * The Taste Off ordering. It uses only facts that do not come from taste data: nearest to the
 * original venue first, then lower price, then name. Candidates with unknown values sort after
 * those with known values, never ahead of them.
 */
export function compareBaseline(a: BaselineKey, b: BaselineKey): number {
  const byDistance = compareNullable(a.distanceKm, b.distanceKm);
  if (byDistance !== 0) return byDistance;
  const byPrice = compareNullable(a.priceLevel, b.priceLevel);
  if (byPrice !== 0) return byPrice;
  return a.name.localeCompare(b.name, 'en');
}

function compareNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  // Distances are compared at 0.05 km resolution so floating point noise cannot decide order.
  const diff = Math.round(a * 20) - Math.round(b * 20);
  return diff === 0 ? 0 : diff < 0 ? -1 : 1;
}

export interface PopularKey extends BaselineKey {
  popularity: number | null;
}

/**
 * The Popular ordering. It is what a plain list of well known places does: the most popular first,
 * using the provider's general popularity and none of the group's own signals. Ties, and places with
 * no popularity value, fall back to the Taste Off ordering so the result is deterministic.
 */
export function compareByPopularity(a: PopularKey, b: PopularKey): number {
  if (a.popularity === null && b.popularity !== null) return 1;
  if (a.popularity !== null && b.popularity === null) return -1;
  if (a.popularity !== null && b.popularity !== null) {
    // Compared at 0.001 resolution so floating point noise cannot decide order.
    const diff = Math.round(b.popularity * 1000) - Math.round(a.popularity * 1000);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return compareBaseline(a, b);
}

export function popularKey(candidate: Candidate, distance: number | null): PopularKey {
  return {
    ...baselineKey(candidate, distance),
    popularity: candidate.taste.popularity ?? null,
  };
}

export function baselineKey(candidate: Candidate, distance: number | null): BaselineKey {
  return {
    distanceKm: distance,
    priceLevel: isKnown(candidate.facts.priceLevel) ? candidate.facts.priceLevel.value : null,
    name: candidate.name,
  };
}
