import { describe, expect, it } from 'vitest';
import { diagnoseScenario } from '../../src/evaluation/diagnose.js';
import { SimulatedTasteProvider } from '../../src/simulation/provider.js';
import { scenarios } from '../../src/simulation/scenarios.js';

describe('diagnoseScenario', () => {
  it('explains a scenario with counts and redacted values only', async () => {
    const [first] = scenarios;
    if (!first) throw new Error('The simulated catalogue needs a scenario.');
    const diagnosis = await diagnoseScenario(new SimulatedTasteProvider(), first);
    expect(diagnosis.id).toBe(first.id);
    expect(diagnosis.pool.size).toBeGreaterThan(0);
    expect(diagnosis.pool.sample.length).toBeLessThanOrEqual(4);
    expect(diagnosis.originalVenue.input).toBe(first.anchor.originalVenue.name);
    expect(diagnosis.failedCalls).toEqual([]);
    expect(JSON.stringify(diagnosis)).not.toMatch(/api[_-]?key/iu);
  });
});
