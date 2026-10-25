import { describe, expect, it } from 'vitest';
import {
  clockMinutes,
  readDietary,
  readOpenWindow,
  readQlooHours,
  readStepFree,
} from '../../src/qloo/facts.js';
import { toCandidate } from '../../src/qloo/normalize.js';
import { recordedPlaceEntity } from '../helpers/qloo-fixtures.js';

const FRIDAY = 5;
const MONDAY = 1;
const SUNDAY = 0;
const hoursOf = () => recordedPlaceEntity().properties.hours as Record<string, unknown>;
const tagsOf = (...ids: string[]) => ids.map((id) => ({ id, name: id.split(':').at(-1) ?? id }));

describe('clock times', () => {
  it('reads the notation Qloo uses and the plain forms', () => {
    expect(clockMinutes('T10:00:00')).toBe(600);
    expect(clockMinutes('23:59:59')).toBe(1439);
    expect(clockMinutes('07:05')).toBe(425);
  });

  it('refuses anything else', () => {
    for (const bad of [null, undefined, 7, '', 'noon', 'T24:00:00', 'T10:60:00', '10am']) {
      expect(clockMinutes(bad)).toBeNull();
    }
  });
});

describe('weekly hours', () => {
  it('reads the recorded shape and answers for the day of the plan', () => {
    const read = readOpenWindow(hoursOf(), { weekday: FRIDAY, startMinute: 19 * 60 + 30 });
    expect(read?.value).toEqual({ opensAt: 600, closesAt: 1380 });
    expect(read?.evidence).toBe('Listed for Friday: 10:00 to 23:00');
  });

  it('reports a closed day as closed all day, with the reason', () => {
    const read = readOpenWindow(hoursOf(), { weekday: MONDAY, startMinute: 19 * 60 });
    expect(read?.value.closedAllDay).toBe(true);
    expect(read?.evidence).toBe('Listed as closed on Monday');
  });

  it('carries a late night slot past midnight into the next day', () => {
    const week = readQlooHours(hoursOf());
    expect(week?.[6]).toEqual([{ start: 1080, end: 1560 }]);
    // Sunday at 01:00 falls inside Saturday night's slot, which closes at 02:00.
    const read = readOpenWindow(hoursOf(), { weekday: SUNDAY, startMinute: 60 });
    expect(read?.value).toEqual({ opensAt: 0, closesAt: 120 });
  });

  it('refuses a week with a missing day, an unreadable slot or no open day', () => {
    const missingDay = Object.fromEntries(
      Object.entries(hoursOf()).filter(([day]) => day !== 'sunday'),
    );
    expect(readQlooHours(missingDay)).toBeNull();
    expect(
      readQlooHours({ ...hoursOf(), friday: [{ closed: false, opens: null, closes: null }] }),
    ).toBeNull();
    expect(readQlooHours({ ...hoursOf(), friday: [] })).toBeNull();
    const allClosed = Object.fromEntries(
      Object.keys(hoursOf()).map((day) => [day, [{ closed: true, opens: null, closes: null }]]),
    );
    expect(readQlooHours(allClosed)).toBeNull();
    expect(readQlooHours(null)).toBeNull();
    expect(readQlooHours('Mo-Su 10:00-22:00')).toBeNull();
  });

  it('treats equal opening and closing times as a full day', () => {
    const everyDay = Object.fromEntries(
      Object.keys(hoursOf()).map((day) => [
        day,
        [{ closed: false, opens: 'T00:00:00', closes: 'T00:00:00' }],
      ]),
    );
    expect(readOpenWindow(everyDay, { weekday: FRIDAY, startMinute: 600 })?.value).toEqual({
      opensAt: 0,
      closesAt: 1440,
    });
  });
});

describe('step free access', () => {
  it('is known only when the wheelchair accessible entrance tag is present', () => {
    expect(
      readStepFree(tagsOf('urn:tag:accessibility:place:wheelchair_accessible_entrance')),
    ).toEqual({ value: true, evidence: 'Qloo tag: wheelchair_accessible_entrance' });
    expect(readStepFree(tagsOf('urn:tag:accessibility:place:wheelchair_accessible_seating'))).toBe(
      null,
    );
    expect(readStepFree([])).toBeNull();
    expect(readStepFree(undefined)).toBeNull();
  });
});

describe('dietary options', () => {
  const veg = 'urn:tag:dietary_option:qloo:vegetarian';
  const vegan = 'urn:tag:dietary_option:qloo:vegan';
  const halal = 'urn:tag:dietary_option:qloo:halal';

  it('offers the list only when it covers every requirement of the plan', () => {
    expect(readDietary(tagsOf(veg), ['vegetarian'])?.value).toEqual(['vegetarian']);
    expect(readDietary(tagsOf(veg), ['vegetarian', 'halal'])).toBeNull();
    expect(readDietary(tagsOf(veg, halal), ['vegetarian', 'halal'])?.value).toEqual([
      'vegetarian',
      'halal',
    ]);
  });

  it('gives nothing when the plan has no dietary requirement', () => {
    expect(readDietary(tagsOf(veg), [])).toBeNull();
  });

  it('counts vegan food as vegetarian', () => {
    expect(readDietary(tagsOf(vegan), ['vegetarian'])?.value).toContain('vegetarian');
  });

  it('ignores tags that are not dietary options or not understood', () => {
    expect(
      readDietary(tagsOf('urn:tag:dietary_option:qloo:organic', 'urn:tag:genre:place:vegan'), [
        'vegan',
      ]),
    ).toBeNull();
  });
});

describe('a candidate built from a place entity', () => {
  const context = { weekday: FRIDAY, startMinute: 19 * 60, dietaryNeeded: ['vegetarian'] as const };

  it('carries hours, access and diet with Qloo as the source and the reading as the evidence', () => {
    const candidate = toCandidate(recordedPlaceEntity(), '2026-10-25T00:00:00Z', context);
    const { facts } = candidate ?? {};
    expect(facts?.openWindow).toMatchObject({
      status: 'known',
      value: { opensAt: 600, closesAt: 1380 },
      provenance: {
        source: 'qloo',
        label: 'Qloo opening hours',
        detail: 'Listed for Friday: 10:00 to 23:00',
      },
    });
    expect(facts?.stepFree).toMatchObject({
      status: 'known',
      value: true,
      provenance: { source: 'qloo' },
    });
    expect(facts?.dietary).toMatchObject({ status: 'known', provenance: { source: 'qloo' } });
  });

  it('leaves what Qloo does not state unknown, including group size and covered seating', () => {
    const candidate = toCandidate(recordedPlaceEntity(), '2026-10-25T00:00:00Z', context);
    expect(candidate?.facts.groupCapacity.status).toBe('unknown');
    expect(candidate?.facts.covered.status).toBe('unknown');
  });

  it('judges nothing that depends on the plan when no plan is given', () => {
    const candidate = toCandidate(recordedPlaceEntity(), '2026-10-25T00:00:00Z');
    expect(candidate?.facts.openWindow.status).toBe('unknown');
    expect(candidate?.facts.dietary.status).toBe('unknown');
    expect(candidate?.facts.stepFree.status).toBe('known');
  });

  it('leaves hours unknown when the entry has none that can be read', () => {
    const candidate = toCandidate(
      recordedPlaceEntity({ hours: { monday: [{ closed: false, opens: null, closes: null }] } }),
      '2026-10-25T00:00:00Z',
      context,
    );
    expect(candidate?.facts.openWindow.status).toBe('unknown');
  });
});
