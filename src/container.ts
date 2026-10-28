import { readFileSync } from 'node:fs';
import { RecoveryService } from './application/recovery-service.js';
import { Database } from './infrastructure/database.js';
import { loadConfig, type Config } from './infrastructure/config.js';
import { SqliteCaseRepository } from './infrastructure/sqlite-case-repository.js';
import type { IntegrationStatus, OsmProbeResult, ProbeResult } from './interfaces/http/app.js';
import { QlooClient } from './qloo/client.js';
import { QlooError } from './qloo/errors.js';
import { OverpassClient, type OverpassOptions } from './openstreetmap/overpass.js';
import { OsmPlaceFactsProvider } from './openstreetmap/provider.js';
import { runOsmSmoke } from './openstreetmap/smoke.js';
import { QlooTasteProvider } from './qloo/provider.js';
import { memoiseAsync } from './shared/memoise-async.js';
import { SimulatedTasteProvider } from './simulation/provider.js';

export interface Container {
  config: Config;
  db: Database;
  service: RecoveryService;
  integration: IntegrationStatus;
  version: string;
}

export function readVersion(): string {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function buildContainer(config: Config = loadConfig()): Container {
  const db = new Database(config.DATABASE_PATH);
  db.migrate(new URL('../migrations', import.meta.url).pathname);

  const client = config.QLOO_API_KEY
    ? new QlooClient({
        apiKey: config.QLOO_API_KEY,
        baseUrl: config.QLOO_API_URL,
        timeoutMs: config.QLOO_TIMEOUT_MS,
        dailyCallCap: config.QLOO_DAILY_CALL_CAP,
      })
    : null;

  const overpassOptions = {
    url: config.OVERPASS_URL,
    timeoutMs: config.OVERPASS_TIMEOUT_MS,
    userAgent: 'afterglow-hackathon-demo (+https://github.com/hudasol/afterglow)',
  };
  const placeFacts =
    client && config.AFTERGLOW_OSM_FACTS
      ? new OsmPlaceFactsProvider(new OverpassClient(overpassOptions))
      : undefined;
  const osmProbe = config.AFTERGLOW_OSM_FACTS ? buildOsmProbe(overpassOptions) : null;

  const service = new RecoveryService({
    repo: new SqliteCaseRepository(db),
    providers: { live: new QlooTasteProvider(client), demo: new SimulatedTasteProvider() },
    caseTtlHours: config.AFTERGLOW_CASE_TTL_HOURS,
    ...(placeFacts ? { placeFacts } : {}),
  });

  // The probe spends one Qloo call. Its answer is repeated for a minute, so a page that is
  // refreshed or a script that polls cannot use up the daily allowance.
  const askQloo = client
    ? memoiseAsync(async (): Promise<Omit<ProbeResult, 'cached'>> => {
        const started = Date.now();
        try {
          await client.get('/search', { query: 'jazz', take: 1 }, undefined, { bypassCache: true });
          return {
            ok: true,
            latencyMs: Date.now() - started,
            message: 'Qloo accepted an authenticated search request.',
          };
        } catch (error) {
          const qloo = error instanceof QlooError ? error : undefined;
          return {
            ok: false,
            latencyMs: Date.now() - started,
            code: qloo?.code ?? 'QLOO_NETWORK',
            message: qloo?.message ?? 'The Qloo request could not be completed.',
          };
        }
      }, PROBE_CACHE_MS * 2)
    : null;
  const probe = askQloo
    ? async (): Promise<ProbeResult> => {
        const { value, cached } = await askQloo();
        return { ...value, cached };
      }
    : null;

  return {
    config,
    db,
    service,
    version: readVersion(),
    integration: {
      liveConfigured: client !== null,
      qlooBaseUrl: config.QLOO_API_URL,
      get qlooCallsToday() {
        return client ? client.callsToday : null;
      },
      qlooDailyCap: config.QLOO_DAILY_CALL_CAP,
      placeFactsEnabled: placeFacts !== undefined,
      osmProbe,
      probe,
    },
  };
}

const PROBE_CACHE_MS = 30_000;

/**
 * A small real question to OpenStreetMap, asked from this server so that what it shows is what the
 * hosted application can actually reach. It uses its own client, so the pause after failures that
 * protects searches never hides a live answer, and it repeats an answer for thirty seconds so that
 * the shared public service is not asked more often than that.
 */
function buildOsmProbe(options: OverpassOptions): () => Promise<OsmProbeResult> {
  let last: { at: number; result: OsmProbeResult } | null = null;
  return async () => {
    if (last && Date.now() - last.at < PROBE_CACHE_MS) return { ...last.result, cached: true };
    // A public point with many named venues. Nothing about any person is involved.
    const report = await runOsmSmoke(
      new OverpassClient(options),
      { lat: 40.758, lon: -73.9855, radiusM: 200, points: 1 },
      new Date(),
    );
    const result: OsmProbeResult = {
      ok: report.verdict !== 'no_go',
      verdict: report.verdict,
      latencyMs: report.durationMs,
      host: report.traces.at(-1)?.params['host'] ?? null,
      venues: report.venues,
      hoursPresent: report.openingHours.present,
      hoursRead: report.openingHours.read,
      message:
        report.reasons[0] ??
        `${report.venues} named venues came back, ${report.openingHours.read} of ${report.openingHours.present} opening hours values were read in full.`,
      cached: false,
    };
    last = { at: Date.now(), result };
    return result;
  };
}
