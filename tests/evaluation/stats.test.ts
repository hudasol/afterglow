import { describe, expect, it } from 'vitest';
import {
  bootstrapDifference,
  bootstrapMean,
  median,
  mulberry32,
  wilson,
} from '../../src/evaluation/stats.js';

describe('seeded generator', () => {
  it('gives the same sequence for the same seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });
});

describe('bootstrap mean', () => {
  it('returns nothing for no values', () => {
    expect(bootstrapMean([])).toBeNull();
  });

  it('collapses to the value when every value is the same', () => {
    expect(bootstrapMean([0.5, 0.5, 0.5, 0.5])).toEqual({ n: 4, mean: 0.5, low: 0.5, high: 0.5 });
  });

  it('is repeatable and brackets the mean', () => {
    const values = [0.1, 0.4, 0.5, 0.9, 0.3, 0.7, 0.2, 0.8, 0.6, 0.5];
    const first = bootstrapMean(values);
    expect(bootstrapMean(values)).toEqual(first);
    expect(first?.mean).toBeCloseTo(0.5);
    expect(first?.low).toBeLessThan(0.5);
    expect(first?.high).toBeGreaterThan(0.5);
    expect(first?.low).toBeGreaterThan(0.1);
    expect(first?.high).toBeLessThan(0.9);
  });
});

describe('wilson interval', () => {
  it('matches known values', () => {
    const half = wilson(10, 20);
    expect(half?.share).toBe(0.5);
    expect(half?.low).toBeCloseTo(0.299, 2);
    expect(half?.high).toBeCloseTo(0.701, 2);
  });

  it('stays inside zero and one at the extremes', () => {
    expect(wilson(0, 20)?.low).toBe(0);
    expect(wilson(0, 20)?.high).toBeGreaterThan(0);
    expect(wilson(20, 20)?.high).toBe(1);
    expect(wilson(0, 0)).toBeNull();
  });
});

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('bootstrap difference', () => {
  it('is the mean of the paired differences and keeps the pairing', () => {
    const pairs: Array<[number, number]> = [
      [3, 1],
      [4, 2],
      [5, 3],
      [6, 4],
    ];
    const result = bootstrapDifference(pairs);
    expect(result?.mean).toBe(2);
    // Every pair differs by exactly 2, so resampling pairs cannot move the interval.
    expect(result?.low).toBe(2);
    expect(result?.high).toBe(2);
  });

  it('is repeatable for a seed and gives nothing for no pairs', () => {
    const pairs: Array<[number, number]> = [
      [1, 0],
      [0, 1],
      [2, 0],
      [0, 3],
      [5, 1],
    ];
    expect(bootstrapDifference(pairs, 1)).toEqual(bootstrapDifference(pairs, 1));
    expect(bootstrapDifference(pairs, 2)?.mean).toBeCloseTo(0.6);
    expect(bootstrapDifference([])).toBeNull();
  });
});
