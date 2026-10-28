import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  recordedOrder,
  violationKinds,
  type BaselineResultsFile,
} from '../../src/evaluation/baseline-report.js';

const root = resolve(import.meta.dirname, '../..');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8').replace(/\s+/gu, ' ');
const test = JSON.parse(
  readFileSync(resolve(root, 'results/baselines-test.json'), 'utf8'),
) as BaselineResultsFile;
const s = test.summary;
const two = (value: number | null | undefined) => (value ?? NaN).toFixed(2);
const ungated = (arm: string) => s.arms.find((a) => a.arm === arm && !a.gated)?.violating;

describe('README figures', () => {
  it('match the recorded test comparison', () => {
    const rate = (arm: string) => `${ungated(arm)?.count} of ${ungated(arm)?.total}`;
    expect(readme).toContain(`${rate('taste_only')} scenarios for Qloo taste alone`);
    expect(readme).toContain(`${rate('popular')} for popularity`);
    expect(readme).toContain(`${rate('nearest')} for nearest first`);
    expect(readme).toContain(`${rate('random')} for random`);
    expect(readme).toContain(`${s.hits} of ${s.hits + s.misses + s.notEvaluated}`);
    expect(s.misses).toBe(1);
  });

  it('match the answer changes and the lift', () => {
    const nearest = s.topChoiceDiffers.nearest;
    const popular = s.topChoiceDiffers.popular;
    const taste = s.topChoiceDiffers.tasteOnly;
    expect(readme).toContain(`from nearest first in ${nearest?.count} of ${nearest?.total}`);
    expect(readme).toContain(`from popularity in ${popular?.count} of ${popular?.total}`);
    expect(readme).toContain(
      `In ${taste?.count} of ${taste?.total} scenarios the first place differs`,
    );
    const lift = s.paired.find((p) => p.versus === 'nearest' && p.measure === 'lift')?.difference;
    expect(readme).toContain(
      `${two(lift?.mean)} standard deviations above nearest first (${two(lift?.low)} to ${two(lift?.high)})`,
    );
    const km = s.paired.find((p) => p.versus === 'taste_only' && p.measure === 'km')?.difference;
    expect(readme).toContain(`${two(-(km?.mean ?? NaN))} km closer`);
  });

  it('match the vibe shares', () => {
    const row = (arm: string, gated: boolean) =>
      s.arms.find((a) => a.arm === arm && a.gated === gated);
    expect(readme).toContain(
      `(${two(row('afterglow', true)?.vibe?.mean)} against ${two(row('nearest', true)?.vibe?.mean)})`,
    );
  });

  it('match the lists with no verified place', () => {
    const lists = test.results.map((r) => r.gated.afterglow).filter((l) => l !== null);
    const none = lists.filter((l) => l.verified === 0).length;
    expect(readme).toContain(`In ${none} of the ${lists.length} scenarios with a gated list`);
  });

  it('agree with the recorded order example on how often the first choices differ', () => {
    const nearest = s.topChoiceDiffers.nearest;
    const order = recordedOrder(test);
    expect(order?.firstChoicesDiffer).toEqual({ count: nearest?.count, total: nearest?.total });
  });

  it('match the figures with distance set aside', () => {
    const beyond = Object.fromEntries(
      violationKinds(test.results).map((row) => [row.arm, row.scenariosBeyondDistance.count]),
    );
    expect(readme).toContain(
      `With distance set aside the figures are ${beyond['taste_only']}, ${beyond['popular']}, ${beyond['nearest']} and ${beyond['random']} of 20.`,
    );
  });

  it('match the signal swap figure of the second live run', () => {
    const second = JSON.parse(
      readFileSync(resolve(root, 'results/live-qloo-second-run.json'), 'utf8'),
    ) as { live: { metrics: Array<{ id: string; observed: number | null }> } };
    const p4 = second.live.metrics.find((m) => m.id === 'P4')?.observed;
    expect(readme).toContain(`left ${two(p4)} of the top three unchanged`);
  });

  it('does not use dashes or emojis in prose', () => {
    expect(readme).not.toMatch(/—|–/u);
    expect(readme).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
