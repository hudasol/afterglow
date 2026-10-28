/**
 * Runs the evaluation and writes a JSON report and a Markdown summary.
 *
 *   npm run eval                       Offline run over the labelled simulated catalogue.
 *   npm run eval -- --live file.json   Live run over scenarios you supply. Needs QLOO_API_KEY.
 *   npm run eval:live                  The preregistered live run. Needs QLOO_API_KEY.
 *   npm run eval:preflight             Checks that the live scenarios can be resolved. No ranking.
 *   npm run eval:render                Rewrites docs/EVALUATION_LIVE.md from results/live-qloo.json.
 *   Add --second-run to either live command to use the files of the second run.
 *   npm run eval -- --diagnose file.json [id ...]
 *                                      Prints why scenarios came out as they did. Writes nothing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  renderLiveReport,
  summariseLive,
  type LiveResultsFile,
} from '../evaluation/live-report.js';
import { diagnoseScenario } from '../evaluation/diagnose.js';
import { renderReport } from '../evaluation/report-markdown.js';
import { runEvaluation } from '../evaluation/runner.js';
import type { ResolutionKind } from '../domain/case.js';
import { categoryTagPhrase } from '../domain/intent.js';
import { liveClient, loadLiveScenarios, toSpec } from '../evaluation/live-scenarios.js';
import { QlooTasteProvider } from '../qloo/provider.js';
import { SimulatedTasteProvider } from '../simulation/provider.js';
import { scenarios, type ScenarioSpec } from '../simulation/scenarios.js';

const LIVE_RESULTS = 'results/live-qloo.json';
const LIVE_DOC = 'docs/EVALUATION_LIVE.md';
const SECOND_RESULTS = 'results/live-qloo-second-run.json';
const SECOND_DOC = 'docs/EVALUATION_LIVE_SECOND_RUN.md';
const SECOND_RUN = {
  label: 'second run',
  note: 'This is the second run on the same frozen scenarios and the same predictions. It was made after two product defects that the first run exposed were fixed: the original venue could be taken from another country, and Qloo timed out when five or more tag signals were sent. It is not independent of the first run, because the fixes were chosen after seeing which scenarios failed. It does not replace the first run, which is the registered result.',
};

/** Resolves every signal, category and original venue in the scenarios, and ranks nothing. */
async function preflight(file: string): Promise<void> {
  const client = liveClient();
  if (!client) {
    console.error('QLOO_API_KEY is not set, so nothing was requested.');
    process.exitCode = 2;
    return;
  }
  const provider = new QlooTasteProvider(client);
  const seen = new Set<string>();
  let unresolved = 0;
  for (const scenario of loadLiveScenarios(file)) {
    const { anchor } = scenario;
    const inputs: Array<[ResolutionKind, string]> = [
      ['category', categoryTagPhrase[anchor.category]],
      ['original_venue', anchor.originalVenue.name],
      ...anchor.tasteEntities.map((name): [ResolutionKind, string] => ['entity', name]),
      ...anchor.tasteTags.map((name): [ResolutionKind, string] => ['tag', name]),
    ];
    for (const [kind, input] of inputs) {
      const key = `${kind}:${anchor.city}:${input}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const resolution = await provider.resolve(kind, input, { traces: [], city: anchor.city });
      const chosen = scenario.choices?.[input];
      const picked = (resolution.candidates ?? []).find(
        (c) => c.id === chosen || c.type === chosen,
      );
      const settled =
        resolution.status === 'resolved' ||
        (resolution.status === 'ambiguous' && picked !== undefined);
      if (!settled) unresolved += 1;
      const shown = (resolution.candidates ?? [])
        .map((c) => `${c.name} [${c.type ?? 'no type'}]`)
        .join('; ');
      console.log(
        `${settled ? 'OK  ' : 'FAIL'} ${scenario.id} ${kind} "${input}" (${anchor.city}): ${resolution.status}${picked ? ` settled by choice ${chosen}` : ''}${shown ? ` -> ${shown}` : ''}`,
      );
    }
  }
  console.log(
    `\n${unresolved === 0 ? 'Every input can be resolved.' : `${unresolved} inputs cannot be resolved.`}`,
  );
  if (unresolved > 0) process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const liveIndex = args.indexOf('--live');
  const root = resolve(import.meta.dirname, '../..');
  const outDir = resolve(root, 'data/evaluation');
  mkdirSync(outDir, { recursive: true });

  const secondRun = args.includes('--second-run');
  const resultsFile = secondRun ? SECOND_RESULTS : LIVE_RESULTS;
  const docFile = secondRun ? SECOND_DOC : LIVE_DOC;
  if (args.includes('--render-live')) {
    const file = JSON.parse(readFileSync(resolve(root, resultsFile), 'utf8')) as LiveResultsFile;
    writeFileSync(resolve(root, docFile), renderLiveReport(file));
    console.log(`Wrote ${docFile} from ${resultsFile}.`);
    return;
  }
  const diagnoseIndex = args.indexOf('--diagnose');
  if (diagnoseIndex !== -1) {
    const target = args[diagnoseIndex + 1];
    if (!target) throw new Error('Pass the path of a scenarios file after --diagnose.');
    const only = args.slice(diagnoseIndex + 2).filter((arg) => !arg.startsWith('--'));
    const client = liveClient();
    if (!client) {
      console.error('QLOO_API_KEY is not set, so nothing was requested.');
      process.exitCode = 2;
      return;
    }
    const provider = new QlooTasteProvider(client);
    for (const scenario of loadLiveScenarios(target)) {
      if (only.length > 0 && !only.includes(scenario.id)) continue;
      const spec = toSpec(scenario);
      try {
        console.log(JSON.stringify(await diagnoseScenario(provider, spec)));
      } catch (error) {
        console.log(
          JSON.stringify({
            id: scenario.id,
            error: error instanceof Error ? error.message : 'failed',
          }),
        );
      }
    }
    return;
  }
  const preflightIndex = args.indexOf('--preflight');
  if (preflightIndex !== -1) {
    const target = args[preflightIndex + 1];
    if (!target) throw new Error('Pass the path of a scenarios file after --preflight.');
    await preflight(target);
    return;
  }

  if (liveIndex === -1) {
    const report = await runEvaluation(new SimulatedTasteProvider(), scenarios, {
      kind: 'offline_simulated',
      useOracle: true,
      now: new Date(),
    });
    writeFileSync(
      resolve(outDir, 'report-offline-simulated.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    writeFileSync(resolve(root, 'docs/EVALUATION_RESULTS.md'), renderReport(report));
    console.log(
      `Offline evaluation: ${report.summary.completed} of ${report.summary.scenarios} scenarios completed.`,
    );
    console.log(
      'Wrote data/evaluation/report-offline-simulated.json and docs/EVALUATION_RESULTS.md',
    );
    if (
      report.summary.completed !== report.summary.scenarios ||
      !report.summary.gateAgreesWithOracle
    ) {
      process.exitCode = 1;
    }
    return;
  }

  const file = args[liveIndex + 1];
  if (!file) throw new Error('Pass the path of a scenarios file after --live.');
  const client = liveClient();
  if (!client) {
    console.error('QLOO_API_KEY is not set, so a live evaluation cannot run. Nothing was written.');
    process.exitCode = 2;
    return;
  }
  const parsed = loadLiveScenarios(file);
  const specs: ScenarioSpec[] = parsed.map(toSpec);
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const standIn = new Map(parsed.map((item) => [item.id, item.placeboFrom]));
  const report = await runEvaluation(new QlooTasteProvider(client), specs, {
    kind: 'live_qloo',
    useOracle: true,
    now: new Date(),
    placeboFor: (id) => {
      const from = standIn.get(id);
      return from ? byId.get(from) : undefined;
    },
  });
  const results: LiveResultsFile = {
    ...report,
    live: summariseLive(report.results),
    ...(secondRun ? { run: SECOND_RUN } : {}),
  };
  mkdirSync(resolve(root, 'results'), { recursive: true });
  writeFileSync(resolve(root, resultsFile), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(resolve(root, docFile), renderLiveReport(results));
  console.log(
    `Live evaluation: ${report.summary.completed} of ${report.summary.scenarios} scenarios completed.`,
  );
  console.log(
    `Predictions: ${results.live.hits} HIT, ${results.live.misses} MISS, ${results.live.notEvaluated} not evaluated.`,
  );
  console.log(`Wrote ${resultsFile} and ${docFile}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Evaluation failed.');
  process.exitCode = 1;
});
