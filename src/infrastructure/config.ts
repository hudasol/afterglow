/**
 * Validated runtime configuration. Every setting has a safe local default. The only secrets are
 * QLOO_API_KEY and AFTERGLOW_ACCESS_TOKEN. Neither is ever logged or returned by the API.
 */
import { z } from 'zod';

const flag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_PATH: z.string().default('var/afterglow.db'),

  QLOO_API_KEY: z
    .string()
    .trim()
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  QLOO_API_URL: z.string().url().default('https://hackathon.api.qloo.com'),
  QLOO_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(15_000),
  /** Qloo calls allowed per UTC day. 0 turns the cap off. */
  QLOO_DAILY_CALL_CAP: z.coerce.number().int().min(0).max(1_000_000).default(2000),

  /**
   * Looks up opening hours, diet, wheelchair and capacity tags on OpenStreetMap for live cases,
   * because Qloo does not supply them. Only public venue coordinates are sent.
   */
  AFTERGLOW_OSM_FACTS: flag('true'),
  OVERPASS_URL: z.string().url().default('https://overpass-api.de/api/interpreter'),
  OVERPASS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(20_000),

  /** Allows a non loopback HOST without a token, for the hosted judging demo. */
  AFTERGLOW_PUBLIC_DEMO: flag('false'),
  /** When set, /api requires "Authorization: Bearer <token>". Needed when HOST is not loopback. */
  AFTERGLOW_ACCESS_TOKEN: z.string().min(16).optional(),
  AFTERGLOW_ALLOWED_ORIGINS: z.string().default(''),
  AFTERGLOW_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).max(100_000).default(120),
  AFTERGLOW_TRUST_PROXY: flag('false'),
  AFTERGLOW_CASE_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(48),
  SERVE_WEB: flag('true'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    ...(env['RENDER'] === 'true' ? { AFTERGLOW_TRUST_PROXY: 'true' } : {}),
    ...env,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration: ${problems.join('; ')}`);
  }
  const config = parsed.data;
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.HOST);
  if (!loopback && !config.AFTERGLOW_ACCESS_TOKEN && !config.AFTERGLOW_PUBLIC_DEMO) {
    throw new Error(
      'Refusing to listen on a non loopback address without AFTERGLOW_ACCESS_TOKEN. ' +
        'Set a token of 16 or more characters, or set AFTERGLOW_PUBLIC_DEMO=true for a public demo.',
    );
  }
  return config;
}
