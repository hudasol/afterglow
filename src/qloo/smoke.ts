/**
 * The first experiment: does Qloo return useful, signal sensitive results for the calls
 * AFTERGLOW depends on? It runs against the live API and reports facts. It stores no venue data,
 * only counts, key names and rankings of public cultural entities used as probes.
 */
import type { CallTrace, ResolutionKind, TasteResolution } from '../domain/case.js';
import { kendallTau, overlapAtK } from '../domain/metrics.js';
import type { QlooClient } from './client.js';
import { QlooError } from './errors.js';
import {
  asRecord,
  resultArray,
  toCandidate,
  toEntityRef,
  toTagRef,
  toTasteScores,
} from './normalize.js';
import { normaliseName } from '../domain/venue.js';
import { PLACE_TYPE, resolveEntity, resolveTag } from './resolve.js';

export interface SmokeOptions {
  city: string;
  seedA: string;
  seedB: string;
  category: string;
  poolSize: number;
}

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export type SmokeVerdict = 'go' | 'conditional' | 'no_go';

export interface ProbeObservation {
  kind: ResolutionKind;
  input: string;
  status: string;
  candidates: Array<{ name: string; type?: string }>;
  warnings: string[];
  /** Set for the extra lookups that test a request option rather than the product's own lookup. */
  note?: string;
}

export interface TagLookupObservation {
  phrase: string;
  parentFilter: string | null;
  status: string;
  results: Array<{ id: string; name: string; type?: string; parentTypes: string[] }>;
}

export interface SmokeReport {
  generatedAt: string;
  options: SmokeOptions;
  checks: SmokeCheck[];
  verdict: SmokeVerdict;
  reasons: string[];
  /** Observations that do not change the verdict. */
  notes: string[];
  observed: {
    poolSize: number;
    withLocation: number;
    withPriceLevel: number;
    withAddress: number;
    withTags: number;
    withAffinity: number;
    withExplanation: number;
    withPopularity: number;
    entityKeys: string[];
    propertyKeys: string[];
    /** The value type of each property key on the first place, for example price_level: number. No values. */
    propertyShape: Record<string, string>;
    hoursLikeKeys: string[];
    withHours: number;
    withGoodFor: number;
    /** Places in the pool that carry the category tag, when one was used. */
    withCategoryTag: number | null;
    /** Places Qloo marks as closed. The reader does not rely on this field. */
    markedClosed: number;
    /** Qloo's own taxonomy labels seen across the pool, counted. These are labels, not venue data. */
    taxonomy: {
      goodFor: Array<{ name: string; count: number }>;
      tags: Array<{ name: string; type?: string; count: number }>;
    };
    /** Raw tag lookups: what Qloo returns for a phrase, with and without a place parent filter. */
    tagLookups: TagLookupObservation[];
    /** Masked structure of selected nested fields on the first place. Letters and digits are masked. */
    nestedShapes: Record<string, unknown>;
    /** What each probe lookup returned: names and types of public cultural entries, nothing else. */
    probes: ProbeObservation[];
    signalSensitivity: { overlapAt3: number | null; kendallTau: number | null } | null;
    callCount: number;
    callErrors: string[];
  };
}

function keysOf(value: unknown): string[] {
  const record = asRecord(value);
  return record ? Object.keys(record).sort() : [];
}

/** The type of each key, never the value, so a report shows the shape without storing venue data. */
function shapeOf(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => {
        const item = record[key];
        return [key, Array.isArray(item) ? 'array' : item === null ? 'null' : typeof item];
      }),
  );
}

/** A time of day carries no venue identity, so its exact notation is kept to show the format. */
const TIME_OF_DAY = /^T?\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/u;

/** Replaces letters and digits so a string shows its format and nothing else. */
export function maskString(value: string): string {
  return value.slice(0, 32).replace(/[A-Z]/gu, 'A').replace(/[a-z]/gu, 'a').replace(/\d/gu, '9');
}

/**
 * The structure of a value to a limited depth: keys, types and masked string formats, never the
 * values themselves. It lets a report show how opening hours or tags are written without storing
 * venue data.
 */
