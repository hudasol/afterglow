/**
 * The baseline comparison: AFTERGLOW against random, nearest first, popular and taste only lists,
 * each with and without the feasibility gate, on a set of scenarios.
 *
 *   npm run eval:baselines -- --run dev    Ranks the development scenarios on Qloo. Needs QLOO_API_KEY.
 *   npm run eval:baselines -- --run test   Ranks the test scenarios on Qloo. Needs QLOO_API_KEY.
 *   npm run eval:baselines -- --render dev Rewrites the Markdown from the results file. No requests.
 *   npm run eval:baselines -- --resummarise dev
 *                                          Recomputes the summary in the results file from the results
 *                                          of its scenarios, then rewrites the Markdown. No requests.
 *   npm run eval:baselines -- --offline    Runs the offline simulated catalogue, to check the code. Writes nothing.
 *
 * A run writes results/baselines-<set>.json and docs/EVALUATION_BASELINES_<SET>.md, and prints the
 * results file between markers so that a hosted run can be collected from its log.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  renderBaselineReport,
  summariseBaselines,
  type BaselineResultsFile,
  type ScenarioSet,
} from '../evaluation/baseline-report.js';
import { evaluateBaselines, type BaselineResult } from '../evaluation/baselines.js';
import { liveClient, loadLiveScenarios, toSpec } from '../evaluation/live-scenarios.js';
import { QlooTasteProvider } from '../qloo/provider.js';
import { SimulatedTasteProvider } from '../simulation/provider.js';
import { scenarios } from '../simulation/scenarios.js';

const SETS: Record<ScenarioSet, { scenarios: string; results: string; doc: string }> = {
  dev: {
    scenarios: 'evaluation/live-scenarios.json',
    results: 'results/baselines-dev.json',
    doc: 'docs/EVALUATION_BASELINES_DEV.md',
  },
  test: {
    scenarios: 'evaluation/test-scenarios.json',
    results: 'results/baselines-test.json',
    doc: 'docs/EVALUATION_BASELINES_TEST.md',
  },
};

function setFrom(value: string | undefined): ScenarioSet {
  if (value === 'dev' || value === 'test') return value;
  throw new Error('Name the scenario set: dev or test.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = resolve(import.meta.dirname, '../..');

  const renderIndex = args.indexOf('--render');
  if (renderIndex !== -1) {
    const set = setFrom(args[renderIndex + 1]);
    const file = JSON.parse(
      readFileSync(resolve(root, SETS[set].results), 'utf8'),
    ) as BaselineResultsFile;
    writeFileSync(resolve(root, SETS[set].doc), renderBaselineReport(file));
    console.log(`Wrote ${SETS[set].doc} from ${SETS[set].results}.`);
    return;
  }

  const resummariseIndex = args.indexOf('--resummarise');
  if (resummariseIndex !== -1) {
    const set = setFrom(args[resummariseIndex + 1]);
    const path = resolve(root, SETS[set].results);
    const file = JSON.parse(readFileSync(path, 'utf8')) as BaselineResultsFile;
    // The summary is a pure function of the results, so this changes no measured value.
    const updated: BaselineResultsFile = { ...file, summary: summariseBaselines(file.results) };
    writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
    writeFileSync(resolve(root, SETS[set].doc), renderBaselineReport(updated));
    console.log(`Recomputed the summary in ${SETS[set].results} and wrote ${SETS[set].doc}.`);
    return;
  }

  if (args.includes('--offline')) {
    const provider = new SimulatedTasteProvider();
    const results: BaselineResult[] = [];
    for (const spec of scenarios) results.push(await evaluateBaselines(provider, spec));
    const summary = summariseBaselines(results);
    console.log(
      JSON.stringify({ completed: summary.completed, arms: summary.arms.length }, null, 2),
    );
    return;
  }

  const runIndex = args.indexOf('--run');
  if (runIndex === -1)
    throw new Error(
      'Use --run <dev|test>, --render <dev|test>, --resummarise <dev|test> or --offline.',
    );
  const set = setFrom(args[runIndex + 1]);
  const client = liveClient();
  if (!client) {
    console.error('QLOO_API_KEY is not set, so a live run cannot start. Nothing was written.');
    process.exitCode = 2;
    return;
  }
  const provider = new QlooTasteProvider(client);
  const tagProvider = new QlooTasteProvider(client, undefined, { vibeExemplars: false });
  const specs = loadLiveScenarios(SETS[set].scenarios).map(toSpec);

  const results: BaselineResult[] = [];
  for (const spec of specs) {
    const result = await evaluateBaselines(provider, spec, { ablation: tagProvider });
    results.push(result);
    console.error(
      `${result.ok ? 'done' : 'failed'} ${spec.id}${result.error ? `: ${result.error}` : ''}`,
    );
  }

  const file: BaselineResultsFile = {
    kind: 'baseline_comparison',
    set,
    generatedAt: new Date().toISOString(),
    provider: { label: provider.descriptor.label, mode: provider.descriptor.mode },
    scenarioCount: specs.length,
    results,
    summary: summariseBaselines(results),
  };
  mkdirSync(resolve(root, 'results'), { recursive: true });
  writeFileSync(resolve(root, SETS[set].results), `${JSON.stringify(file, null, 2)}\n`);
  writeFileSync(resolve(root, SETS[set].doc), renderBaselineReport(file));
  console.log('-----BEGIN BASELINES-----');
  console.log(JSON.stringify(file, null, 2));
  console.log('-----END BASELINES-----');
  console.log(`Wrote ${SETS[set].results} and ${SETS[set].doc}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The baseline comparison failed.');
  process.exitCode = 1;
});
