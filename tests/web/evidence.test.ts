import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { baselineRunView } from '../../src/evaluation/baseline-report.js';
import type { BaselineResultsFile } from '../../src/evaluation/baseline-report.js';
import { liveRunView } from '../../src/evaluation/live-report.js';
import type { LiveResultsFile } from '../../src/evaluation/live-report.js';
import {
  missedPredictions,
  missedInEveryLiveRun,
  swapOverlap,
  twoPlaces,
} from '../../web/src/lib/evidence.js';

const root = resolve(import.meta.dirname, '../..');
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(root, 'results', file), 'utf8')) as T;

const liveRuns = [
  liveRunView(read<LiveResultsFile>('live-qloo.json'), 'First run'),
  liveRunView(read<LiveResultsFile>('live-qloo-second-run.json'), 'Second run'),
];
const heldOut = baselineRunView(read<BaselineResultsFile>('baselines-test.json'), 'Test');

describe('evidence summary helpers', () => {
  it('read the signal swap overlap from the latest live run', () => {
    expect(swapOverlap(liveRuns)).toBe(0.7);
    expect(swapOverlap([])).toBeNull();
  });

  it('find the predictions missed in every live run', () => {
    expect(missedInEveryLiveRun(liveRuns)).toEqual(['P4', 'P5', 'P9']);
    expect(missedInEveryLiveRun([])).toEqual([]);
    expect(missedInEveryLiveRun([liveRuns[0]!])).toEqual(['P4', 'P5', 'P9']);
  });

  it('keep the missed test prediction with what was predicted and observed', () => {
    const missed = missedPredictions(heldOut);
    expect(missed.map((prediction) => prediction.id)).toEqual(['B14']);
    expect(missed[0]?.predicted).toBe('at most 0.20');
    expect(missed[0]?.observed).toBe('0.32');
  });

  it('writes a missing figure in words', () => {
    expect(twoPlaces(null)).toBe('not available');
    expect(twoPlaces(0.114)).toBe('0.11');
  });
});
