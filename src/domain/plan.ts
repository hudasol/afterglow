import { z } from 'zod';
import { constraintKey, type HardConstraint, type IntentAnchor } from './intent.js';
import { shiftIso } from './time.js';

export const disruptionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('venue_unavailable'), note: z.string().trim().max(200).optional() }),
  z.object({ kind: z.literal('running_late'), minutes: z.number().int().min(5).max(240) }),
  z.object({ kind: z.literal('weather'), condition: z.enum(['rain', 'extreme_heat', 'cold']) }),
  z.object({ kind: z.literal('budget_reduced'), maxPriceLevel: z.number().int().min(1).max(4) }),
  z.object({ kind: z.literal('party_changed'), partySize: z.number().int().min(1).max(30) }),
]);
export type Disruption = z.infer<typeof disruptionSchema>;

export function describeDisruption(disruption: Disruption): string {
  switch (disruption.kind) {
    case 'venue_unavailable':
      return 'The original venue can no longer host the plan';
    case 'running_late':
      return `The group is running ${disruption.minutes} minutes late`;
    case 'weather':
      return `Weather change: ${disruption.condition.replace('_', ' ')}`;
    case 'budget_reduced':
      return `Budget reduced to price level ${disruption.maxPriceLevel} of 4`;
    case 'party_changed':
      return `Party size changed to ${disruption.partySize}`;
  }
}

/** The plan as it stands now: the anchor with disruptions and approved relaxations applied. */
export interface EffectivePlan {
  planStart: string;
  durationMinutes: number;
  partySize: number;
  hardConstraints: HardConstraint[];
  /** Keys of constraints the person explicitly agreed to give up. */
  relaxedConstraintKeys: string[];
}

export function deriveEffectivePlan(
  anchor: IntentAnchor,
  disruptions: readonly Disruption[],
  relaxedConstraintKeys: readonly string[],
): EffectivePlan {
  let planStart = anchor.planStart;
  let partySize = anchor.partySize;
  const byKey = new Map<string, HardConstraint>();
  for (const constraint of anchor.hardConstraints) byKey.set(constraintKey(constraint), constraint);

  for (const disruption of disruptions) {
    switch (disruption.kind) {
      case 'venue_unavailable':
        break;
      case 'running_late':
        planStart = shiftIso(planStart, disruption.minutes);
        break;
      case 'weather':
        byKey.set('covered_space', { kind: 'covered_space' });
        break;
      case 'budget_reduced': {
        const current = byKey.get('max_price_level');
        const level =
          current?.kind === 'max_price_level'
            ? Math.min(current.level, disruption.maxPriceLevel)
            : disruption.maxPriceLevel;
        byKey.set('max_price_level', { kind: 'max_price_level', level });
        break;
      }
      case 'party_changed':
        partySize = disruption.partySize;
        byKey.set('fits_party_size', { kind: 'fits_party_size' });
        break;
    }
  }

  const relaxed = new Set(relaxedConstraintKeys);
  return {
    planStart,
    durationMinutes: anchor.durationMinutes,
    partySize,
    hardConstraints: [...byKey.entries()]
      .filter(([key]) => !relaxed.has(key))
      .map(([, constraint]) => constraint),
    relaxedConstraintKeys: [...relaxed],
  };
}
