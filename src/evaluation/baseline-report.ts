/*
 * Summary, predictions and Markdown rendering for the baseline comparison. The predictions here are
 * the ones written in docs/PREREGISTRATION_V2.md before the test set was ranked. Every number in the
 * rendered report is computed from the results file, and a test fails when the two differ.
 */
import {
  BASELINE_SEED,
  GATED_ARMS,
  UNGATED_ARMS,
  type BaselineResult,
  type ListedPlace,
  type ListMeasures,
} from './baselines.js';
import {
  BOOTSTRAP_RESAMPLES,
  bootstrapDifference,
  bootstrapMean,
  median,
  wilson,
  type MeanInterval,
  type ProportionInterval,
} from './stats.js';

export type Verdict = 'HIT' | 'MISS' | 'NOT EVALUATED';
export type ScenarioSet = 'dev' | 'test';

export interface BaselinePrediction {
  id: string;
  group: string;
  claim: string;
  comparator: '>=' | '<=' | '==';
  threshold: number;
  unit: 'share' | 'count' | 'scenarios' | 'sd' | 'difference';
}

/** Fixed before the test set was ranked. Changing a number here after seeing results is not allowed. */
export const BASELINE_PREDICTIONS: readonly BaselinePrediction[] = [
  {
    id: 'B1',
    group: 'The gate',
    claim:
      'Places breaking a requirement, judged by the independent oracle, in any AFTERGLOW top three',
    comparator: '==',
    threshold: 0,
    unit: 'count',
  },
  {
    id: 'B2',
    group: 'The gate',
    claim:
      'Share of scenarios where the top three of the nearest first list without the gate holds a place that breaks a requirement',
    comparator: '>=',
    threshold: 0.45,
    unit: 'share',
  },
  {
    id: 'B3',
    group: 'The gate',
    claim:
      'Share of scenarios where the top three of the popular list without the gate holds a place that breaks a requirement',
    comparator: '>=',
    threshold: 0.5,
    unit: 'share',
  },
  {
    id: 'B4',
    group: 'The gate',
    claim:
      'Share of scenarios where the top three of the taste only list without the gate holds a place that breaks a requirement',
    comparator: '>=',
    threshold: 0.7,
    unit: 'share',
  },
  {
    id: 'B5',
    group: 'Qloo signal',
    claim: 'Share of the pool that Qloo scored, mean over scenarios',
    comparator: '>=',
    threshold: 0.95,
    unit: 'share',
  },
  {
    id: 'B6',
    group: 'Qloo signal',
    claim:
      'Share of scenarios where the AFTERGLOW top choice differs from the nearest first top choice',
    comparator: '>=',
    threshold: 0.4,
    unit: 'share',
  },
  {
    id: 'B7',
    group: 'Qloo signal',
    claim: 'Share of scenarios where the AFTERGLOW top choice differs from the popular top choice',
    comparator: '>=',
    threshold: 0.35,
    unit: 'share',
  },
  {
    id: 'B8',
    group: 'Qloo signal',
    claim:
      'Affinity lift of the AFTERGLOW top three minus the nearest first top three, in standard deviations of the pool',
    comparator: '>=',
    threshold: 0.5,
    unit: 'sd',
  },
  {
    id: 'B9',
    group: 'Qloo signal',
    claim:
      'Affinity lift of the AFTERGLOW top three minus the taste only top three, in standard deviations of the pool',
    comparator: '>=',
    threshold: -0.05,
    unit: 'sd',
  },
  {
    id: 'B10',
    group: 'Qloo signal',
    claim:
      'Share of the AFTERGLOW top three that carries a requested vibe, minus the same for the nearest first top three',
    comparator: '>=',
    threshold: -0.05,
    unit: 'difference',
  },
  {
    id: 'B11',
    group: 'Qloo signal',
    claim:
      'Share of the pool that Qloo scored with vibes sent as example places, minus the same with vibes sent as tags',
    comparator: '>=',
    threshold: 0.15,
    unit: 'difference',
  },
  {
    id: 'B12',
    group: 'Closeness',
    claim:
      'Share of scenarios where the AFTERGLOW top three is no further from the venue that fell through than the taste only top three',
    comparator: '>=',
    threshold: 0.8,
    unit: 'share',
  },
  {
    id: 'B13',
    group: 'Reliability',
    claim: 'Scenarios that complete without an error',
    comparator: '>=',
    threshold: 18,
    unit: 'scenarios',
  },
  {
    id: 'B14',
    group: 'Qloo signal',
    claim:
      'Share of scenarios where the AFTERGLOW top choice differs from the taste only top choice',
    comparator: '<=',
    threshold: 0.2,
    unit: 'share',
  },
];

