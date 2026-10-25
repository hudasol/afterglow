import { describe, expect, it } from 'vitest';
import {
  OTHER_CITY_KM,
  centreOf,
  checkOriginalVenue,
  namesVenue,
} from '../../src/domain/original-venue.js';
import { makeCandidate } from '../helpers/fixtures.js';

/* Invented places around a point in an invented city. */
const AROUND = [
  { lat: 25.2, lon: 55.27 },
  { lat: 25.21, lon: 55.28 },
  { lat: 25.19, lon: 55.26 },
  { lat: 25.22, lon: 55.3 },
  { lat: 25.18, lon: 55.25 },
  { lat: 25.2, lon: 55.29 },
];
const pool = AROUND.map((point, index) => makeCandidate({ id: `p${index}`, point }));
const FAR = { lat: 33.42, lon: -111.94 };

describe('namesVenue', () => {
  it('matches the name exactly, ignoring case and accents', () => {
    expect(namesVenue('BRASSERIE ZEDEL', 'Brasserie Zédel', 'London')).toBe(true);
  });

  it('matches a branch named after the city', () => {
    expect(namesVenue('Zuma Dubai', 'Zuma', 'Dubai')).toBe(true);
  });

  it('does not match a longer or different name', () => {
    expect(namesVenue('Zuma Grill and Bar', 'Zuma', 'Dubai')).toBe(false);
    expect(namesVenue('Zuma London', 'Zuma', 'Dubai')).toBe(false);
    expect(namesVenue('Anything', '', 'Dubai')).toBe(false);
  });
});

describe('centreOf', () => {
  it('is the middle of the places found', () => {
    const centre = centreOf(pool);
    expect(centre?.lat).toBeCloseTo(25.2, 1);
    expect(centre?.lon).toBeCloseTo(55.275, 1);
  });

  it('is not trusted with only a few located places', () => {
    expect(centreOf(pool.slice(0, 3))).toBeNull();
  });
});

describe('checkOriginalVenue', () => {
  const entry = { id: 'v1', name: 'Zuma', location: { lat: 25.205, lon: 55.275 } };

  it('uses the entry from the name search when it lies in the city', () => {
    const check = checkOriginalVenue({ selected: entry, venueName: 'Zuma', city: 'Dubai', pool });
    expect(check.ref).toBe(entry);
    expect(check.location).toEqual(entry.location);
    expect(check.locationFrom).toBe('entry');
    expect(check.note).toBeNull();
  });

  it('does not use an entry that lies in another country', () => {
    const check = checkOriginalVenue({
      selected: { ...entry, location: FAR },
      venueName: 'Zuma',
      city: 'Dubai',
      pool,
    });
    expect(check.ref).toBeNull();
    expect(check.location).toBeNull();
    expect(check.note).toContain('only entry Qloo has under the name Zuma');
    expect(check.note).toContain('distances to the original venue are unknown');
  });

  it('uses the place of that name in the results when the entry lies elsewhere', () => {
    const branch = makeCandidate({
      id: 'branch',
      name: 'Zuma Dubai',
      point: { lat: 25.201, lon: 55.272 },
    });
    const check = checkOriginalVenue({
      selected: { ...entry, location: FAR },
      venueName: 'Zuma',
      city: 'Dubai',
      pool: [...pool, branch],
    });
    expect(check.ref?.id).toBe('branch');
    expect(check.location).toEqual({ lat: 25.201, lon: 55.272 });
    expect(check.locationFrom).toBe('results');
    expect(check.note).toContain('Zuma Dubai');
  });

  it('keeps the entry when too few places have a position to judge by', () => {
    const check = checkOriginalVenue({
      selected: { ...entry, location: FAR },
      venueName: 'Zuma',
      city: 'Dubai',
      pool: pool.slice(0, 2),
    });
    expect(check.ref?.id).toBe('v1');
    expect(check.note).toBeNull();
  });

  it('takes the position from the results when no entry was found', () => {
    const same = makeCandidate({ id: 'same', name: 'Zuma', point: { lat: 25.2, lon: 55.27 } });
    const check = checkOriginalVenue({
      selected: undefined,
      venueName: 'Zuma',
      city: 'Dubai',
      pool: [...pool, same],
    });
    expect(check.ref).toBeNull();
    expect(check.location).toEqual({ lat: 25.2, lon: 55.27 });
  });

  it('names a limit that fits a city but not a country', () => {
    expect(OTHER_CITY_KM).toBeGreaterThan(100);
    expect(OTHER_CITY_KM).toBeLessThan(500);
  });
});
