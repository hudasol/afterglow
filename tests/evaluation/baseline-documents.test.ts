import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  renderBaselineReport,
  summariseBaselines,
  type BaselineResultsFile,
} from '../../src/evaluation/baseline-report.js';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

/** The recorded runs. The test run is checked as soon as its results file exists. */
const runs = [
  { set: 'dev', results: 'results/baselines-dev.json', doc: 'docs/EVALUATION_BASELINES_DEV.md' },
  {
    set: 'test',
    results: 'results/baselines-test.json',
    doc: 'docs/EVALUATION_BASELINES_TEST.md',
  },
].filter((run) => run.set === 'dev' || existsSync(resolve(root, run.results)));

describe.each(runs)('recorded baseline run: $set', (run) => {
  const file = JSON.parse(read(run.results)) as BaselineResultsFile;

  it('holds a summary that is exactly what the per scenario results give', () => {
    expect(file.summary).toEqual(JSON.parse(JSON.stringify(summariseBaselines(file.results))));
  });

  it('is rendered into the document without a number differing', () => {
    expect(read(run.doc)).toBe(renderBaselineReport(file));
  });

  it('came from the scenarios of its set, from a live provider', () => {
    expect(file.set).toBe(run.set);
    expect(file.provider.mode).toBe('live');
    expect(file.scenarioCount).toBe(file.results.length);
    expect(file.scenarioCount).toBe(20);
  });

  it('records no requirement broken by AFTERGLOW unless the summary says so', () => {
    const broken = file.results.reduce((sum, r) => sum + (r.gated.afterglow?.violations ?? 0), 0);
    const b1 = file.summary.metrics.find((m) => m.id === 'B1');
    expect(b1?.observed).toBe(broken);
  });
});
