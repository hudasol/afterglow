import { windowFor, type MinuteRange, type WeeklyHours } from '../domain/opening-hours.js';
import type { DietaryRequirement } from '../domain/intent.js';
import type { FactContext } from '../domain/fact-context.js';
import { formatMinuteOfDay } from '../domain/time.js';
import type { OpenWindow } from '../domain/venue.js';

/*
 * Readers for the practical facts that Qloo place entities carry. Each reader is written against
 * the shapes recorded from live responses on 25 October 2026, and each one returns nothing when a
 * value is missing, partial or in a form it does not recognise. A fact that is not stated is left
 * unknown so that the person is asked. Nothing here guesses.
 */

export interface ReadFact<T> {
  value: T;
  /** What the value rests on, shown to the person next to the verdict. */
  evidence: string;
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Reads "T10:00:00", "10:00:00" or "10:00" as minutes since midnight. */
export function clockMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^T?(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/u.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Reads the weekly hours of a Qloo place: an object keyed by weekday name, where each day holds
 * a list of slots with a closed flag and opening and closing clock times. The whole value is
 * refused when any day is missing or any open slot has no readable times, because a week with
 * one wrong day is worse than no week.
 */
export function readQlooHours(value: unknown): WeeklyHours | null {
  const hours = record(value);
  if (!hours) return null;
  const week: MinuteRange[][] = [];
  let anyOpen = false;
  for (const key of DAY_KEYS) {
    const slots = hours[key];
    if (!Array.isArray(slots) || slots.length === 0) return null;
    const ranges: MinuteRange[] = [];
    for (const raw of slots) {
      const slot = record(raw);
      if (!slot) return null;
      if (slot['closed'] === true) continue;
      const start = clockMinutes(slot['opens']);
      let end = clockMinutes(slot['closes']);
      if (start === null || end === null) return null;
      // A closing time at or before the opening time means the slot runs past midnight.
      if (end <= start) end += 1440;
      ranges.push({ start, end });
      anyOpen = true;
    }
    week.push(ranges);
  }
  return anyOpen ? week : null;
}

export function readOpenWindow(
  hoursValue: unknown,
  context: Pick<FactContext, 'weekday' | 'startMinute'>,
): ReadFact<OpenWindow> | null {
  const hours = readQlooHours(hoursValue);
  if (!hours) return null;
  const window = windowFor(hours, context.weekday, context.startMinute);
  const day = DAY_NAMES[context.weekday] ?? 'that day';
  return {
    value: {
      opensAt: window.opensAt,
      closesAt: window.closesAt,
      ...(window.closedAllDay ? { closedAllDay: true } : {}),
    },
    evidence: window.closedAllDay
      ? `Listed as closed on ${day}`
      : `Listed for ${day}: ${formatMinuteOfDay(window.opensAt)} to ${formatMinuteOfDay(window.closesAt)}`,
  };
}

const TAG_PREFIX = {
  diet: 'urn:tag:dietary_option:qloo:',
  accessibility: 'urn:tag:accessibility:place:',
};

const DIET_BY_SUFFIX: Record<string, DietaryRequirement> = {
  vegetarian: 'vegetarian',
  vegan: 'vegan',
  halal: 'halal',
  kosher: 'kosher',
  gluten_free: 'gluten_free',
  nut_free: 'nut_free',
};

function tagEntries(tags: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(tags)) return [];
  return tags.flatMap((tag) => {
    const entry = record(tag);
    const id = entry?.['id'];
    const name = entry?.['name'];
    return typeof id === 'string' ? [{ id, name: typeof name === 'string' ? name : id }] : [];
  });
}

/**
 * Qloo states a wheelchair accessible entrance as a tag. A place without the tag is not known to
 * be inaccessible, so the absence of a tag gives no fact.
 */
export function readStepFree(tags: unknown): ReadFact<boolean> | null {
  const found = tagEntries(tags).find(
    (tag) => tag.id === `${TAG_PREFIX.accessibility}wheelchair_accessible_entrance`,
  );
  return found ? { value: true, evidence: `Qloo tag: ${found.name}` } : null;
}

/**
 * Qloo lists dietary options as tags. A place that lacks a tag may still cater for it, so the
 * list is offered as a fact only when it covers every requirement the plan insists on. Vegan food
 * is vegetarian, so a vegan tag also counts for vegetarian.
 */
export function readDietary(
  tags: unknown,
  needed: readonly DietaryRequirement[],
): ReadFact<DietaryRequirement[]> | null {
  if (needed.length === 0) return null;
  const listed = new Set<DietaryRequirement>();
  const names: string[] = [];
  for (const tag of tagEntries(tags)) {
    if (!tag.id.startsWith(TAG_PREFIX.diet)) continue;
    const requirement = DIET_BY_SUFFIX[tag.id.slice(TAG_PREFIX.diet.length)];
    if (!requirement) continue;
    listed.add(requirement);
    names.push(tag.name);
  }
  if (listed.has('vegan')) listed.add('vegetarian');
  if (!needed.every((need) => listed.has(need))) return null;
  return { value: [...listed], evidence: `Qloo tags: ${names.join(', ')}` };
}
