import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BaselineResultsFile } from '../../src/evaluation/baseline-report.js';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const notes = read('docs/EVALUATION_BASELINES_NOTES.md');
const test = JSON.parse(read('results/baselines-test.json')) as BaselineResultsFile;
const dev = JSON.parse(read('results/baselines-dev.json')) as BaselineResultsFile;

const done = test.results.filter((r) => r.ok);
const two = (value: number | null | undefined) => (value ?? NaN).toFixed(2);
const metric = (id: string) => test.summary.metrics.find((m) => m.id === id);

describe('notes on the held out comparison', () => {
  it('state the verdicts of the predictions', () => {
    expect(test.summary.hits).toBe(13);
    expect(test.summary.misses).toBe(1);
    expect(metric('B14')?.verdict).toBe('MISS');
    expect(notes).toContain('Thirteen of the 14 predictions were met and one was missed.');
    expect(notes).toContain('The miss is B14.');
  });

  it('quote the B14 figures from the results', () => {
    const b14 = metric('B14');
    expect(notes).toContain(
      `${Math.round((b14?.observed ?? 0) * (b14?.basis.used ?? 0))} of ${b14?.basis.used} scenarios, ${two(b14?.observed)} (${two(b14?.low)} to ${two(b14?.high)})`,
    );
  });

  it('describe the scenarios where the top choices differ from the lists', () => {
    const gaps: number[] = [];
    const affinity: number[] = [];
    for (const r of done) {
      const a = r.gated.afterglow;
      const t = r.gated.taste_only;
      if (!a || !t || a.names[0] === t.names[0]) continue;
      gaps.push((t.places[0]?.distanceKm ?? NaN) - (a.places[0]?.distanceKm ?? NaN));
      affinity.push((t.places[0]?.affinity ?? NaN) - (a.places[0]?.affinity ?? NaN));
    }
    expect(gaps).toHaveLength(6);
    expect(notes).toContain(
      `between ${Math.min(...gaps).toFixed(1)} and ${Math.max(...gaps).toFixed(1)} km further`,
    );
    expect(Math.max(...affinity)).toBeLessThan(0.0115);
    expect(Math.max(...affinity)).toBeGreaterThan(0.0105);
    expect(notes).toContain('by at most 0.011');
  });

  it('count the places that break a requirement in each plain list', () => {
    const listed = (arm: 'nearest' | 'popular' | 'taste_only') =>
      done.reduce((sum, r) => sum + (r.ungated[arm]?.violations ?? 0), 0);
    const total = done.reduce((sum, r) => sum + (r.ungated.taste_only?.places.length ?? 0), 0);
    expect(total).toBe(60);
    expect(notes).toContain(
      `${listed('taste_only')} of the ${total} places in the taste only lists without the gate break a requirement, ${listed('popular')} in the popular lists and ${listed('nearest')} in the nearest first lists`,
    );
    const reasons = { hours: 0, distance: 0 };
    for (const r of done)
      for (const p of r.ungated.taste_only?.places ?? [])
        for (const reason of p.against) {
          if (reason === 'hours' || reason === 'distance') reasons[reason] += 1;
        }
    expect(notes).toContain(
      `(${reasons.hours} of the 60 taste only listings) or too far away (${reasons.distance})`,
    );
  });

  it('count the lists with no verified place and the empty pool', () => {
    const lists = done.map((r) => r.gated.afterglow).filter((l) => l !== null);
    const none = lists.filter((l) => l.verified === 0).length;
    const mean = lists.reduce((sum, l) => sum + l.verified, 0) / lists.length;
    expect(notes).toContain(`In ${none} of the ${lists.length} scenarios with a gated list`);
    expect(notes).toContain(`the mean is ${mean.toFixed(2)} verified places of three`);
    const devLists = dev.results.map((r) => r.gated.afterglow).filter((l) => l !== null);
    const devNone = devLists.filter((l) => l.verified === 0).length;
    expect(notes).toContain(`(${devNone} of ${devLists.length} lists with no verified place)`);
    const empty = done.filter((r) => r.eligible === 0);
    expect(empty.map((r) => r.id)).toEqual(['la-quiet-cafe-late']);
    expect(empty[0]?.poolSize).toBe(40);
  });

  it('quote the rates for the gate and the signal from the summary', () => {
    const arm = (name: string) => test.summary.arms.find((a) => a.arm === name && !a.gated);
    for (const [name, label] of [
      ['taste_only', '18 of 20'],
      ['popular', '20 of 20'],
      ['nearest', '10 of 20'],
    ] as const) {
      expect(`${arm(name)?.violating?.count} of ${arm(name)?.violating?.total}`).toBe(label);
      expect(notes).toContain(label);
    }
    const lift = test.summary.paired.find((p) => p.versus === 'nearest' && p.measure === 'lift');
    expect(notes).toContain(
      `${two(lift?.difference?.mean)} standard deviations (${two(lift?.difference?.low)} to ${two(lift?.difference?.high)})`,
    );
    const vibe = test.summary.paired.find((p) => p.versus === 'nearest' && p.measure === 'vibe');
    expect(notes).toContain(
      `${two(vibe?.difference?.mean)} (${two(vibe?.difference?.low)} to ${two(vibe?.difference?.high)})`,
    );
  });

  it('does not use dashes or emojis in prose', () => {
    expect(notes).not.toMatch(/—|–/u);
    expect(notes).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