export interface ArmRow {
  arm: string;
  gated: boolean;
  scenarios: number;
  /** Share of scenarios whose top three holds a place that breaks a requirement. */
  violating: ProportionInterval | null;
  meanViolations: number | null;
  km: MeanInterval | null;
  lift: MeanInterval | null;
  vibe: MeanInterval | null;
  /** Mean number of fully verified places in the top three. */
  verified: MeanInterval | null;
}

export type PairedMeasure = 'km' | 'lift' | 'vibe';

export interface PairedRow {
  versus: string;
  measure: PairedMeasure;
  difference: MeanInterval | null;
}

export interface MetricResult {
  id: string;
  observed: number | null;
  low: number | null;
  high: number | null;
  basis: { used: number; of: number };
  verdict: Verdict;
}

export interface BaselineSummary {
  seed: number;
  resamples: number;
  arms: ArmRow[];
  paired: PairedRow[];
  coverage: {
    scoredShare: MeanInterval | null;
    spread: MeanInterval | null;
    fullyScored: ProportionInterval | null;
    exemplarsUsed: ProportionInterval | null;
  };
  topChoiceDiffers: {
    nearest: ProportionInterval | null;
    popular: ProportionInterval | null;
    tasteOnly: ProportionInterval | null;
  };
  closerThanTasteOnly: ProportionInterval | null;
  ablation: {
    scenarios: number;
    exemplarScoredShare: MeanInterval | null;
    tagScoredShare: MeanInterval | null;
    scoredShareDifference: MeanInterval | null;
    exemplarSpread: MeanInterval | null;
    tagSpread: MeanInterval | null;
    exemplarDiffersFromNearest: ProportionInterval | null;
    tagDiffersFromNearest: ProportionInterval | null;
  };
  completed: number;
  medianProviderCalls: number | null;
  metrics: MetricResult[];
  hits: number;
  misses: number;
  notEvaluated: number;
}

function judge(prediction: BaselinePrediction, observed: number | null): Verdict {
  if (observed === null) return 'NOT EVALUATED';
  const ok =
    prediction.comparator === '>='
      ? observed >= prediction.threshold
      : prediction.comparator === '<='
        ? observed <= prediction.threshold
        : observed === prediction.threshold;
  return ok ? 'HIT' : 'MISS';
}

const numbers = (values: ReadonlyArray<number | null | undefined>): number[] =>
  values.filter((v): v is number => typeof v === 'number');

function shareOf(values: ReadonlyArray<boolean | null | undefined>): ProportionInterval | null {
  const known = values.filter((v): v is boolean => typeof v === 'boolean');
  return wilson(known.filter(Boolean).length, known.length);
}

function listOf(result: BaselineResult, arm: string, gated: boolean): ListMeasures | null {
  const table = (gated ? result.gated : result.ungated) as Record<string, ListMeasures | null>;
  return table[arm] ?? null;
}

