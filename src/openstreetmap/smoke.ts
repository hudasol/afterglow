import type { CallTrace } from '../domain/case.js';
import type { GeoPoint } from '../domain/geo.js';
import { parseOpeningHours } from '../domain/opening-hours.js';
import { OverpassError, pointKey, type OsmElement, type OverpassClient } from './overpass.js';

/*
 * A small experiment against the real OpenStreetMap data, because the unit tests only use invented
 * responses. It asks for the named venues around one public point and reports how many of them
 * carry the tags AFTERGLOW can use, and how many opening hours values the reader understands. The
 * report holds counts and tag values only. It holds no venue names.
 */

export interface OsmSmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface OsmSmokeReport {
  generatedAt: string;
  source: string;
  area: { lat: number; lon: number; radiusM: number; points: number };
  /** How long the whole query took, as a search would experience it. */
  durationMs: number | null;
  venues: number;
  openingHours: { present: number; read: number; unreadExamples: string[] };
  wheelchair: Record<string, number>;
  dietTagKeys: Record<string, number>;
  capacityPresent: number;
  checks: OsmSmokeCheck[];
  verdict: 'go' | 'conditional' | 'no_go';
  reasons: string[];
  traces: CallTrace[];
}

const MAX_EXAMPLES = 8;

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

const SLOW_MS = 10_000;

/** Points on a square grid, centred on the given point, spaced so their circles overlap a little. */
export function gridAround(centre: GeoPoint, count: number, spacingM: number): GeoPoint[] {
  const side = Math.ceil(Math.sqrt(count));
  const metresPerDegreeLat = 111_320;
  const metresPerDegreeLon = metresPerDegreeLat * Math.cos((centre.lat * Math.PI) / 180);
  const points: GeoPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / side) - (side - 1) / 2;
    const column = (index % side) - (side - 1) / 2;
    points.push({
      lat: centre.lat + (row * spacingM) / metresPerDegreeLat,
      lon: centre.lon + (column * spacingM) / metresPerDegreeLon,
    });
  }
  return points;
}

export async function runOsmSmoke(
  client: OverpassClient,
  request: GeoPoint & { radiusM: number; points?: number },
  now: Date,
): Promise<OsmSmokeReport> {
  const traces: CallTrace[] = [];
  const count = Math.max(1, Math.min(request.points ?? 1, 40));
  const area = { lat: request.lat, lon: request.lon, radiusM: request.radiusM, points: count };
  const base = {
    generatedAt: now.toISOString(),
    source: 'OpenStreetMap, through the public Overpass API',
    area,
    durationMs: null as number | null,
    openingHours: { present: 0, read: 0, unreadExamples: [] as string[] },
    wheelchair: {} as Record<string, number>,
    dietTagKeys: {} as Record<string, number>,
    capacityPresent: 0,
    traces,
  };

  let venues: OsmElement[];
  try {
    const points = gridAround(request, count, request.radiusM * 1.2);
    const answer = await client.nearby(points, request.radiusM, traces);
    const byRef = new Map<string, OsmElement>();
    for (const point of points) {
      for (const element of answer.get(pointKey(point)) ?? []) byRef.set(element.ref, element);
    }
    venues = [...byRef.values()];
    base.durationMs = traces.at(-1)?.durationMs ?? null;
  } catch (error) {
    base.durationMs = traces.at(-1)?.durationMs ?? null;
    const code = error instanceof OverpassError ? error.code : 'OSM_NETWORK';
    return {
      ...base,
      venues: 0,
      checks: [{ name: 'Request accepted', ok: false, detail: `The request failed (${code}).` }],
      verdict: 'no_go',
      reasons: [`OpenStreetMap could not be queried (${code}).`],
    };
  }

  const seen = new Set<string>();
  for (const venue of venues) {
    const hours = venue.tags['opening_hours'];
    if (hours !== undefined) {
      base.openingHours.present += 1;
      if (parseOpeningHours(hours)) base.openingHours.read += 1;
      else if (!seen.has(hours) && base.openingHours.unreadExamples.length < MAX_EXAMPLES) {
        seen.add(hours);
        base.openingHours.unreadExamples.push(hours.slice(0, 120));
      }
    }
    const wheelchair = venue.tags['wheelchair'];
    if (wheelchair !== undefined) bump(base.wheelchair, wheelchair.slice(0, 30));
    for (const key of Object.keys(venue.tags)) {
      if (key.startsWith('diet:')) bump(base.dietTagKeys, key.slice(0, 40));
    }
    if (venue.tags['capacity'] !== undefined) base.capacityPresent += 1;
  }

  const { present, read } = base.openingHours;
  const checks: OsmSmokeCheck[] = [
    { name: 'Request accepted', ok: true, detail: 'OpenStreetMap answered the query.' },
    {
      name: 'Named venues returned',
      ok: venues.length > 0,
      detail: `${venues.length} named venues within ${area.radiusM} m of ${count === 1 ? 'one point' : `${count} points`}.`,
    },
    {
      name: 'Answered in a reasonable time',
      ok: base.durationMs !== null && base.durationMs <= SLOW_MS,
      detail: `The query took ${base.durationMs ?? 'an unknown number of'} ms${traces.at(-1)?.params['host'] ? ` on ${traces.at(-1)?.params['host']}` : ''}.`,
    },
    {
      name: 'Opening hours present',
      ok: present > 0,
      detail: `${present} of ${venues.length} venues carry an opening_hours tag.`,
    },
    {
      name: 'Opening hours understood',
      ok: read > 0 && (present === 0 || read / present >= 0.5),
      detail: `${read} of ${present} opening_hours values were read in full.`,
    },
  ];

  const reasons: string[] = [];
  let verdict: OsmSmokeReport['verdict'] = 'go';
  if (venues.length === 0) {
    verdict = 'no_go';
    reasons.push('No named venues came back, so nothing can be matched.');
  } else if (present === 0 || read === 0) {
    verdict = 'conditional';
    reasons.push('Venues came back, but no opening hours could be used here.');
  } else if (read / present < 0.5) {
    verdict = 'conditional';
    reasons.push('Fewer than half of the opening hours values were understood.');
  }
  if (verdict === 'go' && base.durationMs !== null && base.durationMs > SLOW_MS) {
    verdict = 'conditional';
    reasons.push('The answer was slow, so a search would wait a long time for it.');
  }
  return { ...base, venues: venues.length, checks, verdict, reasons };
}
