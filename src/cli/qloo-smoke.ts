/**
 * Runs the live Qloo experiment and writes a redacted report.
 *
 *   npm run qloo:smoke -- --city "New York" --seed-a "Miles Davis" --seed-b "Metallica"
 *
 * Without QLOO_API_KEY it reports that credentials are missing and writes nothing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../infrastructure/config.js';
import { QlooClient } from '../qloo/client.js';
import { runSmoke } from '../qloo/smoke.js';

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : fallback;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = loadConfig();
  if (!config.QLOO_API_KEY) {
    console.error(
      'Qloo credentials are missing. Set QLOO_API_KEY in your environment or .env file and run this again.',
    );
    console.error('No request was made and no report was written.');
    process.exitCode = 2;
    return;
  }
  const options = {
    city: option(args, '--city', 'New York'),
    seedA: option(args, '--seed-a', 'Miles Davis'),
    seedB: option(args, '--seed-b', 'Metallica'),
    category: option(args, '--category', 'restaurant'),
    poolSize: Number(option(args, '--pool', '40')),
  };
  const client = new QlooClient({
    apiKey: config.QLOO_API_KEY,
    baseUrl: config.QLOO_API_URL,
    timeoutMs: config.QLOO_TIMEOUT_MS,
    dailyCallCap: config.QLOO_DAILY_CALL_CAP,
  });
  const report = await runSmoke(client, options, new Date());
  for (const check of report.checks)
    console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
  console.log(`\nVerdict: ${report.verdict}`);
  for (const reason of report.reasons) console.log(`- ${reason}`);
  for (const note of report.notes) console.log(`Note: ${note}`);
  const outDir = resolve(import.meta.dirname, '../../data/evaluation');
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `smoke-${report.generatedAt.slice(0, 10)}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report written to ${file}`);
  if (report.verdict === 'no_go') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The smoke run failed.');
  process.exitCode = 1;
});
