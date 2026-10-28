import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { intentAnchorInputSchema } from '../domain/intent.js';
import { disruptionSchema } from '../domain/plan.js';
import { loadConfig } from '../infrastructure/config.js';
import { QlooClient } from '../qloo/client.js';
import type { ScenarioSpec } from '../simulation/scenarios.js';

export const liveScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(''),
  anchor: intentAnchorInputSchema,
  disruption: disruptionSchema,
  /** An id or a type for each ambiguous input, so a scenario can name its choice before the ids are known. */
  choices: z.record(z.string(), z.string()).optional(),
  /** Another scenario whose taste signals are swapped in for the placebo comparison. */
  placeboFrom: z.string().min(1).optional(),
});

export type LiveScenario = z.infer<typeof liveScenarioSchema>;

export function loadLiveScenarios(file: string): LiveScenario[] {
  return z.array(liveScenarioSchema).parse(JSON.parse(readFileSync(resolve(file), 'utf8')));
}

/** The scenario as the runner takes it, without the field that only the placebo comparison uses. */
export function toSpec(scenario: LiveScenario): ScenarioSpec {
  const { choices, placeboFrom, ...item } = scenario;
  void placeboFrom;
  return { ...item, featured: false, ...(choices ? { choices } : {}) };
}

/** A client for the Qloo API, or null when no key is set. The key is read from the environment only. */
export function liveClient(): QlooClient | null {
  const config = loadConfig();
  if (!config.QLOO_API_KEY) return null;
  return new QlooClient({
    apiKey: config.QLOO_API_KEY,
    baseUrl: config.QLOO_API_URL,
    timeoutMs: config.QLOO_TIMEOUT_MS,
    dailyCallCap: config.QLOO_DAILY_CALL_CAP,
  });
}
