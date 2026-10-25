import { readFileSync } from 'node:fs';
import { RecoveryService } from './application/recovery-service.js';
import { Database } from './infrastructure/database.js';
import { loadConfig, type Config } from './infrastructure/config.js';
import { SqliteCaseRepository } from './infrastructure/sqlite-case-repository.js';
import type { IntegrationStatus, ProbeResult } from './interfaces/http/app.js';
import { QlooClient } from './qloo/client.js';
import { QlooError } from './qloo/errors.js';
import { QlooTasteProvider } from './qloo/provider.js';
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

  const service = new RecoveryService({
    repo: new SqliteCaseRepository(db),
    providers: { live: new QlooTasteProvider(client), demo: new SimulatedTasteProvider() },
    caseTtlHours: config.AFTERGLOW_CASE_TTL_HOURS,
  });

  const probe = client
    ? async (): Promise<ProbeResult> => {
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
      probe,
    },
  };
}
