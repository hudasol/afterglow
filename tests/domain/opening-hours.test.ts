import { describe, expect, it } from 'vitest';
import { parseOpeningHours, windowFor } from '../../src/domain/opening-hours.js';
import { localWeekday } from '../../src/domain/time.js';

const SUN = 0;
const MON = 1;
const TUE = 2;
const FRI = 5;
const SAT = 6;

function hours(raw: string) {
  const parsed = parseOpeningHours(raw);
  if (!parsed) throw new Error(`Expected ${raw} to be readable`);
  return parsed;
}

describe('reading opening hours', () => {
  it('reads weekday ranges that end at midnight', () => {
    const week = hours('Mo-Sa 18:00-00:00; Su 11:30-00:00');
    expect(week[MON]).toEqual([{ start: 1080, end: 1440 }]);
    expect(week[SAT]).toEqual([{ start: 1080, end: 1440 }]);
    expect(week[SUN]).toEqual([{ start: 690, end: 1440 }]);
  });

  it('treats a public holiday rule as outside what it can check', () => {
    const week = hours('Mo-Fr 08:00-17:00; Sa 09:00-13:00; PH off');
    expect(week[MON]).toEqual([{ start: 480, end: 1020 }]);
    expect(week[SAT]).toEqual([{ start: 540, end: 780 }]);
    expect(week[SUN]).toEqual([]);
    expect(hours('Mo-Fr 08:00-17:00, PH off')[MON]).toEqual([{ start: 480, end: 1020 }]);
  });

  it('reads split service in one day and lists of weekdays', () => {
    const week = hours('Mo,We,Fr 10:00-14:00,17:00-22:00');
    expect(week[MON]).toEqual([
      { start: 600, end: 840 },
      { start: 1020, end: 1320 },
    ]);
    expect(week[TUE]).toEqual([]);
    expect(hours('Mo-Fr 11:30-14:30, 17:30-22:00')[FRI]).toHaveLength(2);
  });

  it('applies a later rule over an earlier one for the same day', () => {
    const week = hours('Mo-Su 11:00-23:00; Mo off; Fr 11:00-01:00');
    expect(week[MON]).toEqual([]);
    expect(week[TUE]).toEqual([{ start: 660, end: 1380 }]);
    expect(week[FRI]).toEqual([{ start: 660, end: 1500 }]);
  });

  it('reads a rule without weekdays as every day, and 24/7', () => {
    expect(hours('10:00-22:00')[SAT]).toEqual([{ start: 600, end: 1320 }]);
    expect(hours('24/7')[TUE]).toEqual([{ start: 0, end: 1440 }]);
  });

  it('reads a weekday range that wraps around the end of the week', () => {
    const week = hours('Fr-Mo 18:00-02:00');
    expect(week[FRI]).toEqual([{ start: 1080, end: 1560 }]);
    expect(week[SUN]).toEqual([{ start: 1080, end: 1560 }]);
    expect(week[MON]).toEqual([{ start: 1080, end: 1560 }]);
    expect(week[TUE]).toEqual([]);
  });

  it('joins ranges that touch', () => {
    expect(hours('Mo 11:00-15:00,15:00-22:00')[MON]).toEqual([{ start: 660, end: 1320 }]);
  });

  it.each([
    'Mo-Fr 08:00-17:00; Jan-Mar off',
    'sunrise-sunset',
    'Mo-Fr 09:00+',
    'by appointment',
    'Mo-Fr 10:00-18:00 "call ahead"',
    'Mo-Fr 25:00-26:00',
    'Mo-Fr 09:75-17:00',
    'Mo-Fr week 1-3 09:00-17:00',
    'Mo[1] 10:00-12:00',
    'Mo-Fr 24:00-26:00',
    '',
    '   ',
    'PH off',
  ])('does not guess at %j', (raw) => {
    expect(parseOpeningHours(raw)).toBeNull();
  });

  it('refuses a value that is far too long', () => {
    expect(parseOpeningHours(`Mo ${'10:00-12:00,'.repeat(40)}10:00-12:00`)).toBeNull();
  });
});

describe('the window for a plan', () => {
  const week = hours('Mo-Sa 18:00-00:00; Su 11:30-00:00');

  it('gives the block that holds the start', () => {
    expect(windowFor(week, SAT, 19 * 60 + 30)).toEqual({ opensAt: 1080, closesAt: 1440 });
  });

  it('gives the next block when the plan starts before opening, so the gate can explain', () => {
    expect(windowFor(week, SAT, 12 * 60)).toEqual({ opensAt: 1080, closesAt: 1440 });
  });

  it('gives the last block when the plan starts after closing', () => {
    expect(windowFor(hours('Mo 10:00-14:00'), MON, 20 * 60)).toEqual({
      opensAt: 600,
      closesAt: 840,
    });
  });

  it('chooses between two blocks by the start', () => {
    const split = hours('Mo 10:00-14:00,17:00-22:00');
    expect(windowFor(split, MON, 18 * 60)).toEqual({ opensAt: 1020, closesAt: 1320 });
    expect(windowFor(split, MON, 11 * 60)).toEqual({ opensAt: 600, closesAt: 840 });
    expect(windowFor(split, MON, 15 * 60)).toEqual({ opensAt: 1020, closesAt: 1320 });
  });

  it('marks a day with no hours as closed all day', () => {
    expect(windowFor(hours('Tu-Su 12:00-23:00; Mo off'), MON, 19 * 60)).toMatchObject({
      closedAllDay: true,
    });
  });

  it('carries late night hours into the early hours of the next day', () => {
    const late = hours('Fr 20:00-02:00');
    expect(windowFor(late, FRI, 21 * 60)).toEqual({ opensAt: 1200, closesAt: 1560 });
    expect(windowFor(late, SAT, 30)).toEqual({ opensAt: 0, closesAt: 120 });
    expect(windowFor(late, SAT, 3 * 60)).toMatchObject({ closedAllDay: true });
  });
});

describe('the local weekday', () => {
  it('uses the offset written in the time, not the machine zone', () => {
    // 2026-11-07 is a Saturday. 23:30 at +04:00 is 19:30 UTC, still Saturday in both.
    expect(localWeekday('2026-11-07T23:30:00+04:00')).toBe(SAT);
    // 01:00 at +04:00 on Sunday is still Saturday in UTC. The local day is what counts.
    expect(localWeekday('2026-11-08T01:00:00+04:00')).toBe(SUN);
    expect(localWeekday('2026-11-07T22:00:00-05:00')).toBe(SAT);
  });
});
