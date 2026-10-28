/**
 * A read only experiment on how the signals sent to Qloo change the ranking of a fixed pool.
 *
 *   npm run qloo:explore -- evaluation/live-scenarios.json [scenario id ...]
 *
 * For every scenario it opens the case as the product does, then ranks the same pool again with
 * other forms of the same plan and prints a comparison. It writes no results file. It needs
 * QLOO_API_KEY. Every value printed is a count, a public name or an identifier.
 *
 * The forms compared are:
 *   current      what the product sent when the case opened
 *   names        only the names the group likes and the venue that fell through
 *   exemplars    places that carry the vibe, found in Qloo, sent as entity signals in place of the tag
 *   names+ex     the names together with those exemplars
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CallTrace } from '../domain/case.js';
import { loadConfig } from '../infrastructure/config.js';
import { openCaseView } from '../evaluation/runner.js';
import { QlooClient } from '../qloo/client.js';
import { resultArray, toEntityRef, toTasteScores } from '../qloo/normalize.js';
import { QlooTasteProvider } from '../qloo/provider.js';
import { PLACE_TYPE } from '../qloo/resolve.js';
import type { ScenarioSpec } from '../simulation/scenarios.js';

const EXEMPLARS_PER_TAG = 3;
const MAX_ENTITY_SIGNALS = 8;
const TOP = 3;

interface Row {
  form: string;
  entitySignals: number;
  seconds: number | null;
  error?: string;
  scored: number;
  spread: number | null;
  top: string[];
  /** Share of the top three that carry a tag the person asked for, among those with tags. */
  vibeShare: number | null;
  overlapWithNearest: number | null;
}

