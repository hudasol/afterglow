import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { comparatorText, PREDICTIONS } from '../../src/evaluation/live-report.js';
import { BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED } from '../../src/evaluation/stats.js';

const root = resolve(import.meta.dirname, '../..');
const doc = readFileSync(resolve(root, 'docs/PREREGISTRATION.md'), 'utf8');
const scenarios = JSON.parse(
  readFileSync(resolve(root, 'evaluation/live-scenarios.json'), 'utf8'),
) as Array<{
  id: string;
  anchor: { city: string; partySize: number; planStart: string };
  placeboFrom?: string;
}>;

/** Table cells with the padding that the formatter adds removed. */
const cellsOf = (line: string): string[] => line.split('|').map((cell) => cell.trim());
const predictionRows = doc.split('\n').filter((line) => /^P\d+$/u.test(cellsOf(line)[1] ?? ''));

describe('preregistration document', () => {
  it('lists exactly the predictions that the evaluation code judges', () => {
    expect(predictionRows.map((row) => cellsOf(row)[1])).toEqual(PREDICTIONS.map((p) => p.id));
  });

  it.each(PREDICTIONS.map((p) => [p.id, p] as const))(
    '%s states the same experiment, measure and threshold as the code',
    (_id, prediction) => {
      const row = predictionRows.find((line) => cellsOf(line)[1] === prediction.id);
      expect(row).toBeDefined();
      const cells = cellsOf(row ?? '');
      expect(cells[2]).toBe(prediction.experiment.split(' ')[0]);
      expect(cells[3]).toBe(prediction.claim);
      expect(cells[4]).toBe(comparatorText(prediction));
    },
  );

  it('names the same random seed and number of resamples as the code', () => {
    expect(doc).toContain(`seed ${BOOTSTRAP_SEED}`);
    expect(doc).toContain(`${BOOTSTRAP_RESAMPLES.toLocaleString('en-US')} resamples`);
  });

  it('describes the frozen scenario file', () => {
    expect(scenarios).toHaveLength(20);
    expect(doc).toContain('There are 20 scenarios');
    const cities = [...new Set(scenarios.map((s) => s.anchor.city))];
    expect(cities).toHaveLength(5);
    for (const city of cities) expect(doc).toContain(city);
    expect(
      scenarios.every((s) => /^2026-11-0[2-7]T/u.test(s.anchor.planStart)),
      'plan dates',
    ).toBe(true);
    expect(doc).toContain('2 to 7 November 2026');
  });

  it('describes the four plans with the party sizes in the scenario file', () => {
    const sizes = new Map<string, Set<number>>();
    for (const s of scenarios) {
      const letter = s.id.split('-')[1] ?? '';
      sizes.set(letter, (sizes.get(letter) ?? new Set()).add(s.anchor.partySize));
    }
    expect([...sizes.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
    for (const set of sizes.values()) expect(set.size).toBe(1);
    const expected: Record<string, number> = { a: 2, b: 4, c: 3, d: 8 };
    for (const [letter, size] of Object.entries(expected)) {
      expect([...(sizes.get(letter) ?? [])]).toEqual([size]);
      const row = doc.split('\n').find((line) => cellsOf(line)[1]?.startsWith(`${letter}, `));
      expect(row, `row for plan ${letter}`).toBeDefined();
      expect(cellsOf(row ?? '')[3]).toBe(String(size));
    }
  });

  it('gives every scenario the signals of another plan in the same city', () => {
    for (const s of scenarios) {
      expect(s.placeboFrom, s.id).toBeDefined();
      const other = scenarios.find((x) => x.id === s.placeboFrom);
      expect(other, s.id).toBeDefined();
      expect(other?.anchor.city).toBe(s.anchor.city);
      expect(other?.id).not.toBe(s.id);
    }
  });

  it('does not use dashes or emojis in prose', () => {
    expect(doc).not.toMatch(/—|–/u);
    expect(doc).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
