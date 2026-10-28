import { describe, expect, it } from 'vitest';
import {
  BASELINE_PREDICTIONS,
  renderBaselineReport,
  summariseBaselines,
  type BaselineResultsFile,
} from '../../src/evaluation/baseline-report.js';
import type { BaselineResult, ListMeasures } from '../../src/evaluation/baselines.js';

/** Values written by hand for the arithmetic tests. They are not data from any provider. */
function list(overrides: Partial<ListMeasures> = {}): ListMeasures {
  return {
    names: ['A', 'B', 'C'],
    violations: 0,
    ruledOut: 0,
    needsCheck: 1,
    verified: 2,
    meanKm: 1,
    meanAffinity: 0.5,
    affinityLift: 0,
    vibeShare: 0.5,
    ...overrides,
  };
}

function result(id: string, overrides: Partial<BaselineResult> = {}): BaselineResult {
  return {
    id,
    title: id,
    ok: true,
    poolSize: 40,
    eligible: 30,
    coverage: { scored: 40, scoredShare: 1, spread: 0.1, tasteStatus: 'ranked', exemplarCount: 6 },
    gated: {
      random: list(),
      nearest: list({ affinityLift: 0 }),
      popular: list(),
      taste_only: list({ affinityLift: 1.5, meanKm: 2 }),
      afterglow: list({ affinityLift: 1, meanKm: 1.5, vibeShare: 0.8 }),
    },
    ungated: {
      random: list({ violations: 1 }),
      nearest: list({ violations: 0 }),
      popular: list({ violations: 2 }),
      taste_only: list({ violations: 1 }),
    },
    topChoiceDiffers: { nearest: true, popular: true, tasteOnly: false },
    ablationTags: {
      scored: 10,
      scoredShare: 0.25,
      spread: 0,
      tasteStatus: 'ranked',
      exemplarCount: 0,
      list: list(),
      topChoiceDiffersNearest: false,
    },
    providerCalls: 6,
    ...overrides,
  };
}

function file(results: BaselineResult[], set: 'dev' | 'test' = 'test'): BaselineResultsFile {
  return {
    kind: 'baseline_comparison',
    set,
    generatedAt: '2026-10-30T10:00:00.000Z',
    provider: { label: 'Fixture', mode: 'live' },
    scenarioCount: results.length,
    results,
    summary: summariseBaselines(results),
  };
}

describe('baseline summary', () => {
  const results = [
    result('one'),
    result('two', { ungated: { ...result('x').ungated, nearest: list({ violations: 1 }) } }),
    result('three', { ok: false, error: 'No search ran' }),
  ];
  const summary = summariseBaselines(results);

  it('counts only completed scenarios', () => {
    expect(summary.completed).toBe(2);
    const nearest = summary.arms.find((a) => a.arm === 'nearest' && !a.gated);
    expect(nearest?.scenarios).toBe(2);
    expect(nearest?.violating?.count).toBe(1);
    expect(nearest?.violating?.total).toBe(2);
  });

  it('takes paired differences within a scenario', () => {
    const diff = summary.paired.find((p) => p.versus === 'taste_only' && p.measure === 'lift');
    expect(diff?.difference?.mean).toBeCloseTo(-0.5);
    const vibe = summary.paired.find((p) => p.versus === 'nearest' && p.measure === 'vibe');
    expect(vibe?.difference?.mean).toBeCloseTo(0.3);
  });

  it('judges each prediction against its threshold and keeps the misses', () => {
    const byId = (id: string) => summary.metrics.find((m) => m.id === id);
    expect(byId('B1')?.observed).toBe(0);
    expect(byId('B1')?.verdict).toBe('HIT');
    // One of the two completed scenarios has a violator in the nearest first list without the gate.
    expect(byId('B2')?.observed).toBe(0.5);
    expect(byId('B2')?.verdict).toBe('HIT');
    expect(byId('B13')?.observed).toBe(2);
    expect(byId('B13')?.verdict).toBe('MISS');
    expect(summary.hits + summary.misses + summary.notEvaluated).toBe(BASELINE_PREDICTIONS.length);
  });

  it('counts a requirement broken by AFTERGLOW, which would be a failure of the gate', () => {
    const broken = summariseBaselines([
      result('one', { gated: { ...result('x').gated, afterglow: list({ violations: 1 }) } }),
    ]);
    expect(broken.metrics.find((m) => m.id === 'B1')?.observed).toBe(1);
    expect(broken.metrics.find((m) => m.id === 'B1')?.verdict).toBe('MISS');
  });

  it('does not judge a claim that nothing was measured for', () => {
    const empty = summariseBaselines([result('one', { ok: false, error: 'failed' })]);
    expect(empty.metrics.find((m) => m.id === 'B1')?.verdict).toBe('NOT EVALUATED');
    expect(empty.hits).toBe(0);
  });

  it('compares scored share with and without example places on the same scenarios', () => {
    expect(summary.ablation.scenarios).toBe(2);
    expect(summary.ablation.scoredShareDifference?.mean).toBeCloseTo(0.75);
  });
});

describe('baseline report', () => {
  const rendered = renderBaselineReport(file([result('one'), result('two')]));

  it('shows every prediction next to its result in the test report only', () => {
    for (const prediction of BASELINE_PREDICTIONS)
      expect(rendered).toContain(`| ${prediction.id} |`);
    const dev = renderBaselineReport(file([result('one')], 'dev'));
    expect(dev).not.toContain('Predictions and results');
    expect(dev).toContain('development scenarios');
  });

  it('states the method and the limits', () => {
    expect(rendered).toContain('What this does not show');
    expect(rendered).toContain('No person judged any list');
    expect(rendered).toContain('seed 20261028');
  });

  it('does not use dashes or emojis in prose', () => {
    expect(rendered).not.toMatch(/—|–/u);
    expect(rendered).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
