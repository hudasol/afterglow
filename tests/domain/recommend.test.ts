import { describe, expect, it } from 'vitest';
import { recommend } from '../../src/domain/recommend.js';
import { makeAnchor, makeCandidate, makeContext, northOf } from '../helpers/fixtures.js';

const anchor = makeAnchor({ hardConstraints: [] });

describe('recommend orderings', () => {
  it('orders by popularity, most popular first, using none of the group signals', () => {
    const pool = [
      makeCandidate({ id: 'near', point: northOf(0.5), popularity: 0.2 }),
      makeCandidate({ id: 'famous', point: northOf(4), popularity: 0.95 }),
      makeCandidate({ id: 'middle', point: northOf(2), popularity: 0.6 }),
    ];
    const outcome = recommend(pool, makeContext(anchor), null);
    expect(outcome.popular?.options.map((o) => o.candidateId)).toEqual([
      'famous',
      'middle',
      'near',
    ]);
    expect(outcome.tasteOff.options.map((o) => o.candidateId)).toEqual([
      'near',
      'middle',
      'famous',
    ]);
  });

  it('puts places without a popularity value after those that have one', () => {
    const pool = [
      makeCandidate({ id: 'blank', point: northOf(0.1) }),
      makeCandidate({ id: 'known', point: northOf(5), popularity: 0.1 }),
    ];
    const outcome = recommend(pool, makeContext(anchor), null);
    expect(outcome.popular?.options.map((o) => o.candidateId)).toEqual(['known', 'blank']);
  });

  it('breaks popularity ties by distance so the order is deterministic', () => {
    const pool = [
      makeCandidate({ id: 'far', point: northOf(3), popularity: 0.5 }),
      makeCandidate({ id: 'close', point: northOf(1), popularity: 0.5 }),
    ];
    const outcome = recommend(pool, makeContext(anchor), null);
    expect(outcome.popular?.options.map((o) => o.candidateId)).toEqual(['close', 'far']);
  });

  it('is null when no eligible place has a popularity value', () => {
    const pool = [makeCandidate({ id: 'a', point: northOf(1) })];
    expect(recommend(pool, makeContext(anchor), null).popular).toBeNull();
  });

  it('applies the same gate to the popular ordering as to every other ordering', () => {
    const strict = makeAnchor({ hardConstraints: [{ kind: 'max_price_level', level: 2 }] });
    const pool = [
      makeCandidate({ id: 'dear', price: 4, popularity: 0.99 }),
      makeCandidate({ id: 'fair', price: 2, popularity: 0.1 }),
    ];
    const outcome = recommend(pool, makeContext(strict), null);
    expect(outcome.rejectedIds).toEqual(['dear']);
    expect(outcome.popular?.options.map((o) => o.candidateId)).toEqual(['fair']);
  });
});
