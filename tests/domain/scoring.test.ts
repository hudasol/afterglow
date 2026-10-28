import { describe, expect, it } from 'vitest';
import {
  SCORE_WEIGHTS,
  closenessScore,
  compareBaseline,
  compositeScore,
  tasteValues,
} from '../../src/domain/scoring.js';
import type { TasteScore } from '../../src/domain/venue.js';

const scored = (candidateId: string, rank: number, affinity?: number): TasteScore => ({
  candidateId,
  rank,
  ...(affinity !== undefined ? { affinity } : {}),
});

describe('tasteValues', () => {
  it('rescales affinity so the lowest scored place is 0 and the highest is 1', () => {
    const values = tasteValues([scored('a', 1, 0.82), scored('b', 2, 0.77), scored('c', 3, 0.72)]);
    expect(values.get('a')).toEqual({ value: 1, basis: 'affinity' });
    expect(values.get('b')?.value).toBeCloseTo(0.5);
    expect(values.get('c')).toEqual({ value: 0, basis: 'affinity' });
  });

  it('rescales across the places in scope only, so a ruled out place cannot set the range', () => {
    const scores = [scored('x', 1, 0.99), scored('a', 2, 0.8), scored('b', 3, 0.7)];
    const values = tasteValues(scores, new Set(['a', 'b']));
    expect(values.get('a')?.value).toBe(1);
    expect(values.get('b')?.value).toBe(0);
  });

  it('gives every place the same value when the provider gave every place the same affinity', () => {
    const values = tasteValues([
      scored('a', 1, 0.7649962877984056),
      scored('b', 2, 0.7649962877984056),
    ]);
    expect(values.get('a')?.value).toBe(0.5);
    expect(values.get('b')?.value).toBe(0.5);
  });

  it('falls back to a rank based value when there is no affinity', () => {
    const values = tasteValues([scored('a', 1), scored('b', 2), scored('c', 3)]);
    expect(values.get('a')).toEqual({ value: 1, basis: 'rank' });
    expect(values.get('b')?.value).toBeCloseTo(0.5);
    expect(values.get('c')).toEqual({ value: 0, basis: 'rank' });
  });

  it('treats an affinity outside 0 to 1 as missing and never uses it', () => {
    const values = tasteValues([scored('a', 1, 1.4), scored('b', 2, 0.6), scored('c', 3, 0.4)]);
    expect(values.get('a')?.basis).toBe('rank');
    expect(values.get('b')?.basis).toBe('affinity');
  });

  it('gives a single scored place the top value', () => {
    expect(tasteValues([scored('a', 1)]).get('a')).toEqual({ value: 1, basis: 'rank' });
  });
});

describe('closenessScore', () => {
  it('falls linearly from 1 at the venue to 0 at ten kilometres and stays at 0 beyond', () => {
    expect(closenessScore(0)).toBe(1);
    expect(closenessScore(2.5)).toBeCloseTo(0.75);
    expect(closenessScore(10)).toBe(0);
    expect(closenessScore(40)).toBe(0);
  });

  it('is unknown when the distance is unknown', () => {
    expect(closenessScore(null)).toBeNull();
  });
});

describe('compositeScore', () => {
  it('blends taste and closeness with the published weights', () => {
    const result = compositeScore({ value: 0.8, basis: 'affinity' }, 2);
    expect(SCORE_WEIGHTS.taste + SCORE_WEIGHTS.practical).toBe(1);
    expect(result.composite).toBeCloseTo(0.75 * 0.8 + 0.25 * 0.8);
    expect(result.tasteBasis).toBe('affinity');
    expect(result.distanceKm).toBe(2);
  });

  it('renormalises the weights when a component is unavailable', () => {
    expect(compositeScore({ value: 0.6, basis: 'rank' }, null).composite).toBeCloseTo(0.6);
    expect(compositeScore(undefined, 5).composite).toBeCloseTo(0.5);
  });

  it('is 0 when neither component is available', () => {
    expect(compositeScore(undefined, null).composite).toBe(0);
  });

  it('lets taste move the order when affinity is rescaled, not only distance', () => {
    const near = compositeScore({ value: 0, basis: 'affinity' }, 0.5);
    const far = compositeScore({ value: 1, basis: 'affinity' }, 7);
    expect(far.composite).toBeGreaterThan(near.composite);
  });
});

describe('compareBaseline', () => {
  const key = (distanceKm: number | null, priceLevel: number | null, name: string) => ({
    distanceKm,
    priceLevel,
    name,
  });

  it('orders by distance, then price, then name', () => {
    expect(compareBaseline(key(1, 2, 'B'), key(2, 1, 'A'))).toBeLessThan(0);
    expect(compareBaseline(key(1, 1, 'B'), key(1, 2, 'A'))).toBeLessThan(0);
    expect(compareBaseline(key(1, 2, 'A'), key(1, 2, 'B'))).toBeLessThan(0);
  });

  it('puts unknown values after known ones and ignores noise below 0.05 km', () => {
    expect(compareBaseline(key(null, 1, 'A'), key(30, 1, 'B'))).toBeGreaterThan(0);
    expect(compareBaseline(key(1.001, 3, 'Z'), key(1.0, 1, 'A'))).toBeGreaterThan(0);
  });
});
