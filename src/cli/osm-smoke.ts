/**
 * Asks OpenStreetMap about the venues around one public point and writes a redacted report.
 *
 *   npm run osm:smoke -- --lat 40.7580 --lon -73.9855 --radius 400
 *
 * It needs no credential. The report holds counts and tag values only, never venue names.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../infrastructure/config.js';
import { OverpassClient } from '../openstreetmap/overpass.js';
import { runOsmSmoke } from '../openstreetmap/smoke.js';

function option(args: string[], name: string, fallback: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value !== undefined && (!value.startsWith('--') || /^-\d/u.test(value)) ? value : fallback;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const lat = Number(option(args, '--lat', '40.7580'));
  const lon = Number(option(args, '--lon', '-73.9855'));
  const radiusM = Number(option(args, '--radius', '400'));
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180 ||
    !Number.isFinite(radiusM) ||
    radiusM < 50 ||
    radiusM > 1500
  ) {
    console.error('Use --lat and --lon for a point and --radius between 50 and 1500 metres.');
    process.exitCode = 2;
    return;
  }
  const client = new OverpassClient({
    url: config.OVERPASS_URL,
    timeoutMs: config.OVERPASS_TIMEOUT_MS,
    userAgent: 'afterglow-hackathon-demo (+https://github.com/hudasol/afterglow)',
  });
  const report = await runOsmSmoke(client, { lat, lon, radiusM }, new Date());
  for (const check of report.checks)
    console.log(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
  console.log(`\nVerdict: ${report.verdict}`);
  for (const reason of report.reasons) console.log(`- ${reason}`);
  const outDir = resolve(import.meta.dirname, '../../data/evaluation');
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `osm-smoke-${report.generatedAt.slice(0, 10)}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report written to ${file}`);
  if (report.verdict === 'no_go') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The smoke run failed.');
  process.exitCode = 1;
});
