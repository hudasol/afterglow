/*
 * Summary, predictions and Markdown rendering for the live Qloo evaluation. The predictions here
 * were written down in docs/PREREGISTRATION.md before the first run. Every number in the rendered
 * report is computed from the results file, and a test fails when the two differ.
 */
import type { EvaluationReport, ScenarioResult } from './runner.js';
import {
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  bootstrapMean,
  median,
  wilson,
  type MeanInterval,
  type ProportionInterval,
} from './stats.js';

export type Verdict = 'HIT' | 'MISS' | 'NOT EVALUATED';

export interface Prediction {
  id: string;
  experiment: string;
  claim: string;
  comparator: '>=' | '<=' | '==';
  threshold: number;
  unit: 'share' | 'count' | 'scenarios';
}

/** Fixed before the first run. Changing a number here after seeing results is not allowed. */
export const PREDICTIONS: readonly Prediction[] = [
  {
    id: 'P1',
    experiment: 'E1 Practical facts from Qloo',
    claim: 'Mean share of the pool with known opening hours',
    comparator: '>=',
    threshold: 0.5,
    unit: 'share',
  },
  {
    id: 'P2',
    experiment: 'E1 Practical facts from Qloo',
    claim: 'Mean share of the pool with known step free access',
    comparator: '>=',
    threshold: 0.6,
    unit: 'share',
  },
  {
    id: 'P3',
    experiment: 'E1 Practical facts from Qloo',
    claim: 'Mean share of the pool with a known dietary fact, in scenarios that need one',
    comparator: '>=',
    threshold: 0.4,
    unit: 'share',
  },
  {
    id: 'P4',
    experiment: 'E2 Signal specificity',
    claim: 'Mean overlap at three of the Taste On top three, own signals against swapped signals',
    comparator: '<=',
    threshold: 0.5,
    unit: 'share',
  },
  {
    id: 'P5',
    experiment: 'E2 Signal specificity',
    claim: 'Share of scenarios whose Taste On top choice changes when the signals are swapped',
    comparator: '>=',
    threshold: 0.6,
    unit: 'share',
  },
  {
    id: 'P6',
    experiment: 'E3 The gate',
    claim: 'Share of scenarios where the ungated top three holds a place that breaks a requirement',
    comparator: '>=',
    threshold: 0.6,
    unit: 'share',
  },
  {
    id: 'P7',
    experiment: 'E3 The gate',
    claim:
      'Places breaking a requirement, judged by the independent oracle, in any gated top three',
    comparator: '==',
    threshold: 0,
    unit: 'count',
  },
  {
    id: 'P8',
    experiment: 'E3 The gate',
    claim: 'Share of scenarios with at least one fully verified place in the Taste On top three',
    comparator: '>=',
    threshold: 0.5,
    unit: 'share',
  },
  {
    id: 'P9',
    experiment: 'E4 Orderings',
    claim: 'Share of scenarios where the Taste On top choice differs from Taste Off',
    comparator: '>=',
    threshold: 0.7,
    unit: 'share',
  },
  {
    id: 'P10',
    experiment: 'E4 Orderings',
    claim: 'Share of scenarios where the Taste On top choice differs from Popular',
    comparator: '>=',
    threshold: 0.5,
    unit: 'share',
  },
  {
    id: 'P11',
    experiment: 'E5 Reliability and cost',
    claim: 'Scenarios that complete without an error',
    comparator: '>=',
    threshold: 18,
    unit: 'scenarios',
  },
  {
    id: 'P12',
    experiment: 'E5 Reliability and cost',
    claim: 'Median number of requests that reached Qloo per scenario, swapped signals run excluded',
    comparator: '<=',
    threshold: 15,
    unit: 'count',
  },
];

export interface MetricResult {
  id: string;
  /** The value compared with the threshold. Null when there was nothing to measure. */
  observed: number | null;
  /** The 95 percent interval, when one applies. */
  low: number | null;
  high: number | null;
  /** How many scenarios the value rests on, and of how many it could have rested. */
  basis: { used: number; of: number };
  verdict: Verdict;
}