export function summariseBaselines(results: readonly BaselineResult[]): BaselineSummary {
  const done = results.filter((r) => r.ok);
  const seed = BASELINE_SEED;

  const armRow = (arm: string, gated: boolean): ArmRow => {
    const lists = done
      .map((r) => listOf(r, arm, gated))
      .filter((l): l is ListMeasures => l !== null);
    return {
      arm,
      gated,
      scenarios: lists.length,
      violating: shareOf(lists.map((l) => l.violations > 0)),
      meanViolations:
        lists.length === 0 ? null : lists.reduce((a, l) => a + l.violations, 0) / lists.length,
      km: bootstrapMean(numbers(lists.map((l) => l.meanKm)), seed),
      lift: bootstrapMean(numbers(lists.map((l) => l.affinityLift)), seed),
      vibe: bootstrapMean(numbers(lists.map((l) => l.vibeShare)), seed),
      verified: bootstrapMean(
        lists.map((l) => l.verified),
        seed,
      ),
    };
  };
  const arms = [
    ...GATED_ARMS.map((arm) => armRow(arm, true)),
    ...UNGATED_ARMS.map((arm) => armRow(arm, false)),
  ];

  const measureOf: Record<PairedMeasure, (l: ListMeasures) => number | null> = {
    km: (l) => l.meanKm,
    lift: (l) => l.affinityLift,
    vibe: (l) => l.vibeShare,
  };
  const paired: PairedRow[] = [];
  for (const versus of ['nearest', 'popular', 'taste_only', 'random'] as const) {
    for (const measure of ['km', 'lift', 'vibe'] as const) {
      const pairs: Array<[number, number]> = [];
      for (const r of done) {
        const ours = r.gated.afterglow;
        const theirs = r.gated[versus];
        if (!ours || !theirs) continue;
        const a = measureOf[measure](ours);
        const b = measureOf[measure](theirs);
        if (a !== null && b !== null) pairs.push([a, b]);
      }
      paired.push({ versus, measure, difference: bootstrapDifference(pairs, seed) });
    }
  }

  const closer = done.map((r) => {
    const ours = r.gated.afterglow?.meanKm ?? null;
    const theirs = r.gated.taste_only?.meanKm ?? null;
    return ours === null || theirs === null ? null : ours <= theirs + 1e-9;
  });

  const withAblation = done.filter((r) => r.ablationTags !== null);
  const ablationPairs: Array<[number, number]> = withAblation.map((r) => [
    r.coverage.scoredShare,
    r.ablationTags?.scoredShare ?? 0,
  ]);

  const calls = numbers(done.map((r) => r.providerCalls));
  const summary: BaselineSummary = {
    seed,
    resamples: BOOTSTRAP_RESAMPLES,
    arms,
    paired,
    coverage: {
      scoredShare: bootstrapMean(
        done.map((r) => r.coverage.scoredShare),
        seed,
      ),
      spread: bootstrapMean(numbers(done.map((r) => r.coverage.spread)), seed),
      fullyScored: shareOf(done.map((r) => r.coverage.scoredShare >= 0.999)),
      exemplarsUsed: shareOf(done.map((r) => r.coverage.exemplarCount > 0)),
    },
    topChoiceDiffers: {
      nearest: shareOf(done.map((r) => r.topChoiceDiffers.nearest)),
      popular: shareOf(done.map((r) => r.topChoiceDiffers.popular)),
      tasteOnly: shareOf(done.map((r) => r.topChoiceDiffers.tasteOnly)),
    },
    closerThanTasteOnly: shareOf(closer),
    ablation: {
      scenarios: withAblation.length,
      exemplarScoredShare: bootstrapMean(
        withAblation.map((r) => r.coverage.scoredShare),
        seed,
      ),
      tagScoredShare: bootstrapMean(
        withAblation.map((r) => r.ablationTags?.scoredShare ?? 0),
        seed,
      ),
      scoredShareDifference: bootstrapDifference(ablationPairs, seed),
      exemplarSpread: bootstrapMean(numbers(withAblation.map((r) => r.coverage.spread)), seed),
      tagSpread: bootstrapMean(numbers(withAblation.map((r) => r.ablationTags?.spread)), seed),
      exemplarDiffersFromNearest: shareOf(withAblation.map((r) => r.topChoiceDiffers.nearest)),
      tagDiffersFromNearest: shareOf(
        withAblation.map((r) => r.ablationTags?.topChoiceDiffersNearest),
      ),
    },
    completed: done.length,
    medianProviderCalls: median(calls),
    metrics: [],
    hits: 0,
    misses: 0,
    notEvaluated: 0,
  };

  const of = results.length;
  const mean = (interval: MeanInterval | null) => ({
    observed: interval?.mean ?? null,
    low: interval?.low ?? null,
    high: interval?.high ?? null,
    basis: { used: interval?.n ?? 0, of },
  });
  const share = (interval: ProportionInterval | null) => ({
    observed: interval?.share ?? null,
    low: interval?.low ?? null,
    high: interval?.high ?? null,
    basis: { used: interval?.total ?? 0, of },
  });
  const arm = (name: string, gated: boolean) =>
    arms.find((a) => a.arm === name && a.gated === gated);
  const diff = (versus: string, measure: PairedMeasure) =>
    paired.find((p) => p.versus === versus && p.measure === measure)?.difference ?? null;

  const raw: Record<string, Omit<MetricResult, 'id' | 'verdict'>> = {
    B1: {
      observed:
        done.length === 0
          ? null
          : done.reduce((sum, r) => sum + (r.gated.afterglow?.violations ?? 0), 0),
      low: null,
      high: null,
      basis: { used: done.length, of },
    },
    B2: share(arm('nearest', false)?.violating ?? null),
    B3: share(arm('popular', false)?.violating ?? null),
    B4: share(arm('taste_only', false)?.violating ?? null),
    B5: mean(summary.coverage.scoredShare),
    B6: share(summary.topChoiceDiffers.nearest),
    B7: share(summary.topChoiceDiffers.popular),
    B8: mean(diff('nearest', 'lift')),
    B9: mean(diff('taste_only', 'lift')),
    B10: mean(diff('nearest', 'vibe')),
    B11: mean(summary.ablation.scoredShareDifference),
    B12: share(summary.closerThanTasteOnly),
    B14: share(summary.topChoiceDiffers.tasteOnly),
    B13: { observed: done.length, low: null, high: null, basis: { used: done.length, of } },
  };
  summary.metrics = BASELINE_PREDICTIONS.map((prediction): MetricResult => {
    const value = raw[prediction.id] ?? {
      observed: null,
      low: null,
      high: null,
      basis: { used: 0, of },
    };
    return { id: prediction.id, ...value, verdict: judge(prediction, value.observed) };
  });
  summary.hits = summary.metrics.filter((m) => m.verdict === 'HIT').length;
  summary.misses = summary.metrics.filter((m) => m.verdict === 'MISS').length;
  summary.notEvaluated = summary.metrics.filter((m) => m.verdict === 'NOT EVALUATED').length;
  return summary;
}

