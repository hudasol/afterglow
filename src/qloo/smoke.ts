/**
 * The first experiment: does Qloo return useful, signal sensitive results for the calls
 * AFTERGLOW depends on? It runs against the live API and reports facts. It stores no venue data,
 * only counts, key names and rankings of public cultural entities used as probes.
 */
import type { CallTrace } from '../domain/case.js';
import { kendallTau, overlapAtK } from '../domain/metrics.js';
import type { QlooClient } from './client.js';
import { QlooError } from './errors.js';
import { asRecord, resultArray, toCandidate, toTasteScores } from './normalize.js';
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

export interface SmokeReport {
  generatedAt: string;
  options: SmokeOptions;
  checks: SmokeCheck[];
  verdict: SmokeVerdict;
  reasons: string[];
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

export async function runSmoke(
  client: QlooClient,
  options: SmokeOptions,
  now: Date,
): Promise<SmokeReport> {
  const checks: SmokeCheck[] = [];
  const reasons: string[] = [];
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
    signalSensitivity: null,
    callCount: 0,
    callErrors: [],
  };
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const finish = (verdict: SmokeVerdict): SmokeReport => {
    observed.callCount = traces.length;
    observed.callErrors = traces.filter((t) => t.error).map((t) => `${t.endpoint}: ${t.error}`);
    return { generatedAt: now.toISOString(), options, checks, verdict, reasons, observed };
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
  const entityA = resolutions[0]?.selected;
  const entityB = resolutions[1]?.selected;
  check(
    'entity resolution',
    resolutions.every((r) => r.status === 'resolved'),
    resolutions
      .map(
        (r) =>
          `${r.input}: ${r.status}${r.status === 'ambiguous' ? ` (${r.candidates?.length ?? 0} candidates)` : ''}`,
      )
      .join('; '),
  );
  if (!entityA || !entityB) {
    reasons.push(
      'A probe entity did not resolve to a single exact match. Choose different probe names with --seed-a and --seed-b.',
    );
  }

  // 3. Tag resolution, including the category tag scoped to places.
  const category = await resolveTag(client, 'category', options.category, traces, PLACE_TYPE);
  check(
    'category tag resolution',
    category.status === 'resolved',
    `${options.category}: ${category.status}`,
  );
  const vibe = await resolveTag(client, 'tag', 'jazz', traces);
  check(
    'tag resolution for a vibe phrase',
    vibe.status !== 'not_found',
    `jazz: ${vibe.status} (${vibe.candidates?.length ?? (vibe.selected ? 1 : 0)} candidates)`,
  );

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
  const first = asRecord(rawPlaces[0]);
  observed.entityKeys = keysOf(first);
  observed.propertyKeys = keysOf(first?.['properties']);
  observed.propertyShape = shapeOf(first?.['properties']);
  observed.hoursLikeKeys = [...observed.entityKeys, ...observed.propertyKeys].filter((key) =>
    /hour|open|close|schedule/iu.test(key),
  );
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
