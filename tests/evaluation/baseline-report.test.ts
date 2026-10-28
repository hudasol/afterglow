import { describe, expect, it } from 'vitest';
import {
  BASELINE_PREDICTIONS,
  baselineRunView,
  recordedExample,
  renderBaselineReport,
  summariseBaselines,
  type BaselineResultsFile,
} from '../../src/evaluation/baseline-report.js';
import type { BaselineResult, ListMeasures } from '../../src/evaluation/baselines.js';

/** Values written by hand for the arithmetic tests. They are not data from any provider. */
function list(overrides: Partial<ListMeasures> = {}): ListMeasures {
  return {
    names: ['A', 'B', 'C'],
    places: [],
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

  it('names the places and the reason for each requirement that is broken', () => {
    const detailed = result('one', {
      ungated: {
        ...result('x').ungated,
        taste_only: list({
          violations: 1,
          places: [
            {
              name: 'Mall',
              against: ['price', 'dietary:halal'],
              feasibility: 'rejected',
              distanceKm: 2,
              affinity: 0.8,
            },
            {
              name: 'Bistro',
              against: [],
              feasibility: 'feasible',
              distanceKm: 1,
              affinity: 0.7,
            },
          ],
        }),
      },
    });
    const text = renderBaselineReport(file([detailed]));
    expect(text).toContain('Mall (over the price limit, not halal); Bistro');
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

describe('recorded example', () => {
  const place = (name: string, against: string[], feasibility: 'feasible' | 'rejected') => ({
    name,
    against,
    feasibility,
    distanceKm: 1,
    affinity: 0.5,
  });
  const plain = (violations: number, against: string[] = []) =>
    list({
      violations,
      places: [place('Mall', against, 'rejected'), place('Bistro', [], 'feasible')],
    });

  it('takes the first scenario in file order whose plain taste list breaks a requirement', () => {
    const clean = result('clean', {
      ungated: { ...result('x').ungated, taste_only: plain(0) },
    });
    const first = result('first', {
      ungated: { ...result('x').ungated, taste_only: plain(1, ['price']) },
      gated: {
        ...result('x').gated,
        afterglow: list({ places: [place('Cafe', [], 'feasible')] }),
      },
    });
    const later = result('later', {
      ungated: { ...result('x').ungated, taste_only: plain(2, ['dietary:halal']) },
      gated: {
        ...result('x').gated,
        afterglow: list({ places: [place('Other', [], 'feasible')] }),
      },
    });
    const example = recordedExample(file([clean, first, later]));
    expect(example?.scenarioId).toBe('first');
    expect(example?.plain[0]).toEqual({ name: 'Mall', reasons: ['over the price limit'] });
    expect(example?.afterglow).toEqual([{ name: 'Cafe', needsCheck: false }]);
    expect(example?.plainBreaking).toEqual({ count: 2, total: 3 });
  });

  it('returns nothing when no plain list breaks a requirement', () => {
    expect(
      recordedExample(
        file([result('a', { ungated: { ...result('x').ungated, taste_only: plain(0) } })]),
      ),
    ).toBeNull();
  });

  it('skips a scenario that did not complete', () => {
    const failed = result('failed', {
      ok: false,
      error: 'No search ran',
      ungated: { ...result('x').ungated, taste_only: plain(1, ['price']) },
    });
    expect(recordedExample(file([failed]))).toBeNull();
  });
});

describe('baseline run view', () => {
  it('lists the predictions for the test set only', () => {
    const test = baselineRunView(file([result('one')], 'test'), 'Test scenarios');
    expect(test.predictions.map((p) => p.id)).toEqual(BASELINE_PREDICTIONS.map((p) => p.id));
    const dev = baselineRunView(file([result('one')], 'dev'), 'Development scenarios');
    expect(dev.predictions).toEqual([]);
    expect(dev.label).toBe('Development scenarios');
  });

  it('carries the same figures as the generated document', () => {
    const run = file([result('one'), result('two')]);
    const view = baselineRunView(run, 'Test scenarios');
    const text = renderBaselineReport(run);
    for (const row of view.arms) {
      expect(text).toContain(row.breaking);
      expect(text).toContain(row.km);
    }
    expect(view.hits + view.misses + view.notEvaluated).toBe(BASELINE_PREDICTIONS.length);
  });
});
