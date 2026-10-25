import type { ResolvedRef } from '../domain/case.js';
import { known, unknown, type Fact } from '../domain/evidence.js';
import { isValidPoint, type GeoPoint } from '../domain/geo.js';
import type { Candidate, TasteScore } from '../domain/venue.js';
import type { FactContext } from '../domain/fact-context.js';
import { readDietary, readOpenWindow, readStepFree, type ReadFact } from './facts.js';

type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Results arrive either as an array or as an object keyed by result kind. */
export function resultArray(response: unknown, key: string): unknown[] {
  const root = asRecord(response);
  if (!root) return [];
  const results = root['results'];
  if (Array.isArray(results)) return results;
  const keyed = asRecord(results);
  if (!keyed) return [];
  const inner = keyed[key];
  if (Array.isArray(inner)) return inner;
  for (const value of Object.values(keyed)) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

/**
 * Reads a point only from an object with explicitly named latitude and longitude. A bare array
 * is ignored because its axis order is ambiguous and a swapped pair would give a wrong distance.
 */
export function readPoint(value: unknown): GeoPoint | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const lat = num(record['lat']) ?? num(record['latitude']);
  const lon = num(record['lon']) ?? num(record['lng']) ?? num(record['longitude']);
  if (lat === undefined || lon === undefined) return undefined;
  const point = { lat, lon };
  return isValidPoint(point) ? point : undefined;
}

function entityPoint(record: JsonRecord): GeoPoint | undefined {
  const properties = asRecord(record['properties']);
  return (
    readPoint(record['location']) ??
    readPoint(properties?.['location']) ??
    readPoint(properties?.['geocode'])
  );
}

function entityType(record: JsonRecord): string | undefined {
  const direct = str(record['subtype']) ?? str(record['type']);
  if (direct) return direct;
  const types = asArray(record['types']).filter((t): t is string => typeof t === 'string');
  return types.find((t) => t.startsWith('urn:entity:')) ?? types[0];
}

export function toEntityRef(value: unknown): ResolvedRef | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = str(record['entity_id']) ?? str(record['id']);
  const name = str(record['name']);
  if (!id || !name) return undefined;
  const properties = asRecord(record['properties']);
  const type = entityType(record);
  const description =
    str(record['short_description']) ??
    str(properties?.['short_description']) ??
    str(record['description']) ??
    str(properties?.['description']) ??
    str(properties?.['address']);
  const location = entityPoint(record);
  return {
    id,
    name,
    ...(type ? { type } : {}),
    ...(description ? { description: description.slice(0, 500) } : {}),
    ...(location ? { location } : {}),
  };
}

export interface TagRef extends ResolvedRef {
  parentTypes: string[];
}

export function toTagRef(value: unknown): TagRef | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const id = str(record['id']) ?? str(record['tag_id']);
  const name = str(record['name']);
  if (!id || !name) return undefined;
  const type = str(record['type']) ?? str(record['subtype']);
  const parentTypes = [
    ...new Set(
      asArray(record['parents'])
        .map((parent) => str(asRecord(parent)?.['type']))
        .filter((t): t is string => t !== undefined),
    ),
  ].slice(0, 20);
  return { id, name, ...(type ? { type } : {}), parentTypes };
}