export function skeletonOf(value: unknown, depth = 0): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return depth >= 4
      ? `array(${value.length})`
      : { array: value.length, first: value.length > 0 ? skeletonOf(value[0], depth + 1) : null };
  }
  if (typeof value === 'string') {
    return TIME_OF_DAY.test(value) ? `time ${value}` : `string ${maskString(value)}`;
  }
  if (typeof value !== 'object') return typeof value;
  if (depth >= 4) return 'object';
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .slice(0, 30)
      .map((key) => [key, skeletonOf((value as Record<string, unknown>)[key], depth + 1)]),
  );
}

function asArrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasAnyHours(value: unknown): boolean {
  const hours = asRecord(value);
  if (!hours) return false;
  return Object.values(hours).some((day) =>
    asArrayOf(day).some((slot) => typeof asRecord(slot)?.['opens'] === 'string'),
  );
}

/** Counts labelled entries such as tags, most frequent first. Only names and types are kept. */
function tally(items: unknown[]): Array<{ name: string; type?: string; count: number }> {
  const counts = new Map<string, { name: string; type?: string; count: number }>();
  for (const item of items) {
    const record = asRecord(item);
    const name = typeof record?.['name'] === 'string' ? record['name'].slice(0, 60) : undefined;
    if (!name) continue;
    const type = typeof record?.['type'] === 'string' ? record['type'].slice(0, 80) : undefined;
    const key = `${type ?? ''}|${name}`;
    const entry = counts.get(key) ?? { name, ...(type ? { type } : {}), count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 60);
}

function observeProbe(resolution: TasteResolution): ProbeObservation {
  const shown = resolution.candidates ?? (resolution.selected ? [resolution.selected] : []);
  return {
    kind: resolution.kind,
    input: resolution.input,
    status: resolution.status,
    candidates: shown.slice(0, 5).map((ref) => ({
      name: ref.name.slice(0, 80),
      ...(ref.type ? { type: ref.type } : {}),
    })),
    warnings: (resolution.warnings ?? []).map((w) => w.slice(0, 200)),
  };
}

export async function runSmoke(
  client: QlooClient,
  options: SmokeOptions,
  now: Date,
): Promise<SmokeReport> {
  const checks: SmokeCheck[] = [];
  const reasons: string[] = [];
  const notes: string[] = [];
  const traces: CallTrace[] = [];
  const observed: SmokeReport['observed'] = {
    poolSize: 0,
    withLocation: 0,
    withPriceLevel: 0,
    withAddress: 0,
    withTags: 0,
    withAffinity: 0,
    withExplanation: 0,
    withPopularity: 0,
    entityKeys: [],
    propertyKeys: [],
    propertyShape: {},
    hoursLikeKeys: [],
    tagLookups: [],
    withHours: 0,
    withGoodFor: 0,
    withCategoryTag: null,
    markedClosed: 0,
    taxonomy: { goodFor: [], tags: [] },
    nestedShapes: {},
    probes: [],
    signalSensitivity: null,
    callCount: 0,
    callErrors: [],
  };
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const finish = (verdict: SmokeVerdict): SmokeReport => {
    observed.callCount = traces.length;
    observed.callErrors = traces.filter((t) => t.error).map((t) => `${t.endpoint}: ${t.error}`);
    return { generatedAt: now.toISOString(), options, checks, verdict, reasons, notes, observed };
  };

  // 1. Reachability and authentication.
  try {
    await client.get('/search', { query: options.seedA, take: 1 }, traces, { bypassCache: true });
    check(
      'reachability and authentication',
      true,
      'Qloo accepted an authenticated search request.',
    );
  } catch (error) {
    const code = error instanceof QlooError ? error.code : 'QLOO_NETWORK';
    check('reachability and authentication', false, `Failed with ${code}.`);
    reasons.push(`Qloo could not be used: ${code}.`);
    return finish('no_go');
  }

  // 2. Entity resolution for the two probe signals.
  const resolutions = [];
  for (const seed of [options.seedA, options.seedB]) {
    resolutions.push(await resolveEntity(client, 'entity', seed, options.city, traces));
  }
  observed.probes.push(...resolutions.map(observeProbe));
  // The ranking checks below test the ranking calls. They go ahead with the first candidate of an
  // ambiguous probe so that a naming question does not hide whether ranking works. The product
  // never does this: it asks the person to choose.
  const entityA = resolutions[0]?.selected ?? resolutions[0]?.candidates?.[0];
  const entityB = resolutions[1]?.selected ?? resolutions[1]?.candidates?.[0];
  // A name that several entries share is not a failure. The product asks the person to choose.
  // Only a name that matched nothing exactly, or nothing at all, means the lookup does not work.
  const sharedName = (r: TasteResolution) =>
    r.status === 'ambiguous' &&
    (r.candidates?.length ?? 0) > 0 &&
    (r.candidates ?? []).every((c) => normaliseName(c.name) === normaliseName(r.input));
  check(
    'entity resolution',
    resolutions.every((r) => r.status === 'resolved' || sharedName(r)),
    resolutions
      .map((r) =>
        r.status === 'resolved'
          ? `${r.input}: one exact entry`
          : sharedName(r)
            ? `${r.input}: ${r.candidates?.length ?? 0} exact entries, the person chooses`
            : `${r.input}: ${r.status}`,
      )
      .join('; '),
  );
  // Does the search accept a type filter, and does it narrow an ambiguous name? Information only.
  for (const [seed, type] of [
    [options.seedA, 'urn:entity:artist'],
    [options.seedB, 'urn:entity:artist'],
  ] as const) {
    try {
      const typed = await client.get('/search', { query: seed, take: 5, types: type }, traces);
      const refs = resultArray(typed, 'entities')
        .map(toEntityRef)
        .filter((ref): ref is NonNullable<typeof ref> => ref !== undefined);
      observed.probes.push({
        kind: 'entity',
        input: seed,
        status: `typed search returned ${refs.length}`,
        candidates: refs.slice(0, 5).map((ref) => ({
          name: ref.name.slice(0, 80),
          ...(ref.type ? { type: ref.type } : {}),
        })),
        warnings: [],
        note: `search with types=${type}`,
      });
    } catch (error) {
      observed.probes.push({
        kind: 'entity',
        input: seed,
        status: `typed search failed with ${error instanceof QlooError ? error.code : 'an error'}`,
        candidates: [],
        warnings: [],
        note: `search with types=${type}`,
      });
    }
  }
  if (!entityA || !entityB) {
    reasons.push('A probe entity returned no candidate, so the ranking checks were skipped.');
  } else if (resolutions.some((r) => r.status !== 'resolved')) {
    notes.push(
      'A probe name matched more than one entry. The ranking checks used the first candidate. The product asks the person to choose in this case.',
    );
  }

  // 3. Tag resolution, including the category tag scoped to places.
  const category = await resolveTag(client, 'category', options.category, traces, PLACE_TYPE);
  check(
    'category tag resolution',
    category.status === 'resolved',
    `${options.category}: ${category.status}`,
  );
  observed.probes.push(observeProbe(category));
  const vibe = await resolveTag(client, 'tag', 'jazz', traces);
  observed.probes.push(observeProbe(vibe));
  check(
    'tag resolution for a vibe phrase',
    vibe.status !== 'not_found',
    `jazz: ${vibe.status} (${vibe.candidates?.length ?? (vibe.selected ? 1 : 0)} candidates)`,
  );

  // Raw tag lookups, to see which tags apply to places. Information only.
  for (const phrase of [options.category, 'jazz']) {
    for (const parentFilter of [null, PLACE_TYPE]) {
      try {
        const raw = await client.get(
          '/v2/tags',
          {
            'filter.query': phrase,
            'feature.semantic_search': true,
            take: 20,
            ...(parentFilter ? { 'filter.parents.types': parentFilter } : {}),
          },
          traces,
          { bypassCache: true },
        );
        const tags = resultArray(raw, 'tags')
          .map(toTagRef)
          .filter((tag): tag is NonNullable<typeof tag> => tag !== undefined);
        observed.tagLookups.push({
          phrase,
          parentFilter,
          status: `${tags.length} returned`,
          results: tags.slice(0, 12).map((tag) => ({
            id: tag.id,
            name: tag.name.slice(0, 60),
            ...(tag.type ? { type: tag.type } : {}),
            parentTypes: tag.parentTypes.slice(0, 6),
          })),
        });
      } catch (error) {
        observed.tagLookups.push({
          phrase,
          parentFilter,
          status: `failed with ${error instanceof QlooError ? error.code : 'an error'}`,
          results: [],
        });
      }
    }
  }

  // 4. The candidate pool for the city.
  let poolResponse: unknown;
  try {
    poolResponse = await client.get(
      '/v2/insights',
      {
        'filter.type': PLACE_TYPE,
        'filter.location.query': options.city,
        ...(category.selected ? { 'filter.tags': category.selected.id } : {}),
        take: options.poolSize,
      },
      traces,
      { bypassCache: true },
    );
  } catch (error) {
    const code = error instanceof QlooError ? error.code : 'QLOO_NETWORK';
    check('place pool for the city', false, `Failed with ${code}.`);
    reasons.push(`The place pool request failed with ${code}.`);
    return finish('no_go');
  }
  const rawPlaces = resultArray(poolResponse, 'entities');
  const candidates = rawPlaces
    .map((place) => toCandidate(place, now.toISOString()))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
  observed.poolSize = candidates.length;
  observed.withLocation = candidates.filter((c) => c.facts.location.status === 'known').length;
  observed.withPriceLevel = candidates.filter((c) => c.facts.priceLevel.status === 'known').length;
  observed.withAddress = candidates.filter((c) => c.facts.address.status === 'known').length;
  observed.withTags = candidates.filter((c) => (c.taste.tagNames?.length ?? 0) > 0).length;
  observed.withPopularity = candidates.filter((c) => c.taste.popularity !== undefined).length;
  const records = rawPlaces
    .map(asRecord)
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  observed.withHours = records.filter((r) =>
    hasAnyHours(asRecord(r['properties'])?.['hours']),
  ).length;
  observed.withGoodFor = records.filter(
    (r) => (asArrayOf(asRecord(r['properties'])?.['good_for']).length ?? 0) > 0,
  ).length;
  observed.taxonomy = {
    goodFor: tally(records.flatMap((r) => asArrayOf(asRecord(r['properties'])?.['good_for']))).map(
      ({ name, count }) => ({ name, count }),
    ),
    tags: tally(records.flatMap((r) => asArrayOf(r['tags']))),
  };
  if (category.selected) {
    const wantedId = category.selected.id;
    observed.withCategoryTag = records.filter((r) =>
      asArrayOf(r['tags']).some((tag) => asRecord(tag)?.['id'] === wantedId),
    ).length;
  }
  observed.markedClosed = records.filter(
    (r) => asRecord(r['properties'])?.['is_closed'] === true,
  ).length;
  const first = asRecord(rawPlaces[0]);
  observed.entityKeys = keysOf(first);
  observed.propertyKeys = keysOf(first?.['properties']);
  observed.propertyShape = shapeOf(first?.['properties']);
  observed.hoursLikeKeys = [...observed.entityKeys, ...observed.propertyKeys].filter((key) =>
    /hour|open|close|schedule/iu.test(key),
  );
  const nestedKeys = [
    'hours',
    'is_closed',
    'price_range',
    'price_level',
    'good_for',
    'locality',
    'geocode',
    'business_rating',
    'primary_genre',
  ];
  for (const key of nestedKeys) {
    const value = asRecord(first?.['properties'])?.[key];
    if (value !== undefined) observed.nestedShapes[`properties.${key}`] = skeletonOf(value);
  }
  for (const key of [
    'location',
    'tags',
    'external',
    'references',
    'query',
    'disambiguation',
    'type',
    'subtype',
  ]) {
    const value = first?.[key];
    if (value !== undefined) observed.nestedShapes[key] = skeletonOf(value);
  }
  if (category.selected) {
    const share = records.length === 0 ? 0 : (observed.withCategoryTag ?? 0) / records.length;
    check(
      'category filter narrows the pool',
      share >= 0.5,
      `${observed.withCategoryTag} of ${records.length} places carry the tag ${category.selected.id}.`,
    );
  }
  check(
    'place pool for the city',
    candidates.length >= 10,
    `${candidates.length} places returned for ${options.city}.`,
  );
  if (candidates.length < 10) {
    reasons.push(
      `Only ${candidates.length} places came back for ${options.city}. Try a larger city.`,
    );
    return finish('no_go');
  }

  // 5. Ranking the identical pool with each probe signal.
  const ids = candidates.map((candidate) => candidate.id);
  const idSet = new Set(ids);
  const rankWith = async (entityId: string) => {
    const response = await client.get(
      '/v2/insights',
      {
        'filter.type': PLACE_TYPE,
        'filter.results.entities': ids,
        'signal.interests.entities': [entityId],
        'feature.explainability': true,
        take: ids.length,
      },
      traces,
      { bypassCache: true },
    );
    return { response, scores: toTasteScores(response, idSet) };
  };

  if (entityA && entityB) {
    try {
      const a = await rankWith(entityA.id);
      const b = await rankWith(entityB.id);
      observed.withAffinity = a.scores.filter((s) => s.affinity !== undefined).length;
      observed.withExplanation = a.scores.filter((s) => (s.explanation?.length ?? 0) > 0).length;
      const coverage = a.scores.length / ids.length;
      check(
        'rank over a fixed pool',
        coverage >= 0.8,
        `${a.scores.length} of ${ids.length} places received a score (${Math.round(coverage * 100)}%).`,
      );
      const orderA = a.scores.map((s) => s.candidateId);
      const orderB = b.scores.map((s) => s.candidateId);
      const sensitivity = {
        overlapAt3: overlapAtK(orderA, orderB, 3),
        kendallTau: kendallTau(orderA, orderB),
      };
      observed.signalSensitivity = sensitivity;
      const differs = sensitivity.kendallTau !== null && sensitivity.kendallTau < 0.95;
      check(
        'signal sensitivity',
        differs,
        `Two different probe signals gave Kendall tau ${sensitivity.kendallTau?.toFixed(2) ?? 'n/a'} and top three overlap ${sensitivity.overlapAt3 === null ? 'n/a' : Math.round(sensitivity.overlapAt3 * 100) + '%'}.`,
      );
      if (coverage < 0.8)
        reasons.push(
          'Qloo scored fewer than 80% of the pool, so Taste On would leave many places unscored.',
        );
      if (!differs)
        reasons.push(
          'Different taste signals produced nearly identical rankings, so taste may not change decisions here.',
        );
    } catch (error) {
      const code = error instanceof QlooError ? error.code : 'QLOO_NETWORK';
      check('rank over a fixed pool', false, `Failed with ${code}.`);
      reasons.push(`Ranking a fixed pool failed with ${code}.`);
      return finish('no_go');
    }

    // 6. The venue that fell through as a signal: a place entity used as a taste signal.
    const lostVenueId = ids[0];
    if (lostVenueId) {
      try {
        const response = await client.get(
          '/v2/insights',
          {
            'filter.type': PLACE_TYPE,
            'filter.results.entities': ids,
            'signal.interests.entities': [lostVenueId],
            take: ids.length,
          },
          traces,
          { bypassCache: true },
        );
        const scored = toTasteScores(response, idSet).length;
        check(
          'a place as a taste signal',
          scored > 0,
          `${scored} of ${ids.length} places were scored when a place entity was the only signal.`,
        );
        if (scored === 0)
          reasons.push(
            'A place entity was not usable as a taste signal, so the lost venue signal will not help.',
          );
      } catch (error) {
        const code = error instanceof QlooError ? error.code : 'QLOO_NETWORK';
        check(
          'a place as a taste signal',
          false,
          `Failed with ${code}. The lost venue signal would have no effect.`,
        );
        reasons.push('A place entity was not accepted as a taste signal.');
      }
    }

    // 7. Tag signals alongside entity signals.
    if (vibe.selected || vibe.candidates?.[0]) {
      const tagId = (vibe.selected ?? vibe.candidates?.[0])?.id as string;
      try {
        await client.get(
          '/v2/insights',
          {
            'filter.type': PLACE_TYPE,
            'filter.results.entities': ids,
            'signal.interests.entities': [entityA.id],
            'signal.interests.tags': [tagId],
            take: ids.length,
          },
          traces,
          { bypassCache: true },
        );
        check(
          'entity and tag signals together',
          true,
          'Qloo accepted entity and tag signals in one ranking request.',
        );
      } catch (error) {
        const code = error instanceof QlooError ? error.code : 'QLOO_NETWORK';
        check(
          'entity and tag signals together',
          false,
          `Failed with ${code}. The product will fall back to entity signals and say so.`,
        );
        reasons.push('Tag signals were not accepted together with entity signals.');
      }
    }
  }

  const failed = checks.filter((c) => !c.ok);
  if (observed.withLocation === 0)
    reasons.push(
      'No place carried coordinates in a recognised shape, so distance limits will stay unverified.',
    );
  if (observed.withPriceLevel === 0)
    reasons.push('No place carried a usable price level, so price limits will stay unverified.');
  const verdict: SmokeVerdict =
    failed.length === 0 && observed.withLocation > 0
      ? 'go'
      : failed.some((c) => c.name === 'signal sensitivity' || c.name === 'rank over a fixed pool')
        ? 'no_go'
        : 'conditional';
  return finish(verdict);
}
