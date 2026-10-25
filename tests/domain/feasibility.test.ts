import { describe, expect, it } from 'vitest';
import {
  buildExclusions,
  evaluateCandidate,
  suggestRelaxations,
} from '../../src/domain/feasibility.js';
import { deriveEffectivePlan } from '../../src/domain/plan.js';
import {
  makeAnchor,
  makeCandidate,
  makeContext,
  northOf,
  ORIGIN_UNKNOWN,
} from '../helpers/fixtures.js';

describe('feasibility gate', () => {
  it('passes a candidate when every known fact satisfies every constraint', () => {
    const anchor = makeAnchor({
      hardConstraints: [
        { kind: 'max_price_level', level: 3 },
        { kind: 'max_distance_km', km: 3 },
        { kind: 'dietary', requirement: 'vegan' },
        { kind: 'step_free_access' },
        { kind: 'open_at_plan_time' },
        { kind: 'fits_party_size' },
      ],
    });
    const candidate = makeCandidate({
      id: 'a',
      point: northOf(1),
      price: 2,
      dietary: ['vegan', 'vegetarian'],
      stepFree: true,
      open: { opensAt: 17 * 60, closesAt: 23 * 60 },
      capacity: 10,
    });
    const result = evaluateCandidate(candidate, makeContext(anchor));
    expect(result.status).toBe('feasible');
    expect(result.verdicts.every((v) => v.outcome === 'pass')).toBe(true);
  });

  it('rejects a candidate that fails a single hard constraint', () => {
    const anchor = makeAnchor({ hardConstraints: [{ kind: 'max_price_level', level: 2 }] });
    const result = evaluateCandidate(makeCandidate({ id: 'a', price: 4 }), makeContext(anchor));
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toContain('Price level no higher than 2');
  });

  it('marks a candidate as needing verification when a required fact is missing', () => {
    const anchor = makeAnchor({ hardConstraints: [{ kind: 'step_free_access' }] });
    const result = evaluateCandidate(makeCandidate({ id: 'a' }), makeContext(anchor));
    expect(result.status).toBe('needs_verification');
    expect(result.verificationQuestions).toHaveLength(1);
    expect(result.verdicts[0]?.outcome).toBe('unknown');
  });

  it('never treats a missing fact as a pass', () => {
    const anchor = makeAnchor({ hardConstraints: [{ kind: 'open_at_plan_time' }] });
    const result = evaluateCandidate(makeCandidate({ id: 'a', open: null }), makeContext(anchor));
    expect(result.status).not.toBe('feasible');
  });

  it('rejects when a different fact fails even if another is unknown', () => {
    const anchor = makeAnchor({
      hardConstraints: [{ kind: 'max_price_level', level: 1 }, { kind: 'step_free_access' }],
    });
    const result = evaluateCandidate(makeCandidate({ id: 'a', price: 3 }), makeContext(anchor));
    expect(result.status).toBe('rejected');
    expect(result.verificationQuestions).toEqual([]);
  });

  it('computes distance from the original venue and rejects the far candidate', () => {
    const anchor = makeAnchor({ hardConstraints: [{ kind: 'max_distance_km', km: 2 }] });
    const ctx = makeContext(anchor);
    expect(evaluateCandidate(makeCandidate({ id: 'near', point: northOf(1) }), ctx).status).toBe(
      'feasible',
    );
    expect(evaluateCandidate(makeCandidate({ id: 'far', point: northOf(5) }), ctx).status).toBe(
      'rejected',
    );
  });

  it('leaves distance unknown when the original venue was not located', () => {
    const anchor = makeAnchor({ hardConstraints: [{ kind: 'max_distance_km', km: 2 }] });
    const ctx = makeContext(anchor, { originalLocation: ORIGIN_UNKNOWN });
    expect(evaluateCandidate(makeCandidate({ id: 'a', point: northOf(1) }), ctx).status).toBe(
      'needs_verification',
    );
  });

  it('checks the whole plan window against opening hours', () => {
    const anchor = makeAnchor({ hardConstraints: [{ kind: 'open_at_plan_time' }] });
    const ctx = makeContext(anchor);
    const closesEarly = makeCandidate({ id: 'a', open: { opensAt: 17 * 60, closesAt: 21 * 60 } });
    const opensLate = makeCandidate({ id: 'b', open: { opensAt: 20 * 60, closesAt: 26 * 60 } });
    const fits = makeCandidate({ id: 'c', open: { opensAt: 18 * 60, closesAt: 24 * 60 } });
    expect(evaluateCandidate(closesEarly, ctx).status).toBe('rejected');
    expect(evaluateCandidate(opensLate, ctx).status).toBe('rejected');
    expect(evaluateCandidate(fits, ctx).status).toBe('feasible');
  });

  it('rejects a venue that is shut for the whole day of the plan', () => {
    const anchor = makeAnchor({ hardConstraints: [{ kind: 'open_at_plan_time' }] });
    const shut = makeCandidate({ id: 'a', open: { opensAt: 0, closesAt: 1, closedAllDay: true } });
    const result = evaluateCandidate(shut, makeContext(anchor));
    expect(result.status).toBe('rejected');
    expect(result.rejectionReasons[0]).toMatch(/Closed for the whole day/u);
  });

  it('applies a late arrival to the opening hours check', () => {
    const anchor = makeAnchor({ hardConstraints: [{ kind: 'open_at_plan_time' }] });
    const plan = deriveEffectivePlan(anchor, [{ kind: 'running_late', minutes: 90 }], []);
    const ctx = makeContext(anchor, { plan });
    const candidate = makeCandidate({ id: 'a', open: { opensAt: 17 * 60, closesAt: 22 * 60 } });
    // 19:30 plus 90 minutes starts at 21:00 and needs until 23:00.
    expect(evaluateCandidate(candidate, ctx).status).toBe('rejected');
  });

  it('rejects a venue that cannot seat the party after the party grows', () => {
    const anchor = makeAnchor();
    const plan = deriveEffectivePlan(anchor, [{ kind: 'party_changed', partySize: 8 }], []);
    const ctx = makeContext(anchor, { plan });
    expect(evaluateCandidate(makeCandidate({ id: 'a', capacity: 4 }), ctx).status).toBe('rejected');
    expect(evaluateCandidate(makeCandidate({ id: 'b', capacity: 12 }), ctx).status).toBe(
      'feasible',
    );
  });

  it('turns a weather disruption into a covered space constraint', () => {
    const anchor = makeAnchor();
    const plan = deriveEffectivePlan(anchor, [{ kind: 'weather', condition: 'rain' }], []);
    const ctx = makeContext(anchor, { plan });
    expect(evaluateCandidate(makeCandidate({ id: 'a', covered: false }), ctx).status).toBe(
      'rejected',
    );
    expect(evaluateCandidate(makeCandidate({ id: 'b', covered: true }), ctx).status).toBe(
      'feasible',
    );
  });

  it('lets the person attest a missing fact in either direction', () => {
    const anchor = makeAnchor({ hardConstraints: [{ kind: 'step_free_access' }] });
    const candidate = makeCandidate({ id: 'a' });
    const yes = makeContext(anchor, {
      attestations: { a: { step_free_access: { satisfied: true, at: 't' } } },
    });
    const no = makeContext(anchor, {
      attestations: { a: { step_free_access: { satisfied: false, at: 't' } } },
    });
    expect(evaluateCandidate(candidate, yes).status).toBe('feasible');
    expect(evaluateCandidate(candidate, yes).verdicts[0]?.basis).toBe('user_attested');
    expect(evaluateCandidate(candidate, no).status).toBe('rejected');
  });

  it('rejects the original venue and anything excluded earlier', () => {
    const anchor = makeAnchor();
    const ctx = makeContext(anchor, { exclusions: buildExclusions(['x'], ['Original Table']) });
    expect(evaluateCandidate(makeCandidate({ id: 'o', name: 'Original  Table' }), ctx).status).toBe(
      'rejected',
    );
    expect(evaluateCandidate(makeCandidate({ id: 'x' }), ctx).status).toBe('rejected');
    expect(evaluateCandidate(makeCandidate({ id: 'ok' }), ctx).status).toBe('feasible');
  });

  it('suggests the constraint whose relaxation admits the most candidates', () => {
    const anchor = makeAnchor({
      hardConstraints: [{ kind: 'max_price_level', level: 1 }, { kind: 'step_free_access' }],
    });
    const ctx = makeContext(anchor);
    const pool = [
      makeCandidate({ id: 'a', price: 3, stepFree: true }),
      makeCandidate({ id: 'b', price: 4, stepFree: true }),
      makeCandidate({ id: 'c', price: 1, stepFree: false }),
    ];
    const options = suggestRelaxations(pool, ctx);
    expect(options[0]?.constraintKeys).toEqual(['max_price_level']);
    expect(options[0]?.admits).toBe(2);
  });

  it('offers a larger set when no single constraint is enough, and never counts excluded venues', () => {
    const anchor = makeAnchor({
      hardConstraints: [{ kind: 'max_price_level', level: 1 }, { kind: 'step_free_access' }],
    });
    const ctx = makeContext(anchor, { exclusions: buildExclusions(['x'], []) });
    const pool = [
      makeCandidate({ id: 'a', price: 3, stepFree: false }),
      makeCandidate({ id: 'x', price: 1, stepFree: false }),
    ];
    const options = suggestRelaxations(pool, ctx);
    expect(options).toHaveLength(1);
    expect(options[0]?.constraintKeys).toEqual(['max_price_level', 'step_free_access']);
    expect(options[0]?.candidateNames).toEqual(['Venue a']);
  });
});
