import { describe, expect, it } from 'vitest';
import { describeTasteCoverage } from '../../src/domain/scoring.js';
import type { TasteScore } from '../../src/domain/venue.js';

/* Invented scores for the arithmetic. They are not data from any provider. */
const score = (candidateId: string, rank: number, affinity?: number): TasteScore => ({
  candidateId,
  rank,
  ...(affinity === undefined ? {} : { affinity }),
});

describe('describeTasteCoverage', () => {
  it('says nothing when every place was scored and the scores differ', () => {
    const scores = [score('a', 1, 0.9), score('b', 2, 0.8), score('c', 3, 0.7)];
    expect(describeTasteCoverage(scores, 3)).toBeNull();
  });

  it('says that distance decides when every score is the same', () => {
    const scores = [score('a', 1, 0.765), score('b', 2, 0.765), score('c', 3, 0.765)];
    const note = describeTasteCoverage(scores, 3);
    expect(note).toContain('the same taste score');
    expect(note).toContain('follows distance');
    expect(note).not.toContain('scored 3 of 3');
  });

  it('says how many places were scored when only part of the pool was', () => {
    const scores = [score('a', 1, 0.9), score('b', 2, 0.8)];
    const note = describeTasteCoverage(scores, 5);
    expect(note).toContain('scored 2 of 5 places');
    expect(note).not.toContain('the same taste score');
  });

  it('can say both', () => {
    const note = describeTasteCoverage([score('a', 1, 0.5), score('b', 2, 0.5)], 4);
    expect(note).toContain('the same taste score');
    expect(note).toContain('scored 2 of 4 places');
  });

  it('does not call a single score or rank only scores flat', () => {
    expect(describeTasteCoverage([score('a', 1, 0.5)], 1)).toBeNull();
    expect(describeTasteCoverage([score('a', 1), score('b', 2)], 2)).toBeNull();
  });

  it('is plain text without dashes or emojis', () => {
    const note = describeTasteCoverage([score('a', 1, 0.5), score('b', 2, 0.5)], 4) ?? '';
    expect(note).not.toMatch(/—|–/u);
    expect(note).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
