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

describe('notes on what the gate and Qloo each contribute', () => {
  it('say that every gated approach ends with no violation and the same verified count', () => {
    const arms = ['random', 'nearest', 'popular', 'taste_only', 'afterglow'] as const;
    const lists = arms.map((arm) =>
      done.map((r) => r.gated[arm]).filter((l): l is NonNullable<typeof l> => l !== null),
    );
    for (const list of lists) {
      expect(list.reduce((sum, l) => sum + l.violations, 0)).toBe(0);
    }
    const means = lists.map(
      (list) => list.reduce((sum, l) => sum + l.verified, 0) / (list.length || 1),
    );
    for (const mean of means) expect(mean.toFixed(2)).toBe('1.05');
    expect(notes).toContain('the same mean of 1.05 verified places per list');
  });

  it('count the requirements that Qloo data can and cannot fail', () => {
    const scenarios = JSON.parse(read('evaluation/test-scenarios.json')) as Array<{
      anchor: { hardConstraints?: Array<{ kind: string }> };
    }>;
    const kinds: Record<string, number> = {};
    for (const s of scenarios) {
      for (const c of s.anchor.hardConstraints ?? []) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
    }
    const total = Object.values(kinds).reduce((sum, n) => sum + n, 0);
    const failable =
      (kinds['open_at_plan_time'] ?? 0) +
      (kinds['max_distance_km'] ?? 0) +
      (kinds['max_price_level'] ?? 0);
    expect(total).toBe(75);
    expect(failable).toBe(50);
    expect(kinds['open_at_plan_time']).toBe(20);
    expect(kinds['max_distance_km']).toBe(20);
    expect(kinds['max_price_level']).toBe(10);
    expect(kinds['fits_party_size']).toBe(10);
    expect(kinds['covered_space']).toBe(5);
    expect(kinds['step_free_access']).toBe(5);
    expect(kinds['dietary']).toBe(5);
    expect(notes).toContain('Of the 75 hard requirements');
    expect(notes).toContain('50 can be failed: opening hours (20), distance (20) and price (10)');
    expect(notes).toContain(
      'party size (10), covered seating (5), step free access (5) and diet (5)',
    );
  });

  it('quote the signal swap figures of the second live run', () => {
    const second = JSON.parse(read('results/live-qloo-second-run.json')) as {
      live: { metrics: Array<{ id: string; observed: number | null }> };
    };
    const observed = (id: string) => second.live.metrics.find((m) => m.id === id)?.observed;
    expect(two(observed('P4'))).toBe('0.70');
    expect(two(observed('P5'))).toBe('0.45');
    expect(two(observed('P9'))).toBe('0.40');
    expect(notes).toContain('left 0.70 of the top three unchanged');
    expect(notes).toContain('changed the top choice in 0.45 of scenarios');
    expect(notes).toContain('differed between Taste On and Taste Off in 0.40');
  });

  it('quote how many places the gate leaves', () => {
    const eligible = done.map((r) => r.eligible).sort((a, b) => a - b);
    const median = ((eligible[9] ?? NaN) + (eligible[10] ?? NaN)) / 2;
    expect(median).toBe(17);
    expect(eligible.filter((n) => n <= 3)).toHaveLength(2);
    expect(done.every((r) => r.poolSize === 40)).toBe(true);
    expect(notes).toContain('a median of 17 of the 40 places');
    expect(notes).toContain('three or fewer in 2 of the 20');
  });
});
