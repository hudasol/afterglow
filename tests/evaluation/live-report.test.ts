import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PREDICTIONS,
  renderLiveReport,
  summariseLive,
  type LiveResultsFile,
} from '../../src/evaluation/live-report.js';
import { aggregate, evaluateScenario, type ScenarioResult } from '../../src/evaluation/runner.js';
import { SimulatedTasteProvider } from '../../src/simulation/provider.js';
import { scenarios } from '../../src/simulation/scenarios.js';

const root = resolve(import.meta.dirname, '../..');

/** A fully specified result for tests of the arithmetic. Not data from any provider. */
function result(id: string, overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    id,
    title: id,
    ok: true,
    poolSize: 40,
    tasteStatus: 'ranked',
    rejected: 10,
    feasible: 20,
    needsVerification: 10,
    ungatedTop: { names: ['A', 'B', 'C'], violationCount: 1, violators: ['A'] },
    gatedViolations: { tasteOn: 0, tasteOff: 0 },
    sameEligibleSet: true,
    tasteOffTop: ['D', 'E', 'F'],
    tasteOnTop: ['G', 'H', 'I'],
    popularTop: ['G', 'J', 'K'],
    overlapAt3: 0.33,
    kendallTau: 0.2,
    topChoiceChanged: true,
    overlapAt3VsPopular: 0.33,
    topChoiceChangedVsPopular: false,
    meanAffinityTop3: { tasteOn: 0.5, tasteOff: 0.4, popular: 0.45 },
    preservedTagShare: { tasteOn: 1, tasteOff: 0.5 },
    noFeasibleOption: false,
    relaxationsOffered: 0,
    unknownFactShare: 0.3,
    factCoverage: { openWindow: 0.6, stepFree: 0.8, dietary: null },
    providerCalls: 10,
    tasteOnFeasibleTop: 1,
    placebo: {
      from: 'other',
      tasteOnTop: ['X', 'Y', 'Z'],
      overlapAt3: 0,
      kendallTau: 0,
      topChoiceChanged: true,
    },
    ...overrides,
  };
}

function file(results: ScenarioResult[]): LiveResultsFile {
  return {
    kind: 'live_qloo',
    generatedAt: '2026-10-30T10:00:00.000Z',
    provider: { mode: 'live', label: 'Test provider' },
    scenarioCount: results.length,
    results,
    summary: aggregate(results),
    method: [],
    limits: ['A limit stated by the runner.'],
    live: summariseLive(results),
  };
}

const metric = (summary: ReturnType<typeof summariseLive>, id: string) => {
  const found = summary.metrics.find((m) => m.id === id);
  if (!found) throw new Error(`No metric ${id}`);
  return found;
};

describe('summariseLive', () => {
  it('has one metric per prediction, in order', () => {
    const summary = summariseLive([result('a')]);
    expect(summary.metrics.map((m) => m.id)).toEqual(PREDICTIONS.map((p) => p.id));
    expect(summary.hits + summary.misses + summary.notEvaluated).toBe(PREDICTIONS.length);
  });

  it('computes means, shares and counts from the results', () => {
    const summary = summariseLive([
      result('a', {
        factCoverage: { openWindow: 0.8, stepFree: 0.9, dietary: 0.5 },
        providerCalls: 8,
      }),
      result('b', {
        factCoverage: { openWindow: 0.4, stepFree: 0.5, dietary: null },
        providerCalls: 12,
        topChoiceChanged: false,
        ungatedTop: { names: ['A'], violationCount: 0, violators: [] },
        tasteOnFeasibleTop: 0,
      }),
    ]);
    expect(metric(summary, 'P1').observed).toBeCloseTo(0.6);
    expect(metric(summary, 'P2').observed).toBeCloseTo(0.7);
    expect(metric(summary, 'P3').observed).toBeCloseTo(0.5);
    expect(metric(summary, 'P3').basis).toEqual({ used: 1, of: 2 });
    expect(metric(summary, 'P6').observed).toBeCloseTo(0.5);
    expect(metric(summary, 'P8').observed).toBeCloseTo(0.5);
    expect(metric(summary, 'P9').observed).toBeCloseTo(0.5);
    expect(metric(summary, 'P10').observed).toBeCloseTo(0);
    expect(metric(summary, 'P11').observed).toBe(2);
    expect(metric(summary, 'P12').observed).toBe(10);
  });

  it('counts every violation by the oracle in either gated arm', () => {
    const summary = summariseLive([
      result('a', { gatedViolations: { tasteOn: 1, tasteOff: 0 } }),
      result('b', { gatedViolations: { tasteOn: 0, tasteOff: 2 } }),
    ]);
    expect(metric(summary, 'P7').observed).toBe(3);
    expect(metric(summary, 'P7').verdict).toBe('MISS');
    expect(metric(summariseLive([result('a')]), 'P7').verdict).toBe('HIT');
  });

  it('does not let a scenario without any ranked place count against P8', () => {
    const summary = summariseLive([
      result('a'),
      result('b', { tasteOnTop: [], tasteOnFeasibleTop: 0 }),
    ]);
    expect(metric(summary, 'P8').basis.used).toBe(1);
    expect(metric(summary, 'P8').observed).toBe(1);
  });

  it('leaves out a failed scenario from every measure except the count of completions', () => {
    const summary = summariseLive([
      result('a'),
      result('b', { ok: false, error: 'It failed.', providerCalls: 999 }),
    ]);
    expect(metric(summary, 'P11').observed).toBe(1);
    expect(metric(summary, 'P11').basis).toEqual({ used: 1, of: 2 });
    expect(metric(summary, 'P12').observed).toBe(10);
  });

  it('reports a measure with nothing to measure as not evaluated', () => {
    const summary = summariseLive([result('a', { placebo: null })]);
    expect(metric(summary, 'P4').observed).toBeNull();
    expect(metric(summary, 'P4').verdict).toBe('NOT EVALUATED');
    expect(metric(summary, 'P3').verdict).toBe('NOT EVALUATED');
    expect(summariseLive([]).hits).toBe(0);
  });

  it('judges at least, at most and exactly the way the document states them', () => {
    const summary = summariseLive([
      result('a', {
        factCoverage: { openWindow: 0.5, stepFree: 0.59, dietary: 0.4 },
        providerCalls: 15,
        placebo: {
          from: 'o',
          tasteOnTop: [],
          overlapAt3: 0.5,
          kendallTau: 0,
          topChoiceChanged: true,
        },
      }),
    ]);
    expect(metric(summary, 'P1').verdict).toBe('HIT');
    expect(metric(summary, 'P2').verdict).toBe('MISS');
    expect(metric(summary, 'P3').verdict).toBe('HIT');
    expect(metric(summary, 'P4').verdict).toBe('HIT');
    expect(metric(summary, 'P12').verdict).toBe('HIT');
  });
});

