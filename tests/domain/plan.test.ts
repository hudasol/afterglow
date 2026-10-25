import { describe, expect, it } from 'vitest';
import { deriveEffectivePlan } from '../../src/domain/plan.js';
import { shiftIso, localMinuteOfDay } from '../../src/domain/time.js';
import { makeAnchor } from '../helpers/fixtures.js';

describe('effective plan', () => {
  it('leaves the anchor untouched', () => {
    const anchor = makeAnchor({ hardConstraints: [{ kind: 'max_price_level', level: 3 }] });
    const before = JSON.stringify(anchor);
    deriveEffectivePlan(anchor, [{ kind: 'budget_reduced', maxPriceLevel: 1 }], []);
    expect(JSON.stringify(anchor)).toBe(before);
  });

  it('only tightens a price limit through a budget reduction', () => {
    const anchor = makeAnchor({ hardConstraints: [{ kind: 'max_price_level', level: 2 }] });
    const plan = deriveEffectivePlan(anchor, [{ kind: 'budget_reduced', maxPriceLevel: 4 }], []);
    expect(plan.hardConstraints).toContainEqual({ kind: 'max_price_level', level: 2 });
  });

  it('accumulates late arrivals and keeps the local offset', () => {
    const anchor = makeAnchor();
    const plan = deriveEffectivePlan(
      anchor,
      [
        { kind: 'running_late', minutes: 30 },
        { kind: 'running_late', minutes: 45 },
      ],
      [],
    );
    expect(plan.planStart).toBe('2026-11-07T20:45:00+04:00');
    expect(localMinuteOfDay(plan.planStart)).toBe(20 * 60 + 45);
  });

  it('removes only constraints the person relaxed', () => {
    const anchor = makeAnchor({
      hardConstraints: [{ kind: 'step_free_access' }, { kind: 'dietary', requirement: 'halal' }],
    });
    const plan = deriveEffectivePlan(anchor, [], ['step_free_access']);
    expect(plan.hardConstraints).toEqual([{ kind: 'dietary', requirement: 'halal' }]);
    expect(plan.relaxedConstraintKeys).toEqual(['step_free_access']);
  });
});

describe('time helpers', () => {
  it('shifts across midnight and preserves a negative offset', () => {
    expect(shiftIso('2026-11-07T23:30:00-05:00', 60)).toBe('2026-11-08T00:30:00-05:00');
  });
});
