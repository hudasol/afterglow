import { describe, expect, it } from 'vitest';
import { readTagFacts, type TagContext } from '../../src/openstreetmap/tags.js';

/* Every tag set here is invented for the test. None of it describes a real venue. */

const friday1930: TagContext = { weekday: 5, startMinute: 19 * 60 + 30, dietaryNeeded: [] };

describe('opening hours', () => {
  it('reads the window of the plan day and keeps the tag as evidence', () => {
    const facts = readTagFacts({ opening_hours: 'Mo-Su 12:00-23:00' }, friday1930);
    expect(facts.openWindow?.value).toEqual({ opensAt: 720, closesAt: 1380 });
    expect(facts.openWindow?.evidence).toBe('opening_hours=Mo-Su 12:00-23:00');
  });

  it('reports a closed day instead of inventing times', () => {
    const facts = readTagFacts({ opening_hours: 'Mo-Th 12:00-23:00; Fr-Su off' }, friday1930);
    expect(facts.openWindow?.value.closedAllDay).toBe(true);
  });

  it('gives nothing for hours it cannot read fully', () => {
    const facts = readTagFacts({ opening_hours: 'Apr-Sep Mo-Su 10:00-20:00' }, friday1930);
    expect(facts.openWindow).toBeUndefined();
  });

  it('gives nothing when the tag is absent', () => {
    expect(readTagFacts({ name: 'Fixture Bistro' }, friday1930).openWindow).toBeUndefined();
  });
});

describe('dietary requirements', () => {
  const needing = (...needed: TagContext['dietaryNeeded']): TagContext => ({
    ...friday1930,
    dietaryNeeded: needed,
  });

  it('accepts a positive diet tag for the requirement', () => {
    const facts = readTagFacts({ 'diet:vegan': 'yes' }, needing('vegan'));
    expect(facts.dietary?.value).toContain('vegan');
    expect(facts.dietary?.evidence).toBe('diet:vegan=yes');
  });

  it('treats only as a yes', () => {
    expect(readTagFacts({ 'diet:halal': 'only' }, needing('halal')).dietary?.value).toContain(
      'halal',
    );
  });

  it('never reads a missing tag or a no as proof of anything', () => {
    expect(readTagFacts({}, needing('vegan')).dietary).toBeUndefined();
    expect(readTagFacts({ 'diet:vegan': 'no' }, needing('vegan')).dietary).toBeUndefined();
    expect(readTagFacts({ 'diet:vegan': 'limited' }, needing('vegan')).dietary).toBeUndefined();
  });

  it('offers a diet fact only when the tags cover every requirement of the plan', () => {
    const tags = { 'diet:vegan': 'yes' };
    expect(readTagFacts(tags, needing('vegan', 'gluten_free')).dietary).toBeUndefined();
    expect(
      readTagFacts({ ...tags, 'diet:gluten_free': 'yes' }, needing('vegan', 'gluten_free')).dietary
        ?.value,
    ).toEqual(expect.arrayContaining(['vegan', 'gluten_free']));
  });

  it('lets a vegan cuisine stand for vegetarian as well', () => {
    const facts = readTagFacts({ cuisine: 'vegan' }, needing('vegetarian'));
    expect(facts.dietary?.value).toContain('vegetarian');
  });

  it('does not look for diet tags when the plan has no dietary requirement', () => {
    expect(readTagFacts({ 'diet:vegan': 'yes' }, friday1930).dietary).toBeUndefined();
  });

  it('never infers a nut free kitchen from a general tag', () => {
    expect(readTagFacts({ cuisine: 'vegan' }, needing('nut_free')).dietary).toBeUndefined();
  });
});

describe('step free access', () => {
  it('maps yes, designated and no, and leaves limited unknown', () => {
    expect(readTagFacts({ wheelchair: 'yes' }, friday1930).stepFree?.value).toBe(true);
    expect(readTagFacts({ wheelchair: 'designated' }, friday1930).stepFree?.value).toBe(true);
    expect(readTagFacts({ wheelchair: 'no' }, friday1930).stepFree?.value).toBe(false);
    expect(readTagFacts({ wheelchair: 'limited' }, friday1930).stepFree).toBeUndefined();
    expect(readTagFacts({}, friday1930).stepFree).toBeUndefined();
  });
});

describe('group capacity', () => {
  it('accepts a plain whole number and rejects anything else', () => {
    expect(readTagFacts({ capacity: '48' }, friday1930).groupCapacity?.value).toBe(48);
    expect(readTagFacts({ capacity: '40-60' }, friday1930).groupCapacity).toBeUndefined();
    expect(readTagFacts({ capacity: '0' }, friday1930).groupCapacity).toBeUndefined();
    expect(readTagFacts({ capacity: '5000' }, friday1930).groupCapacity).toBeUndefined();
  });
});