describe('renderLiveReport', () => {
  const rendered = renderLiveReport(
    file([
      result('one'),
      result('two', { ok: false, error: 'The pool | request failed.', providerCalls: 0 }),
    ]),
  );

  it('shows every prediction with its verdict', () => {
    for (const prediction of PREDICTIONS) expect(rendered).toContain(`| ${prediction.id} |`);
    expect(rendered).toMatch(/\| (HIT|MISS|NOT EVALUATED) \|/u);
  });

  it('keeps a failed scenario visible and its text inside the table cell', () => {
    expect(rendered).toContain('failed: The pool / request failed.');
  });

  it('states the limits and links the preregistration', () => {
    expect(rendered).toContain('PREREGISTRATION.md');
    expect(rendered).toContain('A limit stated by the runner.');
    expect(rendered).toContain('written by the team that built the method');
  });

  it('is plain text without dashes in prose or emojis', () => {
    expect(rendered).not.toMatch(/—|–/u);
    expect(rendered).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(rendered).not.toContain('NaN');
  });
});

describe('the recorded live results', () => {
  const resultsPath = resolve(root, 'results/live-qloo.json');
  const present = existsSync(resultsPath);

  it.skipIf(!present)('contain the summary that the code computes from the scenarios', () => {
    const recorded = JSON.parse(readFileSync(resultsPath, 'utf8')) as LiveResultsFile;
    expect(recorded.kind).toBe('live_qloo');
    expect(recorded.live).toEqual(summariseLive(recorded.results));
    expect(recorded.summary).toEqual(aggregate(recorded.results));
  });

  it.skipIf(!present)('are the numbers shown in docs/EVALUATION_LIVE.md', () => {
    const recorded = JSON.parse(readFileSync(resultsPath, 'utf8')) as LiveResultsFile;
    const document = readFileSync(resolve(root, 'docs/EVALUATION_LIVE.md'), 'utf8');
    expect(document).toBe(renderLiveReport(recorded));
  });

  it.skipIf(!present)('judge exactly the predictions written before the run', () => {
    const recorded = JSON.parse(readFileSync(resultsPath, 'utf8')) as LiveResultsFile;
    expect(recorded.live.metrics.map((m) => m.id)).toEqual(PREDICTIONS.map((p) => p.id));
  });
});

describe('evaluateScenario fields used by the live predictions', () => {
  const [first, second] = scenarios;
  if (!first || !second) throw new Error('The simulated catalogue needs two scenarios.');

  it('measures fact coverage, request cost and the swapped signals run', async () => {
    const provider = new SimulatedTasteProvider();
    const outcome = await evaluateScenario(provider, first, {
      useOracle: true,
      placeboFor: () => second,
    });
    expect(outcome.ok).toBe(true);
    for (const share of [outcome.factCoverage.openWindow, outcome.factCoverage.stepFree]) {
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
    expect(outcome.providerCalls).toBeGreaterThanOrEqual(0);
    expect(outcome.placebo?.from).toBe(second.id);
    expect(outcome.placebo?.error).toBeUndefined();
    expect(outcome.placebo?.tasteOnTop.length).toBeGreaterThan(0);
    const overlap = outcome.placebo?.overlapAt3;
    expect(overlap === null || (overlap !== undefined && overlap >= 0 && overlap <= 1)).toBe(true);
  });

  it('runs no second ranking when no other plan is named', async () => {
    const outcome = await evaluateScenario(new SimulatedTasteProvider(), first, {
      useOracle: true,
    });
    expect(outcome.placebo).toBeNull();
  });
});
