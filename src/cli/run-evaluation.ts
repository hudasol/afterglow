/**
 * Runs the evaluation and writes a JSON report and a Markdown summary.
 *
 *   npm run eval                       Offline run over the labelled simulated catalogue.
 *   npm run eval -- --live file.json   Live run over scenarios you supply. Needs QLOO_API_KEY.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { renderReport } from '../evaluation/report-markdown.js';
import { runEvaluation } from '../evaluation/runner.js';
import { intentAnchorInputSchema } from '../domain/intent.js';
import { disruptionSchema } from '../domain/plan.js';
import { loadConfig } from '../infrastructure/config.js';
import { QlooClient } from '../qloo/client.js';
import { QlooTasteProvider } from '../qloo/provider.js';
import { SimulatedTasteProvider } from '../simulation/provider.js';
import { scenarios, type ScenarioSpec } from '../simulation/scenarios.js';

const liveScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(''),
  anchor: intentAnchorInputSchema,
  disruption: disruptionSchema,
  choices: z.record(z.string(), z.string()).optional(),
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const liveIndex = args.indexOf('--live');
  const root = resolve(import.meta.dirname, '../..');
  const outDir = resolve(root, 'data/evaluation');
  mkdirSync(outDir, { recursive: true });

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
  const config = loadConfig();
  if (!config.QLOO_API_KEY) {
    console.error('QLOO_API_KEY is not set, so a live evaluation cannot run. Nothing was written.');
    process.exitCode = 2;
    return;
  }
  const parsed = z.array(liveScenarioSchema).parse(JSON.parse(readFileSync(resolve(file), 'utf8')));
  const specs: ScenarioSpec[] = parsed.map(({ choices, ...item }) => ({
    ...item,
    featured: false,
    ...(choices ? { choices } : {}),
  }));
  const client = new QlooClient({
    apiKey: config.QLOO_API_KEY,
    baseUrl: config.QLOO_API_URL,
    timeoutMs: config.QLOO_TIMEOUT_MS,
    dailyCallCap: config.QLOO_DAILY_CALL_CAP,
  });
  const report = await runEvaluation(new QlooTasteProvider(client), specs, {
    kind: 'live_qloo',
    useOracle: false,
    now: new Date(),
  });
  const stamp = report.generatedAt.slice(0, 10);
  writeFileSync(
    resolve(outDir, `report-live-${stamp}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(resolve(root, `docs/EVALUATION_LIVE_${stamp}.md`), renderReport(report));
  console.log(
    `Live evaluation: ${report.summary.completed} of ${report.summary.scenarios} scenarios completed.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Evaluation failed.');
  process.exitCode = 1;
});
