/*
 * A reader for a safe subset of the OpenStreetMap opening_hours format. It understands weekday
 * lists and ranges, time ranges that cross midnight, "off", and 24/7. Anything it does not fully
 * understand, such as months, sunrise, public holiday logic or open ended hours, makes the whole
 * value unreadable. A value that is only partly understood is never used, because a wrong opening
 * time would be worse than an unknown one.
 *
 * Weekdays are numbered like JavaScript: 0 is Sunday and 6 is Saturday. Times are minutes since
 * local midnight. An end time past 1440 means the range runs into the next day.
 */

export interface MinuteRange {
  start: number;
  end: number;
}

/** Seven lists of ranges, indexed by weekday with 0 for Sunday. */
export type WeeklyHours = readonly (readonly MinuteRange[])[];

export interface DayWindow {
  opensAt: number;
  closesAt: number;
  closedAllDay?: true;
}

const DAY_INDEX: Record<string, number> = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
const DAY_ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const MAX_LENGTH = 300;

const DAY_TOKEN = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
const SPECIAL_TOKEN = '(?:PH|SH)';
const SELECTOR_ITEM = `(?:${DAY_TOKEN}(?:\\s*-\\s*${DAY_TOKEN})?|${SPECIAL_TOKEN})`;
const SELECTOR = `${SELECTOR_ITEM}(?:\\s*,\\s*${SELECTOR_ITEM})*`;
const RULE = new RegExp(`^(?:(${SELECTOR})\\s+)?(.+)$`, 'u');
const TIME_RANGE = '\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}';
const TIME_LIST = new RegExp(`^${TIME_RANGE}(?:\\s*,\\s*${TIME_RANGE})*$`, 'u');
const ADDITIVE_SPLIT = new RegExp(`,\\s+(?=${SELECTOR_ITEM}\\b)`, 'u');

function clock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 48) return null;
  return hours * 60 + minutes;
}

function parseRanges(text: string): MinuteRange[] | null {
  if (!TIME_LIST.test(text)) return null;
  const ranges: MinuteRange[] = [];
  for (const part of text.split(',')) {
    const [from, to] = part.split('-');
    const start = from === undefined ? null : clock(from);
    let end = to === undefined ? null : clock(to);
    // A start of 24:00 or later is not a real opening time.
    if (start === null || end === null || start >= 1440) return null;
    if (end <= start) end += 1440;
    ranges.push({ start, end });
  }
  return ranges;
}

function daysOf(selector: string | undefined): number[] | null {
  if (selector === undefined) return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set<number>();
  for (const item of selector.split(',').map((part) => part.trim())) {
    if (item === 'PH' || item === 'SH') continue;
    const [from, to] = item.split('-').map((part) => part.trim());
    const first = DAY_ORDER.indexOf(from as (typeof DAY_ORDER)[number]);
    if (first < 0) return null;
    if (to === undefined) {
      days.add(DAY_INDEX[from as string] as number);
      continue;
    }
    const last = DAY_ORDER.indexOf(to as (typeof DAY_ORDER)[number]);
    if (last < 0) return null;
    // A range such as Fr-Mo wraps around the end of the week.
    for (let step = first; ; step = (step + 1) % 7) {
      days.add(DAY_INDEX[DAY_ORDER[step] as string] as number);
      if (step === last) break;
    }
  }
  return [...days];
}

function merge(ranges: readonly MinuteRange[]): MinuteRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MinuteRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** Returns null when the value is empty, too long or not fully understood. */
export function parseOpeningHours(raw: string): WeeklyHours | null {
  const text = raw.trim();
  if (text === '' || text.length > MAX_LENGTH) return null;
  if (/^24\/7$/iu.test(text)) {
    return Array.from({ length: 7 }, () => [{ start: 0, end: 1440 }]);
  }

  const days: MinuteRange[][] = Array.from({ length: 7 }, () => []);
  let understood = false;

  for (const chunk of text.split(';')) {
    const part = chunk.trim();
    if (part === '') continue;
    const subRules = part.split(ADDITIVE_SPLIT);
    for (const [index, sub] of subRules.entries()) {
      const match = RULE.exec(sub.trim());
      if (!match) return null;
      const selector = match[1];
      const rest = (match[2] ?? '').trim();

      // A rule about public or school holidays cannot be checked against a plain date here.
      if (selector !== undefined && /^(?:PH|SH)(?:\s*,\s*(?:PH|SH))*$/u.test(selector)) {
        if (!/^(?:off|closed)$/iu.test(rest) && !TIME_LIST.test(rest)) return null;
        // On its own such a rule says nothing about ordinary days, so it does not count as read.
        continue;
      }
      const selected = daysOf(selector);
      if (!selected) return null;

      if (/^(?:off|closed)$/iu.test(rest)) {
        for (const day of selected) days[day] = [];
      } else {
        const ranges = parseRanges(rest);
        if (!ranges) return null;
        for (const day of selected) {
          days[day] = index > 0 ? [...(days[day] ?? []), ...ranges] : [...ranges];
        }
      }
      understood = true;
    }
  }
  return understood ? days.map(merge) : null;
}

/**
 * The window that matters for a plan starting at the given minute on the given weekday. When the
 * venue opens in more than one block that day, the block holding the start is used, and otherwise
 * the next block, so that the gate can say plainly why the plan does not fit.
 */
export function windowFor(hours: WeeklyHours, weekday: number, startMinute: number): DayWindow {
  const yesterday = hours[(weekday + 6) % 7] ?? [];
  for (const range of yesterday) {
    if (range.end > 1440 && startMinute < range.end - 1440) {
      return { opensAt: 0, closesAt: range.end - 1440 };
    }
  }
  const today = hours[weekday] ?? [];
  if (today.length === 0) return { opensAt: 0, closesAt: 1, closedAllDay: true };
  const chosen =
    today.find((range) => startMinute >= range.start && startMinute < range.end) ??
    today.find((range) => range.start > startMinute) ??
    today[today.length - 1];
  if (!chosen) return { opensAt: 0, closesAt: 1, closedAllDay: true };
  return { opensAt: chosen.start, closesAt: Math.min(chosen.end, 2160) };
}
