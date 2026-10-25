import type { DietaryRequirement } from '../domain/intent.js';
import { parseOpeningHours, windowFor } from '../domain/opening-hours.js';
import type { OpenWindow } from '../domain/venue.js';

/*
 * Reads the few OpenStreetMap tags that answer a hard requirement. Every value comes with the tag
 * it was read from, so the interface can show the person exactly what the fact rests on. A tag that
 * is missing, unclear or only partly true yields no fact at all, so the person is asked instead.
 */

export interface TagFact<T> {
  value: T;
  /** The tag and its value, for example wheelchair=yes. Shown to the person as the evidence. */
  evidence: string;
}

export interface TagFacts {
  openWindow?: TagFact<OpenWindow>;
  dietary?: TagFact<DietaryRequirement[]>;
  stepFree?: TagFact<boolean>;
  groupCapacity?: TagFact<number>;
}

export interface TagContext {
  /** 0 for Sunday through 6 for Saturday, in the local time of the plan. */
  weekday: number;
  /** Minutes since local midnight at the start of the plan. */
  startMinute: number;
  /** The dietary requirements the plan insists on. */
  dietaryNeeded: readonly DietaryRequirement[];
}

const DIET_TAG: Record<DietaryRequirement, string> = {
  vegetarian: 'diet:vegetarian',
  vegan: 'diet:vegan',
  halal: 'diet:halal',
  kosher: 'diet:kosher',
  gluten_free: 'diet:gluten_free',
  nut_free: 'diet:nut_free',
};

/** A cuisine that is itself a promise, such as a vegan restaurant. */
const CUISINE_IMPLIES: Record<string, DietaryRequirement[]> = {
  vegan: ['vegan', 'vegetarian'],
  vegetarian: ['vegetarian'],
  halal: ['halal'],
  kosher: ['kosher'],
};

function listedDiets(tags: Record<string, string>): TagFact<DietaryRequirement[]> | null {
  const found = new Set<DietaryRequirement>();
  const evidence: string[] = [];
  for (const [requirement, key] of Object.entries(DIET_TAG) as [DietaryRequirement, string][]) {
    const value = tags[key]?.trim().toLowerCase();
    if (value === 'yes' || value === 'only') {
      found.add(requirement);
      evidence.push(`${key}=${value}`);
    }
  }
  const cuisines = (tags['cuisine'] ?? '').split(';').map((part) => part.trim().toLowerCase());
  for (const cuisine of cuisines) {
    for (const requirement of CUISINE_IMPLIES[cuisine] ?? []) found.add(requirement);
    if (CUISINE_IMPLIES[cuisine]) evidence.push(`cuisine=${cuisine}`);
  }
  return found.size > 0 ? { value: [...found], evidence: evidence.join(', ') } : null;
}

export function readTagFacts(tags: Record<string, string>, context: TagContext): TagFacts {
  const facts: TagFacts = {};

  const hoursText = tags['opening_hours'];
  const hours = hoursText === undefined ? null : parseOpeningHours(hoursText);
  if (hoursText !== undefined && hours) {
    const window = windowFor(hours, context.weekday, context.startMinute);
    facts.openWindow = {
      value: {
        opensAt: window.opensAt,
        closesAt: window.closesAt,
        ...(window.closedAllDay ? { closedAllDay: true } : {}),
      },
      evidence: `opening_hours=${hoursText}`,
    };
  }

  // Absence of a diet tag proves nothing, so a diet fact is only offered when the tags back every
  // requirement the plan insists on. Otherwise the person is asked.
  if (context.dietaryNeeded.length > 0) {
    const listed = listedDiets(tags);
    if (listed && context.dietaryNeeded.every((need) => listed.value.includes(need))) {
      facts.dietary = listed;
    }
  }

  // wheelchair=limited means some parts only, which is not a yes or a no for step free access.
  const wheelchair = tags['wheelchair']?.trim().toLowerCase();
  if (wheelchair === 'yes' || wheelchair === 'designated') {
    facts.stepFree = { value: true, evidence: `wheelchair=${wheelchair}` };
  } else if (wheelchair === 'no') {
    facts.stepFree = { value: false, evidence: 'wheelchair=no' };
  }

  const capacityText = tags['capacity']?.trim();
  if (capacityText !== undefined && /^\d{1,3}$/u.test(capacityText)) {
    const capacity = Number(capacityText);
    if (capacity >= 1 && capacity <= 500) {
      facts.groupCapacity = { value: capacity, evidence: `capacity=${capacity}` };
    }
  }
  return facts;
}