export interface LiveSummary {
  bootstrap: { seed: number; resamples: number };
  metrics: MetricResult[];
  hits: number;
  misses: number;
  notEvaluated: number;
}

function judge(prediction: Prediction, observed: number | null): Verdict {
  if (observed === null) return 'NOT EVALUATED';
  const ok =
    prediction.comparator === '>='
      ? observed >= prediction.threshold
      : prediction.comparator === '<='
        ? observed <= prediction.threshold
        : observed === prediction.threshold;
  return ok ? 'HIT' : 'MISS';
}

function fromMean(interval: MeanInterval | null, of: number): Omit<MetricResult, 'id' | 'verdict'> {
  return {
    observed: interval?.mean ?? null,
    low: interval?.low ?? null,
    high: interval?.high ?? null,
    basis: { used: interval?.n ?? 0, of },
  };
}

function fromShare(
  interval: ProportionInterval | null,
  of: number,
): Omit<MetricResult, 'id' | 'verdict'> {
  return {
    observed: interval?.share ?? null,
    low: interval?.low ?? null,
    high: interval?.high ?? null,
    basis: { used: interval?.total ?? 0, of },
  };
}

export function summariseLive(results: readonly ScenarioResult[]): LiveSummary {
  const done = results.filter((r) => r.ok);
  const of = results.length;
  const numbers = (pick: (r: ScenarioResult) => number | null | undefined): number[] =>
    done.map(pick).filter((v): v is number => typeof v === 'number');
  const share = (
    pick: (r: ScenarioResult) => boolean | null | undefined,
  ): Omit<MetricResult, 'id' | 'verdict'> => {
    const values = done.map(pick).filter((v): v is boolean => typeof v === 'boolean');
    return fromShare(wilson(values.filter(Boolean).length, values.length), of);
  };

  const raw: Record<string, Omit<MetricResult, 'id' | 'verdict'>> = {
    P1: fromMean(bootstrapMean(numbers((r) => r.factCoverage.openWindow)), of),
    P2: fromMean(bootstrapMean(numbers((r) => r.factCoverage.stepFree)), of),
    P3: fromMean(bootstrapMean(numbers((r) => r.factCoverage.dietary)), of),
    P4: fromMean(bootstrapMean(numbers((r) => r.placebo?.overlapAt3)), of),
    P5: share((r) => r.placebo?.topChoiceChanged),
    P6: share((r) => r.ungatedTop.violationCount > 0),
    P7: {
      // With no completed scenario nothing was judged, so a count of zero would be vacuous.
      observed:
        done.length === 0
          ? null
          : done.reduce(
              (sum, r) => sum + r.gatedViolations.tasteOn + r.gatedViolations.tasteOff,
              0,
            ),
      low: null,
      high: null,
      basis: { used: done.length, of },
    },
    P8: share((r) => (r.tasteOnTop.length > 0 ? r.tasteOnFeasibleTop >= 1 : null)),
    P9: share((r) => r.topChoiceChanged),
    P10: share((r) => r.topChoiceChangedVsPopular),
    P11: { observed: done.length, low: null, high: null, basis: { used: done.length, of } },
    P12: {
      observed: median(numbers((r) => r.providerCalls)),
      low: null,
      high: null,
      basis: { used: done.length, of },
    },
  };

  const metrics = PREDICTIONS.map((prediction): MetricResult => {
    const value = raw[prediction.id] ?? {
      observed: null,
      low: null,
      high: null,
      basis: { used: 0, of },
    };
    return { id: prediction.id, ...value, verdict: judge(prediction, value.observed) };
  });
  return {
    bootstrap: { seed: BOOTSTRAP_SEED, resamples: BOOTSTRAP_RESAMPLES },
    metrics,
    hits: metrics.filter((m) => m.verdict === 'HIT').length,
    misses: metrics.filter((m) => m.verdict === 'MISS').length,
    notEvaluated: metrics.filter((m) => m.verdict === 'NOT EVALUATED').length,
  };
}

/** The file written by the live evaluation: the full report and the summary computed from it. */
export type LiveResultsFile = EvaluationReport & { live: LiveSummary };

