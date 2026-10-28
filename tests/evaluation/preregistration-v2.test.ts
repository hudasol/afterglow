import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_PREDICTIONS,
  comparatorText,
  type BaselineResultsFile,
} from '../../src/evaluation/baseline-report.js';
import { BASELINE_SEED } from '../../src/evaluation/baselines.js';
import { BOOTSTRAP_RESAMPLES } from '../../src/evaluation/stats.js';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const doc = read('docs/PREREGISTRATION_V2.md');
const scenarioText = read('evaluation/test-scenarios.json');
const scenarios = JSON.parse(scenarioText) as Array<{
  id: string;
  anchor: { city: string; partySize: number; planStart: string };
}>;
const dev = JSON.parse(read('results/baselines-dev.json')) as BaselineResultsFile;

/** Table cells with the padding that the formatter adds removed. */
const cellsOf = (line: string): string[] => line.split('|').map((cell) => cell.trim());
const predictionRows = doc.split('\n').filter((line) => /^B\d+$/u.test(cellsOf(line)[1] ?? ''));

describe('second preregistration document', () => {
  it('lists exactly the predictions that the baseline report judges, in the same order', () => {
    expect(predictionRows.map((row) => cellsOf(row)[1])).toEqual(
      BASELINE_PREDICTIONS.map((p) => p.id),
    );
  });

  it.each(BASELINE_PREDICTIONS.map((p) => [p.id, p] as const))(
    '%s states the same group, measure and threshold as the code',
    (_id, prediction) => {
      const row = predictionRows.find((line) => cellsOf(line)[1] === prediction.id);
      expect(row).toBeDefined();
      const cells = cellsOf(row ?? '');
      expect(cells[2]).toBe(prediction.group);
      expect(cells[3]).toBe(prediction.claim);
      expect(cells[4]).toBe(comparatorText(prediction));
    },
  );

  it('sets every threshold by the stated rule from the development results', () => {
    const exempt = new Set(['B1', 'B13']);
    for (const prediction of BASELINE_PREDICTIONS) {
      if (exempt.has(prediction.id)) continue;
      const metric = dev.summary.metrics.find((m) => m.id === prediction.id);
      expect(metric, prediction.id).toBeDefined();
      if (prediction.comparator === '>=') {
        const expected = Math.floor((metric?.low ?? NaN) / 0.05) * 0.05;
        expect(prediction.threshold, prediction.id).toBeCloseTo(expected, 10);
      } else {
        const expected = Math.ceil((metric?.high ?? NaN) / 0.05) * 0.05;
        expect(prediction.threshold, prediction.id).toBeCloseTo(expected, 10);
      }
    }
  });

  it('names the same random seed and number of resamples as the code', () => {
    expect(doc).toContain(`seed ${BASELINE_SEED}`);
    expect(doc).toContain(`${BOOTSTRAP_RESAMPLES.toLocaleString('en-US')} resamples`);
  });

  it('freezes the test scenario file by its hash', () => {
    const hash = createHash('sha256').update(scenarioText).digest('hex');
    expect(doc).toContain(hash);
  });

  it('describes the test scenarios', () => {
    expect(scenarios).toHaveLength(20);
    expect(doc).toContain('the 20 in `evaluation/test-scenarios.json`');
    const cities = [...new Set(scenarios.map((s) => s.anchor.city))];
    expect(cities).toHaveLength(5);
    for (const city of cities) expect(doc).toContain(city);
    expect(
      scenarios.every((s) => /^2026-11-0[3-7]T/u.test(s.anchor.planStart)),
      'plan dates',
    ).toBe(true);
    expect(doc).toContain('3 to 7 November 2026');
  });

  it('uses no city that the development scenarios use', () => {
    const devCities = new Set(
      (
        JSON.parse(read('evaluation/live-scenarios.json')) as Array<{ anchor: { city: string } }>
      ).map((s) => s.anchor.city),
    );
    for (const s of scenarios) expect(devCities.has(s.anchor.city), s.id).toBe(false);
  });

  it('describes the four plans with the party sizes in the scenario file', () => {
    const plans: Array<[string, string, string]> = [
      ['rain-birthday-bar', 'rain, birthday bar', '6'],
      ['quiet-cafe-late', 'quiet cafe, late', '2'],
      ['family-halal-budget', 'family, halal, budget', '5'],
      ['jazz-party-grows', 'jazz, party grows', '4, then 7'],
    ];
    for (const [suffix, label, party] of plans) {
      const sizes = new Set(
        scenarios.filter((s) => s.id.endsWith(suffix)).map((s) => s.anchor.partySize),
      );
      expect(sizes.size, suffix).toBe(1);
      expect(String([...sizes][0]), suffix).toBe(party.split(',')[0]);
      const row = doc.split('\n').find((line) => cellsOf(line)[1] === label);
      expect(row, `row for ${label}`).toBeDefined();
      expect(cellsOf(row ?? '')[3]).toBe(party);
    }
  });

  it('links the documents it relies on', () => {
    for (const name of [
      'PREREGISTRATION.md',
      'EVALUATION_BASELINES_DEV.md',
      'EVALUATION_BASELINES_TEST.md',
      'QLOO_INTEGRATION.md',
    ]) {
      expect(doc, name).toContain(name);
    }
  });

  it('does not use dashes or emojis in prose', () => {
    expect(doc).not.toMatch(/—|–/u);
    expect(doc).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
