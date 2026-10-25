/**
 * Times one ranking request in several forms, to find out which part of it makes Qloo slow.
 *
 *   npm run qloo:timing -- ny-b-saturday-vegetarian
 *   npm run qloo:timing -- --tags       Times every tag of the scenarios on its own.
 *   npm run qloo:timing -- ny-b-saturday-vegetarian --cumulative
 *                                       Adds the tags one at a time and times each request.
 *
 * It reads the scenario from evaluation/live-scenarios.json, resolves its signals, fetches the
 * pool, and then sends the same ranking request with parts left out. It prints durations and
 * statuses only. It needs QLOO_API_KEY and writes nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { categoryTagPhrase } from '../domain/intent.js';
import type { ResolutionKind, TasteResolution } from '../domain/case.js';
import { loadConfig } from '../infrastructure/config.js';
import { QlooClient, type QueryParams } from '../qloo/client.js';
import { QlooTasteProvider } from '../qloo/provider.js';
import { PLACE_TYPE } from '../qloo/resolve.js';

interface Scenario {
  id: string;
  anchor: {
    city: string;
    category: keyof typeof categoryTagPhrase;
    originalVenue: { name: string };
    tasteEntities: string[];
    tasteTags: string[];
  };
  choices?: Record<string, string>;
}

function picked(
  resolution: TasteResolution,
  choice: string | undefined,
): TasteResolution['selected'] {
  if (resolution.selected) return resolution.selected;
  return (resolution.candidates ?? []).find((c) => c.id === choice || c.type === choice);
}

async function timeEachTag(): Promise<void> {
  const config = loadConfig();
  if (!config.QLOO_API_KEY) {
    console.error('QLOO_API_KEY is not set, so nothing was requested.');
    process.exitCode = 2;
    return;
  }
  const scenarios = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../evaluation/live-scenarios.json'), 'utf8'),
  ) as Scenario[];
  const client = new QlooClient({
    apiKey: config.QLOO_API_KEY,
    baseUrl: config.QLOO_API_URL,
    timeoutMs: 90_000,
    maxAttempts: 1,
    dailyCallCap: config.QLOO_DAILY_CALL_CAP,
  });
  const provider = new QlooTasteProvider(client);
  const ctx = { traces: [], city: 'New York' };
  const category = await provider.resolve('category', categoryTagPhrase.restaurant, ctx);
  const pool = await provider.fetchPool(
    {
      city: 'New York',
      take: 40,
      ...(category.selected ? { categoryTagId: category.selected.id } : {}),
    },
    ctx,
  );
  const poolIds = pool.map((p) => p.id);
  const phrases = [...new Set(scenarios.flatMap((s) => s.anchor.tasteTags))];
  console.log(`New York pool of ${poolIds.length}. Each tag is sent on its own.`);
  for (const phrase of phrases) {
    const resolution = await provider.resolve('tag', phrase, ctx);
    const ids = [
      ...(resolution.selected ? [resolution.selected] : []),
      ...(resolution.alsoUsed ?? []),
    ];
    for (const tag of ids) {
      const started = Date.now();
      let outcome = 'ok';
      try {
        await client.get(
          '/v2/insights',
          {
            'filter.type': PLACE_TYPE,
            'filter.results.entities': poolIds,
            'signal.interests.tags': [tag.id],
            take: poolIds.length,
          },
          [],
        );
      } catch (error) {
        outcome = error instanceof Error ? error.message.slice(0, 100) : 'failed';
      }
      console.log(
        `${String(Date.now() - started).padStart(6)} ms  ${outcome}  ${phrase}: ${tag.id}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id) throw new Error('Pass the id of a scenario.');
  if (id === '--tags') return timeEachTag();
  const config = loadConfig();
  if (!config.QLOO_API_KEY) {
    console.error('QLOO_API_KEY is not set, so nothing was requested.');
    process.exitCode = 2;
    return;
  }
  const scenarios = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../evaluation/live-scenarios.json'), 'utf8'),
  ) as Scenario[];
  const scenario = scenarios.find((s) => s.id === id);
  if (!scenario) throw new Error(`No scenario ${id}.`);
  const client = new QlooClient({
    apiKey: config.QLOO_API_KEY,
    baseUrl: config.QLOO_API_URL,
    timeoutMs: 90_000,
    maxAttempts: 1,
    dailyCallCap: config.QLOO_DAILY_CALL_CAP,
  });
  const provider = new QlooTasteProvider(client);
  const ctx = { traces: [], city: scenario.anchor.city };
  const resolveAll = async (kind: ResolutionKind, input: string) => {
    const resolution = await provider.resolve(kind, input, ctx);
    const selected = picked(resolution, scenario.choices?.[input]);
    return { selected, alsoUsed: resolution.alsoUsed ?? [] };
  };

  const category = await resolveAll('category', categoryTagPhrase[scenario.anchor.category]);
  const venue = await resolveAll('original_venue', scenario.anchor.originalVenue.name);
  const entities = await Promise.all(
    scenario.anchor.tasteEntities.map((n) => resolveAll('entity', n)),
  );
  const tags = await Promise.all(scenario.anchor.tasteTags.map((n) => resolveAll('tag', n)));

  const pool = await provider.fetchPool(
    {
      city: scenario.anchor.city,
      take: 40,
      ...(category.selected ? { categoryTagId: category.selected.id } : {}),
    },
    ctx,
  );
  const poolIds = pool.map((p) => p.id);
  const entityIds = [
    ...entities.flatMap((e) => (e.selected ? [e.selected.id] : [])),
    ...(venue.selected ? [venue.selected.id] : []),
  ];
  const allTagIds = tags.flatMap((t) => [
    ...(t.selected ? [t.selected.id] : []),
    ...t.alsoUsed.map((x) => x.id),
  ]);
  const firstTagIds = tags.flatMap((t) => (t.selected ? [t.selected.id] : []));
  console.log(
    `${id}: pool ${poolIds.length}, entities ${entityIds.length}, tags ${allTagIds.length} (${firstTagIds.length} when one per phrase)`,
  );

  const base: QueryParams = {
    'filter.type': PLACE_TYPE,
    'filter.results.entities': poolIds,
    take: poolIds.length,
  };
  if (process.argv[3] === '--cumulative') {
    for (let count = 1; count <= allTagIds.length; count += 1) {
      const started = Date.now();
      let outcome = 'ok';
      try {
        await client.get(
          '/v2/insights',
          {
            ...base,
            ...(entityIds.length ? { 'signal.interests.entities': entityIds } : {}),
            'signal.interests.tags': allTagIds.slice(0, count),
          },
          [],
        );
      } catch (error) {
        outcome = error instanceof Error ? error.message.slice(0, 100) : 'failed';
      }
      console.log(
        `${String(Date.now() - started).padStart(6)} ms  ${outcome}  ${entityIds.length} entities and ${count} tags`,
      );
    }
    return;
  }
  const variants: Array<[string, QueryParams]> = [
    [
      'entities and all tags, explainability',
      {
        ...base,
        'signal.interests.entities': entityIds,
        'signal.interests.tags': allTagIds,
        'feature.explainability': true,
      },
    ],
    [
      'entities and all tags, no explainability',
      { ...base, 'signal.interests.entities': entityIds, 'signal.interests.tags': allTagIds },
    ],
    [
      'entities and one tag per phrase, explainability',
      {
        ...base,
        'signal.interests.entities': entityIds,
        'signal.interests.tags': firstTagIds,
        'feature.explainability': true,
      },
    ],
    [
      'entities and one tag per phrase, no explainability',
      { ...base, 'signal.interests.entities': entityIds, 'signal.interests.tags': firstTagIds },
    ],
    [
      'entities only, explainability',
      { ...base, 'signal.interests.entities': entityIds, 'feature.explainability': true },
    ],
    ['all tags only, no explainability', { ...base, 'signal.interests.tags': allTagIds }],
  ];
  for (const [name, query] of variants) {
    const traces: Parameters<QlooClient['get']>[2] = [];
    const started = Date.now();
    let outcome = 'ok';
    try {
      await client.get('/v2/insights', query, traces);
    } catch (error) {
      outcome = error instanceof Error ? error.message.slice(0, 120) : 'failed';
    }
    console.log(`${String(Date.now() - started).padStart(6)} ms  ${outcome}  ${name}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The timing run failed.');
  process.exitCode = 1;
});
