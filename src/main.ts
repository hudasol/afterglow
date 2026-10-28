import { resolve } from 'node:path';
import { buildContainer } from './container.js';
import { createApp } from './interfaces/http/app.js';

const container = buildContainer();
const { config, service } = container;

const app = createApp({
  service,
  integration: container.integration,
  version: container.version,
  commit: (config.AFTERGLOW_COMMIT ?? config.RENDER_GIT_COMMIT)?.slice(0, 7),
  host: config.HOST,
  port: config.PORT,
  accessToken: config.AFTERGLOW_ACCESS_TOKEN,
  allowedOrigins: config.AFTERGLOW_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  rateLimitPerMinute: config.AFTERGLOW_RATE_LIMIT_PER_MINUTE,
  liveActionsPerHour: config.AFTERGLOW_LIVE_ACTIONS_PER_HOUR,
  trustProxy: config.AFTERGLOW_TRUST_PROXY,
  serveWeb: config.SERVE_WEB,
  webRoot: resolve(import.meta.dirname, '../web/dist'),
  evaluationRoot: resolve(import.meta.dirname, '../data/evaluation'),
  resultsRoot: resolve(import.meta.dirname, '../results'),
  publicDemo: config.AFTERGLOW_PUBLIC_DEMO,
});

const purge = setInterval(() => {
  try {
    service.purgeExpired();
  } catch (error) {
    console.error('Expiry sweep failed:', error instanceof Error ? error.message : 'unknown');
  }
}, 15 * 60_000);
purge.unref();

const server = app.listen(config.PORT, config.HOST, () => {
  const live = container.integration.liveConfigured ? 'configured' : 'not configured';
  console.log(
    `AFTERGLOW ${container.version} listening on http://${config.HOST}:${config.PORT} (live Qloo: ${live})`,
  );
});

function shutdown(): void {
  clearInterval(purge);
  server.close(() => {
    container.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
