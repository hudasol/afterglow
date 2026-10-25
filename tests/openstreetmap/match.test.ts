import { describe, expect, it } from 'vitest';
import { matchElement, nameDistance } from '../../src/openstreetmap/match.js';
import type { OsmElement } from '../../src/openstreetmap/overpass.js';

/* Invented places only. */

const at = { lat: 25.2, lon: 55.27 };
const element = (ref: string, name: string, lat = 25.2, lon = 55.27): OsmElement => ({
  ref,
  position: { lat, lon },
  tags: { name },
});

describe('nameDistance', () => {
  it('matches the same name regardless of case, accents and punctuation', () => {
    expect(nameDistance('Café Luna', 'CAFE  luna!')).toBe(0);
  });

  it('matches a longer name that contains a whole word run of the shorter one', () => {
    expect(nameDistance('Luna Kitchen', 'Luna Kitchen and Bar')).toBe(1);
  });

  it('does not match inside a word or on a short name', () => {
    expect(nameDistance('Bar', 'Barbecue Barn')).toBeNull();
    expect(nameDistance('Luna', 'Lunar Lounge')).toBeNull();
    expect(nameDistance('Mira', 'Mira Cafe Restaurant')).toBeNull();
  });

  it('does not match two different names', () => {
    expect(nameDistance('Fixture Bistro', 'Fixture Grill')).toBeNull();
  });
});

describe('matchElement', () => {
  it('prefers the exact name over a contained one', () => {
    const chosen = matchElement('Luna Kitchen', at, [
      element('node/1', 'Luna Kitchen and Bar', 25.2, 55.27),
      element('node/2', 'Luna Kitchen', 25.2009, 55.27),
    ]);
    expect(chosen?.ref).toBe('node/2');
  });

  it('picks the nearest of two places with the same name', () => {
    const chosen = matchElement('Luna Kitchen', at, [
      element('node/1', 'Luna Kitchen', 25.2008, 55.27),
      element('node/2', 'Luna Kitchen', 25.2002, 55.27),
    ]);
    expect(chosen?.ref).toBe('node/2');
  });

  it('returns nothing when no name fits', () => {
    expect(matchElement('Luna Kitchen', at, [element('node/1', 'Sol Grill')])).toBeNull();
    expect(matchElement('Luna Kitchen', at, [])).toBeNull();
  });
});
