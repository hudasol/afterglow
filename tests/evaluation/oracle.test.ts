import { describe, expect, it } from 'vitest';
import { known, unknown } from '../../src/domain/evidence.js';
import type { Fact } from '../../src/domain/evidence.js';
import { buildExclusions, evaluateCandidate } from '../../src/domain/feasibility.js';
import { distanceKm, type GeoPoint } from '../../src/domain/geo.js';
import { constraintKey, type HardConstraint } from '../../src/domain/intent.js';
import type { EffectivePlan } from '../../src/domain/plan.js';
import { localMinuteOfDay } from '../../src/domain/time.js';
import type { Candidate } from '../../src/domain/venue.js';
import { oracleViolations } from '../../src/evaluation/oracle.js';

const PROVENANCE = { source: 'simulation', label: 'Generated for the oracle test' } as const;
const ORIGINAL = 'Original Table';

/** A small seeded generator, so a failure can be reproduced from the seed. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;
const int = (random: Random, low: number, high: number): number =>
  low + Math.floor(random() * (high - low + 1));
const pick = <T>(random: Random, items: readonly T[]): T =>
  items[int(random, 0, items.length - 1)] as T;
const maybe = <T>(random: Random, value: T, missing: string): Fact<T> =>
  random() < 0.3 ? unknown(missing) : known(value, PROVENANCE);

const DIETS = ['vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free', 'nut_free'] as const;
const OFFSETS = ['+04:00', '-05:00', 'Z', '+05:30', '+09:00', '-08:00'];

function randomConstraints(random: Random): HardConstraint[] {
  const all: HardConstraint[] = [
    { kind: 'max_price_level', level: int(random, 1, 4) },
    { kind: 'max_distance_km', km: 0.5 + random() * 12 },
    { kind: 'dietary', requirement: pick(random, DIETS) },
    { kind: 'step_free_access' },
    { kind: 'open_at_plan_time' },
    { kind: 'fits_party_size' },
    { kind: 'covered_space' },
  ];
  return all.filter(() => random() < 0.6);
}

function randomPlan(random: Random): EffectivePlan {
  const hour = String(int(random, 0, 23)).padStart(2, '0');
  const minute = pick(random, ['00', '15', '30', '45']);
  return {
    planStart: `2026-11-0${int(random, 3, 7)}T${hour}:${minute}:00${pick(random, OFFSETS)}`,
    durationMinutes: int(random, 30, 300),
    partySize: int(random, 1, 14),
    hardConstraints: randomConstraints(random),
    relaxedConstraintKeys: [],
  };
}

function randomCandidate(
  random: Random,
  index: number,
  useOriginalName: boolean,
  plan: EffectivePlan,
): Candidate {
  const start = localMinuteOfDay(plan.planStart);
  const edge = random() < 0.3;
  // Some windows end or begin exactly where the plan does, because that is where a rule is most
  // likely to be written differently by two people.
  const opensAt = edge
    ? Math.max(0, Math.min(1439, start + int(random, -1, 1)))
    : int(random, 0, 1200);
  const closedAllDay = random() < 0.1;
  // Venues shut for the whole day carry a one minute window, as the hours readers produce.
  const window = closedAllDay
    ? { opensAt: 0, closesAt: 1, closedAllDay: true as const }
    : {
        opensAt,
        closesAt: edge
          ? Math.max(1, Math.min(2160, start + plan.durationMinutes + int(random, -1, 1)))
          : Math.min(2160, opensAt + int(random, 30, 960)),
      };
  const diets = DIETS.filter(() => random() < 0.4);
  return {
    id: `c${index}`,
    source: 'simulation',
    name: useOriginalName ? ` ${ORIGINAL.toUpperCase()}. ` : `Venue ${index}`,
    facts: {
      address: unknown('not generated'),
      location: maybe(
        random,
        { lat: 25 + random() * 0.2, lon: 55 + random() * 0.2 },
        'no location',
      ),
      priceLevel: maybe(random, int(random, 1, 4), 'no price'),
      dietary: maybe(random, [...diets], 'no dietary data'),
      stepFree: maybe(random, random() < 0.6, 'no access data'),
      openWindow: maybe(random, window, 'no hours'),
      groupCapacity: maybe(
        random,
        edge ? Math.max(1, plan.partySize + int(random, -1, 1)) : int(random, 1, 20),
        'no capacity',
      ),
      covered: maybe(random, random() < 0.6, 'no cover data'),
    },
    taste: {},
  };
}

/** The oracle names a failed requirement by its own short word. */
function oracleWord(constraint: HardConstraint): string {
  switch (constraint.kind) {
    case 'max_price_level':
      return 'price';
    case 'max_distance_km':
      return 'distance';
    case 'dietary':
      return `dietary:${constraint.requirement}`;
    case 'step_free_access':
      return 'step_free';
    case 'open_at_plan_time':
      return 'hours';
    case 'fits_party_size':
      return 'capacity';
    case 'covered_space':
      return 'covered';
  }
}

