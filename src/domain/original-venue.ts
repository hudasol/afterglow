import type { ResolvedRef } from './case.js';
import { isKnown } from './evidence.js';
import { distanceKm, type GeoPoint } from './geo.js';
import { normaliseName, type Candidate } from './venue.js';

/**
 * A name search is not limited to a city, so the one entry that carries the name of the venue can
 * be in another country. Beyond this distance from the places found for the city, an entry is
 * taken to be somewhere else and is not used.
 */
export const OTHER_CITY_KM = 150;

/** The centre is only trusted when the search found enough places with a known position. */
const MIN_LOCATED_PLACES = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle] ?? 0;
  const low = sorted[middle - 1] ?? high;
  return sorted.length % 2 === 1 ? high : (low + high) / 2;
}

/** The middle of the places found for a city, or nothing when too few have a position. */
export function centreOf(pool: readonly Candidate[]): GeoPoint | null {
  const points = pool.flatMap((candidate) =>
    isKnown(candidate.facts.location) ? [candidate.facts.location.value] : [],
  );
  if (points.length < MIN_LOCATED_PLACES) return null;
  return { lat: median(points.map((p) => p.lat)), lon: median(points.map((p) => p.lon)) };
}

/**
 * True when a place in the results is the venue by name. A branch named after its city counts, as
 * in "Zuma Dubai" for "Zuma". Anything looser is left to the person, because a wrong match would
 * remove a good place or measure from the wrong spot.
 */
export function namesVenue(candidateName: string, venueName: string, city: string): boolean {
  const candidate = normaliseName(candidateName);
  const venue = normaliseName(venueName);
  if (venue === '') return false;
  return candidate === venue || candidate === normaliseName(`${venueName} ${city}`);
}

export interface VenueCheck {
  /** The entry to use as a taste signal, or nothing when no entry fits the city. */
  ref: ResolvedRef | null;
  /** Where the venue is, or nothing when that cannot be established. */
  location: GeoPoint | null;
  /** Whether the position came from the name search or from the places found for the city. */
  locationFrom: 'entry' | 'results' | null;
  /** Says what was done when the entry Qloo gave was not used as it came. */
  note: string | null;
}

/**
 * Settles which entry stands for the venue that fell through. The entry from the name search is
 * used when it lies in the city. When it lies elsewhere, the place in the results that carries
 * the venue's name is used instead. When there is no such place, nothing is used and distances
 * to the venue stay unknown, so the person is asked and nothing is ruled out on a wrong position.
 */
export function checkOriginalVenue(input: {
  selected: ResolvedRef | undefined;
  venueName: string;
  city: string;
  pool: readonly Candidate[];
}): VenueCheck {
  const { selected, venueName, city, pool } = input;
  const inPool = pool.find((candidate) => namesVenue(candidate.name, venueName, city));
  const poolLocation =
    inPool && isKnown(inPool.facts.location) ? inPool.facts.location.value : null;
  if (!selected) {
    return {
      ref: null,
      location: poolLocation,
      locationFrom: poolLocation ? 'results' : null,
      note: null,
    };
  }

  const centre = centreOf(pool);
  if (!selected.location || !centre) {
    const location = selected.location ?? poolLocation;
    return {
      ref: selected,
      location,
      locationFrom: selected.location ? 'entry' : location ? 'results' : null,
      note: null,
    };
  }
  const away = distanceKm(selected.location, centre);
  if (away <= OTHER_CITY_KM) {
    return { ref: selected, location: selected.location, locationFrom: 'entry', note: null };
  }

  const rounded = Math.round(away).toLocaleString('en-US');
  if (inPool) {
    return {
      ref: {
        id: inPool.id,
        name: inPool.name,
        type: 'urn:entity:place',
        ...(poolLocation ? { location: poolLocation } : {}),
      },
      location: poolLocation,
      locationFrom: poolLocation ? 'results' : null,
      note: `Qloo's entry named ${selected.name} is about ${rounded} km from the places found in ${city}, so the place called ${inPool.name} in the results was used instead.`,
    };
  }
  return {
    ref: null,
    location: null,
    locationFrom: null,
    note: `The only entry Qloo has under the name ${selected.name} is about ${rounded} km from the places found in ${city}. It was not used as a taste signal or to measure distances, so distances to the original venue are unknown.`,
  };
}