/** The file written by a baseline run: the results of every scenario and the summary computed from them. */
export interface BaselineResultsFile {
  kind: 'baseline_comparison';
  set: ScenarioSet;
  generatedAt: string;
  provider: { label: string; mode: string };
  scenarioCount: number;
  results: BaselineResult[];
  summary: BaselineSummary;
}

function two(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

function showValue(value: number | null, unit: BaselinePrediction['unit']): string {
  if (value === null) return 'n/a';
  if (unit === 'count' || unit === 'scenarios') {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return value.toFixed(2);
}

export function comparatorText(prediction: BaselinePrediction): string {
  const symbol =
    prediction.comparator === '>='
      ? 'at least'
      : prediction.comparator === '<='
        ? 'at most'
        : 'exactly';
  return `${symbol} ${showValue(prediction.threshold, prediction.unit)}`;
}

function cell(text: string): string {
  return text.replace(/\|/gu, '/').replace(/\s+/gu, ' ').trim();
}

const interval = (i: MeanInterval | null): string =>
  i === null ? 'n/a' : `${two(i.mean)} (${two(i.low)} to ${two(i.high)})`;
const proportion = (i: ProportionInterval | null): string =>
  i === null
    ? 'n/a'
    : `${i.count} of ${i.total}, ${two(i.share)} (${two(i.low)} to ${two(i.high)})`;

/** The oracle's short codes in words a reader of the report can follow. */
export function reasonText(code: string): string {
  if (code === 'price') return 'over the price limit';
  if (code === 'distance') return 'too far away';
  if (code === 'hours') return 'closed during the plan';
  if (code === 'capacity') return 'too small for the party';
  if (code === 'covered') return 'not covered';
  if (code === 'step_free') return 'not step free';
  if (code === 'is the original venue') return 'the venue that fell through';
  if (code.startsWith('dietary:')) return `not ${code.slice('dietary:'.length)}`;
  return code;
}

function placeText(place: ListedPlace): string {
  return place.against.length === 0
    ? place.name
    : `${place.name} (${place.against.map(reasonText).join(', ')})`;
}

const ARM_LABEL: Record<string, string> = {
  random: 'Random',
  nearest: 'Nearest first',
  popular: 'Popular',
  taste_only: 'Taste only',
  afterglow: 'AFTERGLOW',
};

export function renderBaselineReport(file: BaselineResultsFile): string {
  const s = file.summary;
  const test = file.set === 'test';
  const lines: string[] = [];
  lines.push(
    test
      ? '# Baseline comparison on the test scenarios'
      : '# Baseline comparison on the development scenarios',
  );
  lines.push('');
  lines.push(
    test
      ? 'This file is generated by `npm run eval:baselines` from `results/baselines-test.json`. A test fails if it differs from that file. The predictions were written in [PREREGISTRATION_V2.md](PREREGISTRATION_V2.md) before these scenarios were ranked.'
      : 'This file is generated by `npm run eval:baselines` from `results/baselines-dev.json`. A test fails if it differs from that file. These are the first 20 scenarios, the ones the product was developed against. They are reported for transparency and were used to set the predictions for the test scenarios. They are not evidence of how the product behaves on plans it has not seen.',
  );
  lines.push('');
  lines.push(`- Run at: ${file.generatedAt}`);
  lines.push(`- Provider: ${file.provider.label} (${file.provider.mode})`);
  lines.push(`- Scenarios: ${file.scenarioCount}, completed: ${s.completed}`);
  lines.push(
    `- Intervals: 95 percent. Bootstrap across scenarios for means, with whole scenarios resampled for paired differences (seed ${s.seed}, ${s.resamples.toLocaleString('en-US')} resamples). Wilson score for shares.`,
  );
  if (test) {
    lines.push(`- Predictions: ${s.hits} HIT, ${s.misses} MISS, ${s.notEvaluated} not evaluated`);
  }
  lines.push('');

  if (test) {
    lines.push('## Predictions and results');
    lines.push('');
    lines.push(
      '| Id | Group | Measure | Predicted | Observed | 95% interval | Scenarios | Verdict |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const prediction of BASELINE_PREDICTIONS) {
      const metric = s.metrics.find((m) => m.id === prediction.id);
      if (!metric) continue;
      const range =
        metric.low !== null && metric.high !== null
          ? `${showValue(metric.low, prediction.unit)} to ${showValue(metric.high, prediction.unit)}`
          : 'not applicable';
      lines.push(
        `| ${prediction.id} | ${cell(prediction.group)} | ${cell(prediction.claim)} | ${comparatorText(prediction)} | ${showValue(metric.observed, prediction.unit)} | ${range} | ${metric.basis.used} of ${metric.basis.of} | ${metric.verdict} |`,
      );
    }
    lines.push('');
  }

  lines.push('## What each approach puts in the top three');
  lines.push('');
  lines.push(
    'Every approach ranks the same pool of places for the same plan. With the gate, places that fail a requirement on a known fact are removed first. Without it, the venue that fell through is left out and nothing else is checked, which is how a plain recommender behaves. A place counts as breaking a requirement when the independent oracle finds a known fact against it. Unknown facts are never counted against a place.',
  );
  lines.push('');
  lines.push(
    '| Approach | Gate | Scenarios | Top three breaks a requirement | Places breaking a requirement per list | Verified places per list | Mean km from the venue | Affinity lift | Share with a requested vibe |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of s.arms) {
    lines.push(
      `| ${ARM_LABEL[row.arm] ?? row.arm} | ${row.gated ? 'yes' : 'no'} | ${row.scenarios} | ${proportion(row.violating)} | ${two(row.meanViolations)} | ${interval(row.verified)} | ${interval(row.km)} | ${interval(row.lift)} | ${interval(row.vibe)} |`,
    );
  }
  lines.push('');
  lines.push(
    'Affinity lift is the mean Qloo affinity of the top three minus the mean of the places that passed the gate, divided by the standard deviation of the same places. Zero means no better than the pool on average. Qloo affinity is the quantity AFTERGLOW and the taste only list both rank by, so the lift shows that the Qloo signal is being used. It is not a measure of what a person would prefer.',
    '',
    'The count of verified places is the same for every gated approach by construction. The gate lists places whose facts are all confirmed before places that need a check, whatever the approach, so each list holds as many verified places as the pool has, up to three. Nearest first has no distance to rank by when the venue that fell through could not be located, so it covers fewer scenarios than the others.',
  );
  lines.push('');

  lines.push('## AFTERGLOW against each gated baseline, scenario by scenario');
  lines.push('');
  lines.push('| Against | Measure | Mean difference (AFTERGLOW minus the other) |');
  lines.push('| --- | --- | --- |');
  const measureLabel: Record<PairedMeasure, string> = {
    km: 'Mean km from the venue',
    lift: 'Affinity lift',
    vibe: 'Share with a requested vibe',
  };
  for (const row of s.paired) {
    lines.push(
      `| ${ARM_LABEL[row.versus] ?? row.versus} | ${measureLabel[row.measure]} | ${interval(row.difference)} |`,
    );
  }
  lines.push('');

  lines.push('## Qloo coverage and how often the answer changes');
  lines.push('');
  lines.push(`- Share of the pool that Qloo scored: ${interval(s.coverage.scoredShare)}`);
  lines.push(`- Scenarios where every place was scored: ${proportion(s.coverage.fullyScored)}`);
  lines.push(
    `- Spread of affinity across the pool, largest minus smallest: ${interval(s.coverage.spread)}`,
  );
  lines.push(
    `- Scenarios where vibes were sent as example places: ${proportion(s.coverage.exemplarsUsed)}`,
  );
  lines.push(
    `- AFTERGLOW top choice differs from nearest first: ${proportion(s.topChoiceDiffers.nearest)}`,
  );
  lines.push(
    `- AFTERGLOW top choice differs from popular: ${proportion(s.topChoiceDiffers.popular)}`,
  );
  lines.push(
    `- AFTERGLOW top choice differs from taste only: ${proportion(s.topChoiceDiffers.tasteOnly)}`,
  );
  lines.push(
    `- AFTERGLOW top three no further than the taste only top three: ${proportion(s.closerThanTasteOnly)}`,
  );
  lines.push('');

  lines.push('## Vibes as example places against vibes as tags');
  lines.push('');
  lines.push(
    `The same plans were ranked a second time with the vibes sent to Qloo as tag signals, as the first version of the product did. ${s.ablation.scenarios} scenarios have both.`,
  );
  lines.push('');
  lines.push('| Measure | Example places | Tags |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| Share of the pool scored | ${interval(s.ablation.exemplarScoredShare)} | ${interval(s.ablation.tagScoredShare)} |`,
  );
  lines.push(
    `| Spread of affinity | ${interval(s.ablation.exemplarSpread)} | ${interval(s.ablation.tagSpread)} |`,
  );
  lines.push(
    `| Top choice differs from nearest first | ${proportion(s.ablation.exemplarDiffersFromNearest)} | ${proportion(s.ablation.tagDiffersFromNearest)} |`,
  );
  lines.push('');
  lines.push(
    `Difference in the share scored, example places minus tags: ${interval(s.ablation.scoredShareDifference)}`,
  );
  lines.push('');

  lines.push('## Scenarios');
  lines.push('');
  lines.push(
    '| Scenario | Pool | Eligible | Scored by Qloo | AFTERGLOW breaks a requirement | Nearest first without the gate | Popular without the gate | Taste only without the gate | Status |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of file.results) {
    const count = (list: ListMeasures | null) => (list === null ? 'n/a' : String(list.violations));
    lines.push(
      `| ${cell(r.id)} | ${r.poolSize} | ${r.eligible} | ${r.coverage.scored} | ${count(r.gated.afterglow)} | ${count(r.ungated.nearest)} | ${count(r.ungated.popular)} | ${count(r.ungated.taste_only)} | ${r.ok ? 'completed' : cell(`failed: ${r.error ?? 'unknown'}`)} |`,
    );
  }
  lines.push('');
  lines.push('## The lists, place by place');
  lines.push('');
  lines.push(
    'The AFTERGLOW top three next to the taste only top three without the gate. A reason in brackets is what the independent oracle finds against that place on a known fact.',
  );
  lines.push('');
  lines.push('| Scenario | AFTERGLOW top three | Taste only top three without the gate |');
  lines.push('| --- | --- | --- |');
  for (const r of file.results) {
    if (!r.ok) continue;
    const ours = (r.gated.afterglow?.places ?? []).map(placeText).join('; ');
    const theirs = (r.ungated.taste_only?.places ?? []).map(placeText).join('; ');
    lines.push(`| ${cell(r.id)} | ${cell(ours) || 'none'} | ${cell(theirs) || 'none'} |`);
  }
  lines.push('');
  lines.push('## What this does not show');
  lines.push('');
  lines.push(
    '- No person judged any list. The measures are requirement violations, distance, Qloo affinity and tag overlap. They show whether the pieces of the method do what they are meant to do, not whether people would prefer the result.',
  );
  lines.push(
    '- Requirement violations are counted only where a fact is known. A place with an unknown fact is never counted against, so the violation counts of every approach are lower bounds.',
  );
  lines.push(
    '- The scenarios were written by the team that built the method. The places and their facts are real Qloo data, but the cities, plans, requirements and signals are our choice.',
  );
  lines.push(
    '- A language model without Qloo data is not among these baselines in this file. See the preregistration for how and when it is added.',
  );
  lines.push('');
  return `${lines.join('\n')}\n`;
}

/** One recorded scenario, shown on the front page next to the claim it illustrates. */
export interface RecordedExample {
  set: ScenarioSet;
  generatedAt: string;
  providerLabel: string;
  scenarioId: string;
  title: string;
  /** The top three of the taste only list without the gate, with what each place breaks. */
  plain: Array<{ name: string; reasons: string[] }>;
  /** The AFTERGLOW top three. */
  afterglow: Array<{ name: string; needsCheck: boolean }>;
  /** How many completed scenarios of the run had a place breaking a requirement in the plain list. */
  plainBreaking: { count: number; total: number };
}

/**
 * The first scenario, in the order of the scenario file, in which the plain taste only list holds a
 * place that breaks a requirement and AFTERGLOW offers something. The rule is fixed and is stated
 * next to the example, so the example is not picked by hand.
 */
export function recordedExample(file: BaselineResultsFile): RecordedExample | null {
  const done = file.results.filter((r) => r.ok);
  const pick = done.find(
    (r) =>
      (r.ungated.taste_only?.violations ?? 0) > 0 && (r.gated.afterglow?.places.length ?? 0) > 0,
  );
  if (!pick) return null;
  return {
    set: file.set,
    generatedAt: file.generatedAt,
    providerLabel: file.provider.label,
    scenarioId: pick.id,
    title: pick.title,
    plain: (pick.ungated.taste_only?.places ?? []).map((place) => ({
      name: place.name,
      reasons: place.against.map(reasonText),
    })),
    afterglow: (pick.gated.afterglow?.places ?? []).map((place) => ({
      name: place.name,
      needsCheck: place.feasibility !== 'feasible',
    })),
    plainBreaking: {
      count: done.filter((r) => (r.ungated.taste_only?.violations ?? 0) > 0).length,
      total: done.length,
    },
  };
}

export interface BaselinePredictionView {
  id: string;
  group: string;
  claim: string;
  predicted: string;
  observed: string;
  interval: string;
  scenarios: string;
  verdict: Verdict;
}

export interface BaselineArmView {
  approach: string;
  gate: boolean;
  scenarios: number;
  breaking: string;
  perList: string;
  km: string;
  lift: string;
  vibe: string;
}

/** A compact view of a recorded run for the Evidence page. The text is the same as in the generated document. */
export interface BaselineRunView {
  set: ScenarioSet;
  label: string;
  generatedAt: string;
  providerLabel: string;
  scenarios: number;
  completed: number;
  hits: number;
  misses: number;
  notEvaluated: number;
  /** Empty for the development scenarios, which were used to set the predictions and carry none. */
  predictions: BaselinePredictionView[];
  arms: BaselineArmView[];
}

export function baselineRunView(file: BaselineResultsFile, label: string): BaselineRunView {
  const s = file.summary;
  const predictions: BaselinePredictionView[] = [];
  if (file.set === 'test') {
    for (const prediction of BASELINE_PREDICTIONS) {
      const metric = s.metrics.find((m) => m.id === prediction.id);
      if (!metric) continue;
      predictions.push({
        id: prediction.id,
        group: prediction.group,
        claim: prediction.claim,
        predicted: comparatorText(prediction),
        observed: showValue(metric.observed, prediction.unit),
        interval:
          metric.low !== null && metric.high !== null
            ? `${showValue(metric.low, prediction.unit)} to ${showValue(metric.high, prediction.unit)}`
            : 'not applicable',
        scenarios: `${metric.basis.used} of ${metric.basis.of}`,
        verdict: metric.verdict,
      });
    }
  }
  return {
    set: file.set,
    label,
    generatedAt: file.generatedAt,
    providerLabel: file.provider.label,
    scenarios: file.scenarioCount,
    completed: s.completed,
    hits: s.hits,
    misses: s.misses,
    notEvaluated: s.notEvaluated,
    predictions,
    arms: s.arms.map((row) => ({
      approach: ARM_LABEL[row.arm] ?? row.arm,
      gate: row.gated,
      scenarios: row.scenarios,
      breaking: proportion(row.violating),
      perList: two(row.meanViolations),
      km: interval(row.km),
      lift: interval(row.lift),
      vibe: interval(row.vibe),
    })),
  };
}