describe('the oracle and the gate', () => {
  it('fail the same requirements on generated facts', () => {
    const random = generator(20261028);
    const origin: GeoPoint = { lat: 25.1, lon: 55.1 };
    let rejected = 0;
    let passed = 0;
    let unknownOnly = 0;
    let originals = 0;

    for (let i = 0; i < 4000; i += 1) {
      const plan = randomPlan(random);
      const locate = random() < 0.85;
      const candidate = randomCandidate(random, i, random() < 0.03, plan);
      const gate = evaluateCandidate(candidate, {
        plan,
        originalLocation: locate ? known(origin, PROVENANCE) : unknown('not located'),
        attestations: {},
        exclusions: buildExclusions([], [ORIGINAL]),
      });
      const oracle = oracleViolations(candidate, plan, locate ? origin : null, ORIGINAL);

      const gateFailed = plan.hardConstraints
        .filter((constraint) =>
          gate.verdicts.some((v) => v.key === constraintKey(constraint) && v.outcome === 'fail'),
        )
        .map(oracleWord);
      const oracleFailed = oracle.filter((reason) => reason !== 'is the original venue');

      expect(oracleFailed.sort(), `candidate ${i}, seed 20261028`).toEqual(gateFailed.sort());
      expect(oracle.includes('is the original venue'), `original ${i}`).toBe(gate.excluded);

      if (gate.excluded) originals += 1;
      else if (gate.status === 'rejected') rejected += 1;
      else if (gate.status === 'feasible') passed += 1;
      else unknownOnly += 1;
    }

    // The comparison is only worth something if every outcome was actually generated.
    expect(rejected).toBeGreaterThan(500);
    expect(passed).toBeGreaterThan(100);
    expect(unknownOnly).toBeGreaterThan(100);
    expect(originals).toBeGreaterThan(30);
  });

  it('never counts an unknown fact against a place', () => {
    const sample: EffectivePlan = {
      planStart: '2026-11-07T19:30:00+04:00',
      durationMinutes: 120,
      partySize: 4,
      hardConstraints: [],
      relaxedConstraintKeys: [],
    };
    const empty = randomCandidate(generator(1), 0, false, sample);
    const blank: Candidate = {
      ...empty,
      facts: {
        address: unknown('x'),
        location: unknown('x'),
        priceLevel: unknown('x'),
        dietary: unknown('x'),
        stepFree: unknown('x'),
        openWindow: unknown('x'),
        groupCapacity: unknown('x'),
        covered: unknown('x'),
      },
    };
    const plan: EffectivePlan = {
      planStart: '2026-11-07T19:30:00+04:00',
      durationMinutes: 120,
      partySize: 4,
      hardConstraints: [
        { kind: 'max_price_level', level: 1 },
        { kind: 'max_distance_km', km: 1 },
        { kind: 'dietary', requirement: 'halal' },
        { kind: 'step_free_access' },
        { kind: 'open_at_plan_time' },
        { kind: 'fits_party_size' },
        { kind: 'covered_space' },
      ],
      relaxedConstraintKeys: [],
    };
    expect(oracleViolations(blank, plan, { lat: 25, lon: 55 }, ORIGINAL)).toEqual([]);
  });
});

describe('the helpers that the gate and the oracle share', () => {
  // The two judges agree about anything these get wrong, so they are checked against values
  // that come from outside the code.
  it('measure great circle distances that match published figures', () => {
    const london = { lat: 51.5074, lon: -0.1278 };
    const paris = { lat: 48.8566, lon: 2.3522 };
    const newYork = { lat: 40.7128, lon: -74.006 };
    const losAngeles = { lat: 34.0522, lon: -118.2437 };
    expect(distanceKm(london, paris)).toBeCloseTo(343.6, -1);
    expect(Math.abs(distanceKm(london, paris) - 343.6)).toBeLessThan(2);
    expect(Math.abs(distanceKm(newYork, losAngeles) - 3936)).toBeLessThan(10);
    expect(distanceKm(london, london)).toBe(0);
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.19, 1);
  });

  it('read the local clock of the offset in a plan time', () => {
    expect(localMinuteOfDay('2026-11-07T19:30:00+04:00')).toBe(19 * 60 + 30);
    expect(localMinuteOfDay('2026-11-07T19:30:00-05:00')).toBe(19 * 60 + 30);
    expect(localMinuteOfDay('2026-11-07T00:05:00+09:00')).toBe(5);
    expect(localMinuteOfDay('2026-11-07T23:59:00Z')).toBe(23 * 60 + 59);
    expect(localMinuteOfDay('2026-11-07T07:30:00+05:30')).toBe(7 * 60 + 30);
  });
});
