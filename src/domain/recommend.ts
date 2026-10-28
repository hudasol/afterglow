import {
  evaluateCandidate,
  type Feasibility,
  type GateContext,
  type GateResult,
} from './feasibility.js';
import {
  baselineKey,
  compareBaseline,
  compareByPopularity,
  compositeScore,
  distanceToOriginal,
  popularKey,
  tasteValues,
  type ScoreBreakdown,
} from './scoring.js';
import type { Candidate, TasteScore } from './venue.js';

/**
 * Three orderings of the same eligible places. Taste Off sorts by distance. Popular sorts by the
 * provider's general popularity. Taste On uses the group's own signals.
 */
export type Arm = 'taste_on' | 'taste_off' | 'popular';

export interface RankedOption {
  candidateId: string;
  /** 1 is best within the arm. Feasible options always rank ahead of options needing verification. */
  position: number;
  feasibility: Exclude<Feasibility, 'rejected'>;
  distanceKm: number | null;
  /** Present for the Taste On arm only. */
  score?: ScoreBreakdown;
  providerRank?: number;
  providerAffinity?: number;
}

export interface ArmOutcome {
  arm: Arm;
  options: RankedOption[];
}

export interface RecommendationOutcome {
  gate: Record<string, GateResult>;
  rejectedIds: string[];
  tasteOff: ArmOutcome;
  /** Null when no taste scores were available, for example when Qloo could not be reached. */
  tasteOn: ArmOutcome | null;
  /** Null when none of the eligible places has a popularity value. */
  popular: ArmOutcome | null;
}

/**
 * Runs the gate once, then orders the eligible candidates two ways over the same pool. The only
 * difference between the arms is the ordering rule, which keeps the comparison fair.
 */
export function recommend(
  pool: readonly Candidate[],
  ctx: GateContext,
  tasteScores: readonly TasteScore[] | null,
): RecommendationOutcome {
  const gate: Record<string, GateResult> = {};
  const eligible: { candidate: Candidate; result: GateResult; distance: number | null }[] = [];
  const rejectedIds: string[] = [];

  for (const candidate of pool) {
    const result = evaluateCandidate(candidate, ctx);
    gate[candidate.id] = result;
    if (result.status === 'rejected') {
      rejectedIds.push(candidate.id);
    } else {
      eligible.push({
        candidate,
        result,
        distance: distanceToOriginal(candidate, ctx.originalLocation),
      });
    }
  }

  const feasibilityRank = (status: Feasibility): number => (status === 'feasible' ? 0 : 1);

  const offSorted = [...eligible].sort(
    (a, b) =>
      feasibilityRank(a.result.status) - feasibilityRank(b.result.status) ||
      compareBaseline(baselineKey(a.candidate, a.distance), baselineKey(b.candidate, b.distance)),
  );
  const tasteOff: ArmOutcome = {
    arm: 'taste_off',
    options: offSorted.map((entry, index) => ({
      candidateId: entry.candidate.id,
      position: index + 1,
      feasibility: entry.result.status as Exclude<Feasibility, 'rejected'>,
      distanceKm: entry.distance,
    })),
  };

  const popularSorted = [...eligible].sort(
    (a, b) =>
      feasibilityRank(a.result.status) - feasibilityRank(b.result.status) ||
      compareByPopularity(popularKey(a.candidate, a.distance), popularKey(b.candidate, b.distance)),
  );
  const popular: ArmOutcome | null = eligible.some(
    (entry) => entry.candidate.taste.popularity !== undefined,
  )
    ? {
        arm: 'popular',
        options: popularSorted.map((entry, index) => ({
          candidateId: entry.candidate.id,
          position: index + 1,
          feasibility: entry.result.status as Exclude<Feasibility, 'rejected'>,
          distanceKm: entry.distance,
        })),
      }
    : null;

  if (!tasteScores) return { gate, rejectedIds, tasteOff, tasteOn: null, popular };

  const values = tasteValues(tasteScores, new Set(eligible.map((entry) => entry.candidate.id)));
  const byId = new Map(tasteScores.map((score) => [score.candidateId, score]));
  const scored = eligible.map((entry) => ({
    ...entry,
    breakdown: compositeScore(values.get(entry.candidate.id), entry.distance),
    provider: byId.get(entry.candidate.id),
  }));
  // A place the provider did not score never outranks one it did: its taste is simply unknown.
  const hasTaste = (entry: { breakdown: ScoreBreakdown }): number =>
    entry.breakdown.tasteComponent === null ? 1 : 0;
  scored.sort(
    (a, b) =>
      feasibilityRank(a.result.status) - feasibilityRank(b.result.status) ||
      hasTaste(a) - hasTaste(b) ||
      b.breakdown.composite - a.breakdown.composite ||
      compareBaseline(baselineKey(a.candidate, a.distance), baselineKey(b.candidate, b.distance)),
  );
  const tasteOn: ArmOutcome = {
    arm: 'taste_on',
    options: scored.map((entry, index) => ({
      candidateId: entry.candidate.id,
      position: index + 1,
      feasibility: entry.result.status as Exclude<Feasibility, 'rejected'>,
      distanceKm: entry.distance,
      score: entry.breakdown,
      ...(entry.provider ? { providerRank: entry.provider.rank } : {}),
      ...(entry.provider?.affinity !== undefined
        ? { providerAffinity: entry.provider.affinity }
        : {}),
    })),
  };

  return { gate, rejectedIds, tasteOff, tasteOn, popular };
}
