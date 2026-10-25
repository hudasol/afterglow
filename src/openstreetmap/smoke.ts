import type { CallTrace } from '../domain/case.js';
import type { GeoPoint } from '../domain/geo.js';
import { parseOpeningHours } from '../domain/opening-hours.js';
import { OverpassError, pointKey, type OverpassClient } from './overpass.js';

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
  area: { lat: number; lon: number; radiusM: number };
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

export async function runOsmSmoke(
  client: OverpassClient,
  area: GeoPoint & { radiusM: number },
  now: Date,
): Promise<OsmSmokeReport> {
  const traces: CallTrace[] = [];
  const base = {
    generatedAt: now.toISOString(),
    source: 'OpenStreetMap, through the public Overpass API',
    area,
    openingHours: { present: 0, read: 0, unreadExamples: [] as string[] },
    wheelchair: {} as Record<string, number>,
    dietTagKeys: {} as Record<string, number>,
    capacityPresent: 0,
    traces,
  };

  let venues;
  try {
    const answer = await client.nearby([area], area.radiusM, traces);
    venues = answer.get(pointKey(area)) ?? [];
  } catch (error) {
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
      detail: `${venues.length} named venues within ${area.radiusM} m.`,
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
  return { ...base, venues: venues.length, checks, verdict, reasons };
}