interface Scenario {
  id: string;
  poolSize: number;
  eligible: number;
  /** Share of eligible places that carry a requested tag, which is what a random pick would reach. */
  baseVibeShare: number | null;
  nearestVibeShare: number | null;
  rows: Row[];
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

async function main(): Promise<void> {
  const [file, ...only] = process.argv.slice(2);
  if (!file) throw new Error('Usage: qloo-explore <scenarios.json> [id ...]');
  const config = loadConfig();
  if (!config.QLOO_API_KEY) {
    console.error('QLOO_API_KEY is not set, so nothing was requested.');
    process.exitCode = 2;
    return;
  }
  const client = new QlooClient({
    apiKey: config.QLOO_API_KEY,
    baseUrl: config.QLOO_API_URL,
    timeoutMs: config.QLOO_TIMEOUT_MS,
    dailyCallCap: config.QLOO_DAILY_CALL_CAP,
  });
  const provider = new QlooTasteProvider(client);
  const specs = (
    JSON.parse(readFileSync(resolve(file), 'utf8')) as Array<ScenarioSpec & { id: string }>
  ).filter((s) => only.length === 0 || only.includes(s.id));

  const results: Scenario[] = [];
  for (const spec of specs) {
    const opened = await openCaseView(provider, spec);
    try {
      const { view } = opened;
      const eligible = view.options.filter((o) => o.feasibility !== 'rejected');
      const poolIds = new Set(view.options.map((o) => o.candidate.id));
      const carries = (id: string) => {
        const option = view.options.find((o) => o.candidate.id === id);
        return option && (option.candidate.taste.tagNames?.length ?? 0) > 0
          ? option.matchedTags.length > 0
          : null;
      };
      const vibeShare = (ids: string[]): number | null => {
        const known = ids.map(carries).filter((v): v is boolean => v !== null);
        return known.length === 0 ? null : known.filter(Boolean).length / known.length;
      };
      const byDistance = [...eligible].sort(
        (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
      );
      const nearest = byDistance.slice(0, TOP).map((o) => o.candidate.id);

      const entities = view.resolutions
        .filter((r) => r.kind === 'entity' && r.selected)
        .map((r) => r.selected?.id)
        .filter((id): id is string => id !== undefined);
      const lost = view.run?.appliedSignals.lostVenue
        ? view.resolutions.find((r) => r.kind === 'original_venue')?.selected?.id
        : undefined;
      const names = [...entities, ...(lost ? [lost] : [])];
      const tagIds = view.resolutions
        .filter((r) => r.kind === 'tag' && r.selected)
        .flatMap((r) => [r.selected?.id, ...(r.alsoUsed ?? []).map((t) => t.id)])
        .filter((id): id is string => id !== undefined);

      const exemplars = async (scope: 'global' | 'city'): Promise<string[]> => {
        const found: string[] = [];
        for (const tagId of tagIds) {
          const response = await client.get(
            '/v2/insights',
            {
              'filter.type': PLACE_TYPE,
              'filter.tags': tagId,
              ...(scope === 'city' ? { 'filter.location.query': view.anchor.city } : {}),
              take: scope === 'city' ? 12 : EXEMPLARS_PER_TAG + 2,
            },
            [] as CallTrace[],
          );
          const ids = resultArray(response, 'entities')
            .map((value) => toEntityRef(value)?.id)
            .filter((id): id is string => id !== undefined)
            // A place that is part of the pool would score itself, so exemplars come from outside it.
            .filter((id) => !poolIds.has(id))
            .slice(0, EXEMPLARS_PER_TAG);
          found.push(...ids);
        }
        return [...new Set(found)];
      };

      const rank = async (form: string, entityIds: string[], tags: string[]): Promise<Row> => {
        const started = Date.now();
        try {
          const ids = view.options.map((o) => o.candidate.id);
          const response = await client.get(
            '/v2/insights',
            {
              'filter.type': PLACE_TYPE,
              'filter.results.entities': ids,
              take: ids.length,
              ...(entityIds.length > 0 ? { 'signal.interests.entities': entityIds } : {}),
              ...(tags.length > 0 ? { 'signal.interests.tags': tags } : {}),
            },
            [] as CallTrace[],
            { timeoutMs: 40_000, maxAttempts: 1, bypassCache: true },
          );
          const scores = toTasteScores(response, new Set(ids));
          const affinity = new Map(scores.map((s) => [s.candidateId, s.affinity]));
          const values = scores.map((s) => s.affinity).filter((v): v is number => v !== undefined);
          const order = [...eligible].sort((a, b) => {
            const x = affinity.get(a.candidate.id);
            const y = affinity.get(b.candidate.id);
            if (x !== undefined && y !== undefined && x !== y) return y - x;
            if (x !== undefined && y === undefined) return -1;
            if (x === undefined && y !== undefined) return 1;
            return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
          });
          const top = order.slice(0, TOP).map((o) => o.candidate.id);
          return {
            form,
            entitySignals: entityIds.length,
            seconds: Math.round((Date.now() - started) / 100) / 10,
            scored: scores.length,
            spread: values.length > 1 ? Math.max(...values) - Math.min(...values) : null,
            top: top.map(
              (id) => view.options.find((o) => o.candidate.id === id)?.candidate.name ?? id,
            ),
            vibeShare: vibeShare(top),
            overlapWithNearest: top.filter((id) => nearest.includes(id)).length / TOP,
          };
        } catch (error) {
          return {
            form,
            entitySignals: entityIds.length,
            seconds: Math.round((Date.now() - started) / 100) / 10,
            error: error instanceof Error ? error.message.slice(0, 160) : 'failed',
            scored: 0,
            spread: null,
            top: [],
            vibeShare: null,
            overlapWithNearest: null,
          };
        }
      };

      const rows: Row[] = [];
      const currentTop = [...eligible]
        .filter((o) => o.tasteOn)
        .sort((a, b) => (a.tasteOn?.position ?? 99) - (b.tasteOn?.position ?? 99))
        .slice(0, TOP)
        .map((o) => o.candidate.id);
      const currentAffinities = view.options
        .map((o) => o.providerTaste?.affinity)
        .filter((v): v is number => typeof v === 'number');
      rows.push({
        form: 'current',
        entitySignals: names.length,
        seconds: null,
        scored: view.options.filter((o) => o.providerTaste).length,
        spread:
          currentAffinities.length > 1
            ? Math.max(...currentAffinities) - Math.min(...currentAffinities)
            : null,
        top: currentTop.map(
          (id) => view.options.find((o) => o.candidate.id === id)?.candidate.name ?? id,
        ),
        vibeShare: vibeShare(currentTop),
        overlapWithNearest: currentTop.filter((id) => nearest.includes(id)).length / TOP,
      });
      if (names.length > 0) rows.push(await rank('names', names, []));
      if (tagIds.length > 0) {
        const globalIds = await exemplars('global');
        if (globalIds.length > 0) {
          rows.push(await rank('exemplars_global', globalIds.slice(0, MAX_ENTITY_SIGNALS), []));
          if (names.length > 0) {
            rows.push(
              await rank(
                'names_and_exemplars_global',
                [...names, ...globalIds].slice(0, MAX_ENTITY_SIGNALS),
                [],
              ),
            );
          }
        }
        const cityIds = await exemplars('city');
        if (cityIds.length > 0) {
          rows.push(await rank('exemplars_city', cityIds.slice(0, MAX_ENTITY_SIGNALS), []));
        }
      }
      results.push({
        id: spec.id,
        poolSize: view.options.length,
        eligible: eligible.length,
        baseVibeShare: vibeShare(eligible.map((o) => o.candidate.id)),
        nearestVibeShare: vibeShare(nearest),
        rows,
      });
      const last = results[results.length - 1];
      if (last) console.error(`done ${last.id}: ${last.rows.map((r) => r.form).join(', ')}`);
    } finally {
      opened.close();
    }
  }

  const forms = [...new Set(results.flatMap((s) => s.rows.map((r) => r.form)))];
  const summary = forms.map((form) => {
    const rows = results.flatMap((s) => s.rows.filter((r) => r.form === form && !r.error));
    return {
      form,
      scenarios: rows.length,
      meanScoredShare: mean(
        results.flatMap((s) =>
          s.rows
            .filter((r) => r.form === form && !r.error)
            .map((r) => r.scored / Math.max(1, s.poolSize)),
        ),
      ),
      meanSpread: mean(rows.map((r) => r.spread).filter((v): v is number => v !== null)),
      meanVibeShare: mean(rows.map((r) => r.vibeShare).filter((v): v is number => v !== null)),
      meanOverlapWithNearest: mean(
        rows.map((r) => r.overlapWithNearest).filter((v): v is number => v !== null),
      ),
      meanSeconds: mean(rows.map((r) => r.seconds).filter((v): v is number => v !== null)),
    };
  });
  console.log('-----BEGIN EXPLORATION-----');
  console.log(
    JSON.stringify(
      {
        kind: 'qloo_exploration',
        scenarios: results,
        summary,
        baseline: {
          meanBaseVibeShare: mean(
            results.map((s) => s.baseVibeShare).filter((v): v is number => v !== null),
          ),
          meanNearestVibeShare: mean(
            results.map((s) => s.nearestVibeShare).filter((v): v is number => v !== null),
          ),
        },
      },
      null,
      2,
    ),
  );
  console.log('-----END EXPLORATION-----');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
