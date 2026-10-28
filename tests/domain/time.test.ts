import { describe, expect, it } from 'vitest';
import { nextLocalOccurrence, zoneOffsetMinutes } from '../../src/domain/time.js';

describe('zone offsets', () => {
  it('follow daylight saving time', () => {
    expect(zoneOffsetMinutes('America/New_York', new Date('2026-07-01T12:00:00Z'))).toBe(-240);
    expect(zoneOffsetMinutes('America/New_York', new Date('2026-11-04T12:00:00Z'))).toBe(-300);
    expect(zoneOffsetMinutes('Europe/London', new Date('2026-07-01T12:00:00Z'))).toBe(60);
    expect(zoneOffsetMinutes('Europe/London', new Date('2026-11-04T12:00:00Z'))).toBe(0);
    expect(zoneOffsetMinutes('Asia/Dubai', new Date('2026-11-04T12:00:00Z'))).toBe(240);
    expect(zoneOffsetMinutes('Asia/Tokyo', new Date('2026-11-04T12:00:00Z'))).toBe(540);
  });
});

describe('next local occurrence', () => {
  // Wednesday 28 October 2026, 14:00 UTC.
  const now = new Date('2026-10-28T14:00:00Z');

  it('is the following Wednesday when asked on a Wednesday, never today', () => {
    expect(nextLocalOccurrence(now, 'Asia/Dubai', 3, 19, 30)).toBe('2026-11-04T19:30:00+04:00');
  });

  it('uses the offset in force on the day, across a change of clocks', () => {
    // New York leaves daylight saving time on 1 November, after now and before the plan.
    expect(nextLocalOccurrence(now, 'America/New_York', 3, 19, 30)).toBe(
      '2026-11-04T19:30:00-05:00',
    );
    expect(nextLocalOccurrence(now, 'Europe/London', 3, 19, 30)).toBe('2026-11-04T19:30:00Z');
    expect(nextLocalOccurrence(now, 'Europe/Paris', 3, 19, 30)).toBe('2026-11-04T19:30:00+01:00');
    expect(nextLocalOccurrence(now, 'Asia/Tokyo', 3, 19, 30)).toBe('2026-11-04T19:30:00+09:00');
  });

  it('counts the weekday on the clock of the zone, not of UTC', () => {
    // 23:00 UTC on Wednesday is already Thursday in Tokyo, so the next Thursday there is a week on.
    const late = new Date('2026-10-28T23:00:00Z');
    expect(nextLocalOccurrence(late, 'Asia/Tokyo', 3, 19, 30)).toBe('2026-11-04T19:30:00+09:00');
    expect(nextLocalOccurrence(late, 'Europe/London', 3, 19, 30)).toBe('2026-11-04T19:30:00Z');
    expect(nextLocalOccurrence(late, 'Asia/Tokyo', 4, 20, 0)).toBe('2026-11-05T20:00:00+09:00');
  });
});