function integerInRange(value: unknown, min: number, max: number): number | undefined {
  const n = num(value);
  return n !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

function tagNamesOf(record: JsonRecord): string[] {
  const properties = asRecord(record['properties']);
  const raw = [...asArray(record['tags']), ...asArray(properties?.['tags'])];
  const names = raw
    .map((tag) => (typeof tag === 'string' ? tag : str(asRecord(tag)?.['name'])))
    .filter((name): name is string => !!name);
  return [...new Set(names)].slice(0, 40);
}

/**
 * Builds a candidate from a Qloo place entity. A fact is recorded only when the response states
 * it in a shape the readers in facts.ts recognise. Opening hours, wheelchair access and dietary
 * options are read when the plan context is given, because they have to be judged for the day and
 * the requirements of the plan. Group capacity and covered seating are not stated by Qloo, so they
 * stay unknown until the person checks them or another source supplies them.
 */
export function toCandidate(
  value: unknown,
  retrievedAt: string,
  context?: FactContext,
): Candidate | undefined {
  const record = asRecord(value);
  const ref = toEntityRef(value);
  if (!record || !ref) return undefined;
  const properties = asRecord(record['properties']);
  const provenance = (label: string) => ({ source: 'qloo' as const, label, retrievedAt });

  const address = str(properties?.['address']) ?? str(record['address']);
  const price = integerInRange(properties?.['price_level'] ?? record['price_level'], 1, 4);
  const popularity = num(record['popularity']);
  const imageProps = asRecord(properties?.['image']);
  const imageUrl = str(properties?.['image']) ?? str(imageProps?.['url']);
  const tagNames = tagNamesOf(record);

  const missing = (what: string): Fact<never> => unknown(`Qloo does not state ${what}`);
  const fromRead = <T>(read: ReadFact<T> | null, label: string, absent: string): Fact<T> =>
    read
      ? known(read.value, { ...provenance(label), detail: read.evidence.slice(0, 500) })
      : unknown(absent);

  return {
    id: ref.id,
    source: 'qloo',
    name: ref.name,
    ...(ref.description ? { description: ref.description } : {}),
    ...(imageUrl && imageUrl.startsWith('https://') ? { imageUrl: imageUrl.slice(0, 500) } : {}),
    facts: {
      address: address
        ? known(address.slice(0, 300), provenance('Qloo place address'))
        : unknown('Qloo returned no address'),
      location: ref.location
        ? known(ref.location, provenance('Qloo place location'))
        : unknown('Qloo returned no coordinates'),
      priceLevel:
        price !== undefined
          ? known(price, provenance('Qloo price level'))
          : unknown('Qloo returned no price level'),
      dietary: fromRead(
        context ? readDietary(record['tags'], context.dietaryNeeded) : null,
        'Qloo dietary option tags',
        'Qloo does not list every dietary option the plan needs for this place',
      ),
      stepFree: fromRead(
        readStepFree(record['tags']),
        'Qloo accessibility tag',
        'Qloo does not state step free access for this place',
      ),
      openWindow: fromRead(
        context ? readOpenWindow(properties?.['hours'], context) : null,
        'Qloo opening hours',
        'Qloo gave no readable opening hours for this place',
      ),
      groupCapacity: missing('the group capacity of a place'),
      covered: missing('whether the seating is covered'),
    },
    taste: {
      ...(popularity !== undefined ? { popularity } : {}),
      ...(tagNames.length > 0 ? { tagNames } : {}),
    },
  };
}

function explanationOf(record: JsonRecord): string[] | undefined {
  const query = asRecord(record['query']);
  const raw = query?.['explainability'];
  if (raw === undefined || raw === null) return undefined;
  const lines: string[] = [];
  const push = (text: string | undefined) => {
    if (text) lines.push(text.slice(0, 300));
  };
  if (Array.isArray(raw)) {
    for (const item of raw.slice(0, 5)) {
      if (typeof item === 'string') push(item);
      else {
        const entry = asRecord(item);
        push(
          str(entry?.['description']) ??
            str(entry?.['name']) ??
            str(entry?.['label']) ??
            JSON.stringify(item),
        );
      }
    }
  } else if (typeof raw === 'string') {
    push(raw);
  } else {
    push(JSON.stringify(raw));
  }
  return lines.length > 0 ? lines.slice(0, 5) : undefined;
}

/** Converts an insights response into ranked taste scores. Provider order is the rank. */
export function toTasteScores(response: unknown, allowedIds: ReadonlySet<string>): TasteScore[] {
  const scores: TasteScore[] = [];
  const seen = new Set<string>();
  for (const value of resultArray(response, 'entities')) {
    const record = asRecord(value);
    const ref = toEntityRef(value);
    if (!record || !ref || !allowedIds.has(ref.id) || seen.has(ref.id)) continue;
    seen.add(ref.id);
    const query = asRecord(record['query']);
    const affinity = num(record['affinity']) ?? num(query?.['affinity']);
    const explanation = explanationOf(record);
    scores.push({
      candidateId: ref.id,
      rank: scores.length + 1,
      ...(affinity !== undefined ? { affinity } : {}),
      ...(explanation ? { explanation } : {}),
    });
  }
  return scores;
}
