import type { EvaluationReport, ScenarioResult } from './runner.js';

function pct(value: number | null): string {
  return value === null ? 'not available' : `${Math.round(value * 100)}%`;
}

function num(value: number | null, digits = 2): string {
  return value === null ? 'not available' : value.toFixed(digits);
}

function row(result: ScenarioResult): string {
  if (!result.ok) return `| ${result.id} | failed: ${result.error ?? 'unknown'} | | | | | |`;
  return [
    result.id,
    result.poolSize,
    `${result.rejected} / ${result.feasible} / ${result.needsVerification}`,
    `${result.ungatedTop.violationCount} of ${result.ungatedTop.names.length}`,
    `${result.gatedViolations.tasteOn} / ${result.gatedViolations.tasteOff}`,
    result.topChoiceChanged === null ? 'not available' : result.topChoiceChanged ? 'yes' : 'no',
    pct(result.overlapAt3),
  ].join(' | ');
}

export function renderReport(report: EvaluationReport): string {
  const s = report.summary;
  const simulated = report.kind === 'offline_simulated';
  const lines: string[] = [];
  lines.push(`# Evaluation results${simulated ? ': offline, simulated catalogue' : ': live Qloo'}`);
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Source: ${report.provider.label}`);
  lines.push(`Scenarios: ${s.completed} completed of ${s.scenarios}`);
  lines.push('');
  if (simulated) {
    lines.push(
      '> This report uses an invented catalogue and an invented affinity. It checks the behaviour of the pipeline. It is not evidence about the quality of Qloo recommendations.',
    );
    lines.push('');
  }
  lines.push('## Summary');
  lines.push('');
  lines.push('| Measure | Result |');
  lines.push('| --- | --- |');
  lines.push(
    `| Scenarios where an ungated top three contained a venue that breaks a hard constraint | ${s.ungatedScenariosWithViolation} of ${s.completed} |`,
  );
  lines.push(
    `| Ungated top three slots that break a hard constraint | ${s.ungatedTopSlotsViolating.violating} of ${s.ungatedTopSlotsViolating.total} |`,
  );
  lines.push(
    `| Violations in the gated top three, Taste On / Taste Off | ${s.gatedViolations.tasteOn} / ${s.gatedViolations.tasteOff} |`,
  );
  lines.push(
    `| Both arms offered the identical eligible set in every scenario | ${s.sameEligibleSetEverywhere ? 'yes' : 'no'} |`,
  );
  lines.push(
    `| Top choice differs between Taste On and Taste Off | ${s.topChoiceChanged.changed} of ${s.topChoiceChanged.compared} |`,
  );
  lines.push(`| Mean overlap of the top three | ${pct(s.meanOverlapAt3)} |`);
  lines.push(`| Mean Kendall tau between the two orderings | ${num(s.meanKendallTau)} |`);
  lines.push(
    `| Mean provider affinity of the top three, Taste On / Taste Off | ${num(s.meanAffinityTop3.tasteOn)} / ${num(s.meanAffinityTop3.tasteOff)} |`,
  );
  lines.push(
    `| Scenarios with no eligible option that offered a way forward | ${s.noFeasibleHandled.withWaysForward} of ${s.noFeasibleHandled.scenarios} |`,
  );
  lines.push('');
  lines.push('## Scenarios');
  lines.push('');
  lines.push(
    '| Scenario | Pool | Rejected / feasible / needs check | Ungated violations in top three | Gated violations On / Off | Top choice changed | Overlap at 3 |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const result of report.results) lines.push(`| ${row(result)} |`);
  lines.push('');
  lines.push('## Method');
  lines.push('');
  for (const item of report.method) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Limits');
  lines.push('');
  for (const item of report.limits) lines.push(`- ${item}`);
  lines.push('');
  return lines.join('\n');
}
