import type { GeoPoint } from '../domain/geo.js';
import { distanceKm } from '../domain/geo.js';
import { normaliseName } from '../domain/venue.js';
import type { OsmElement } from './overpass.js';

const MIN_CONTAINED_LENGTH = 5;

/**
 * 0 for the same name, 1 when one name is a whole word part of the other (for example "Cafe Luna"
 * and "Luna"), and null for anything else. A short name is never matched by containment, so a
 * place called "Bar" is not taken for every venue with "bar" in its name.
 */
export function nameDistance(a: string, b: string): 0 | 1 | null {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (left === '' || right === '') return null;
  if (left === right) return 0;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length < MIN_CONTAINED_LENGTH) return null;
  return ` ${long} `.includes(` ${short} `) ? 1 : null;
}

/** The OpenStreetMap place that is the same venue, or null when none is close enough in both name and position. */
export function matchElement(
  name: string,
  position: GeoPoint,
  elements: readonly OsmElement[],
): OsmElement | null {
  let best: { element: OsmElement; rank: number; km: number } | null = null;
  for (const element of elements) {
    const tagged = element.tags['name'];
    if (tagged === undefined) continue;
    const rank = nameDistance(name, tagged);
    if (rank === null) continue;
    const km = distanceKm(position, element.position);
    if (best === null || rank < best.rank || (rank === best.rank && km < best.km)) {
      best = { element, rank, km };
    }
  }
  return best?.element ?? null;
}
