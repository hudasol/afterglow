import type { DietaryRequirement } from './intent.js';
import type { EffectivePlan } from './plan.js';
import { localMinuteOfDay, localWeekday } from './time.js';

/**
 * What a source needs to know about the plan to judge a practical fact: the day and time the plan
 * starts, in the local clock of the plan, and the dietary requirements it insists on. Opening hours
 * are judged for that day, and a diet list is only useful when it covers every requirement.
 */
export interface FactContext {
  /** 0 for Sunday through 6 for Saturday. */
  weekday: number;
  /** Minutes since local midnight at the start of the plan. */
  startMinute: number;
  dietaryNeeded: readonly DietaryRequirement[];
}

export function factContextOf(plan: EffectivePlan): FactContext {
  const dietaryNeeded: DietaryRequirement[] = [];
  for (const constraint of plan.hardConstraints) {
    if (constraint.kind === 'dietary') dietaryNeeded.push(constraint.requirement);
  }
  return {
    weekday: localWeekday(plan.planStart),
    startMinute: localMinuteOfDay(plan.planStart),
    dietaryNeeded,
  };
}