function show(value: number | null, unit: Prediction['unit']): string {
  if (value === null) return 'n/a';
  if (unit === 'share') return value.toFixed(2);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function comparatorText(prediction: Prediction): string {
  const symbol =
    prediction.comparator === '>='
      ? 'at least'
      : prediction.comparator === '<='
        ? 'at most'
        : 'exactly';
  return `${symbol} ${show(prediction.threshold, prediction.unit)}`;
}

function cell(text: string): string {
  return text.replace(/\|/gu, '/').replace(/\s+/gu, ' ').trim();
}

export function renderLiveReport(file: LiveResultsFile): string {
  const { live } = file;
  const done = file.results.filter((r) => r.ok);
  const lines: string[] = [];
  lines.push('# Live evaluation on Qloo data');
  lines.push('');
  lines.push(
    'This file is generated by `npm run eval:live` from `results/live-qloo.json`. A test fails if it differs from that file. The predictions were written in [PREREGISTRATION.md](PREREGISTRATION.md) before the first run. Explanations of the misses are in [EVALUATION_LIVE_NOTES.md](EVALUATION_LIVE_NOTES.md).',
  );
  lines.push('');
  lines.push(`- Run at: ${file.generatedAt}`);
  lines.push(`- Provider: ${file.provider.label} (${file.provider.mode})`);
  lines.push(`- Scenarios: ${file.scenarioCount}, completed: ${done.length}`);
  lines.push(
    `- Intervals: 95 percent, bootstrap across scenarios for means (seed ${live.bootstrap.seed}, ${live.bootstrap.resamples} resamples) and Wilson score for shares. No predictive interval is claimed, so no coverage is reported.`,
  );
  lines.push(
    `- Predictions: ${live.hits} HIT, ${live.misses} MISS, ${live.notEvaluated} not evaluated`,
  );
  lines.push('');
  lines.push('## Predictions and results');
  lines.push('');
  lines.push(
    '| Id | Experiment | Measure | Predicted | Observed | 95% interval | Scenarios | Verdict |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const prediction of PREDICTIONS) {
    const metric = live.metrics.find((m) => m.id === prediction.id);
    if (!metric) continue;
    const interval =
      metric.low !== null && metric.high !== null
        ? `${show(metric.low, prediction.unit)} to ${show(metric.high, prediction.unit)}`
        : 'not applicable';
    lines.push(
      `| ${prediction.id} | ${cell(prediction.experiment)} | ${cell(prediction.claim)} | ${comparatorText(prediction)} | ${show(metric.observed, prediction.unit)} | ${interval} | ${metric.basis.used} of ${metric.basis.of} | ${metric.verdict} |`,
    );
  }
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  lines.push(
    '| Scenario | Pool | Rejected | Feasible | Needs check | Ungated top 3 breaking a requirement | Taste On top choice differs from Taste Off | Own against swapped signals, overlap at 3 | Requests to Qloo | Status |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of file.results) {
    lines.push(
      `| ${cell(r.id)} | ${r.poolSize} | ${r.rejected} | ${r.feasible} | ${r.needsVerification} | ${r.ungatedTop.violationCount} | ${r.topChoiceChanged === null ? 'n/a' : r.topChoiceChanged ? 'yes' : 'no'} | ${r.placebo?.overlapAt3 === null || r.placebo === null ? 'n/a' : r.placebo.overlapAt3.toFixed(2)} | ${r.providerCalls} | ${r.ok ? 'completed' : cell(`failed: ${r.error ?? 'unknown'}`)} |`,
    );
  }
  lines.push('');
  lines.push('## What this does not show');
  lines.push('');
  for (const limit of file.limits) lines.push(`- ${limit}`);
  lines.push(
    '- The scenarios were written by the team that built the method. The world they run in is real Qloo data, but the choice of cities, plans, constraints and signals is ours.',
  );
  lines.push(
    '- The swapped signals test shows that the ranking responds to the signals given. It does not show that the ranking is better for the person.',
  );
  lines.push(
    '- Facts Qloo does not state stay unknown, so the share of fully verified places is limited by Qloo coverage on the day of the run.',
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}
