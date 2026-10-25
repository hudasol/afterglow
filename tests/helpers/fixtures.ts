/**
 * Synthetic fixtures for unit tests only. Every venue here is invented. None of it is Qloo data
 * and none of it is shown in the product.
 */
import { known, unknown } from '../../src/domain/evidence.js';
import type { Fact } from '../../src/domain/evidence.js';
import type { GateContext } from '../../src/domain/feasibility.js';
import { buildExclusions } from '../../src/domain/feasibility.js';
import type { GeoPoint } from '../../src/domain/geo.js';
import { intentAnchorSchema, type IntentAnchor } from '../../src/domain/intent.js';
import { deriveEffectivePlan } from '../../src/domain/plan.js';
import type { Candidate } from '../../src/domain/venue.js';

const FIXTURE = { source: 'simulation', label: 'Test fixture' } as const;

export function makeAnchor(overrides: Partial<IntentAnchor> = {}): IntentAnchor {
  return intentAnchorSchema.parse({
    title: 'Test anniversary dinner',
    occasion: 'date',
    partySize: 2,
    city: 'Testville',
    planStart: '2026-11-07T19:30:00+04:00',
    durationMinutes: 120,
    category: 'restaurant',
    originalVenue: { name: 'Original Table' },
    preserve: ['Quiet and candlelit'],
    tasteEntities: ['Test Artist'],
    tasteTags: ['jazz'],
    hardConstraints: [],
    ...overrides,
  });
}

export interface CandidateSpec {
  id: string;
  name?: string;
  point?: GeoPoint | null;
  price?: number | null;
  dietary?: string[] | null;
  stepFree?: boolean | null;
  open?: { opensAt: number; closesAt: number } | null;
  capacity?: number | null;
  covered?: boolean | null;
  tags?: string[];
  popularity?: number;
}

function fact<T>(value: T | null | undefined, reason: string): Fact<T> {
  return value === null || value === undefined ? unknown(reason) : known(value, FIXTURE);
}

export function makeCandidate(spec: CandidateSpec): Candidate {
  return {
    id: spec.id,
    source: 'simulation',
    name: spec.name ?? `Venue ${spec.id}`,
    facts: {
      address: unknown('not provided'),
      location: fact(spec.point, 'no location'),
      priceLevel: fact(spec.price, 'no price'),
      dietary: fact((spec.dietary ?? null) as never, 'no dietary data'),
      stepFree: fact(spec.stepFree, 'no access data'),
      openWindow: fact(spec.open, 'no hours'),
      groupCapacity: fact(spec.capacity, 'no capacity'),
      covered: fact(spec.covered, 'no cover data'),
    },
    taste: {
      tagNames: spec.tags ?? [],
      ...(spec.popularity !== undefined ? { popularity: spec.popularity } : {}),
    },
  };
}

export const ORIGIN: Fact<GeoPoint> = known({ lat: 10, lon: 10 }, FIXTURE);
export const ORIGIN_UNKNOWN: Fact<GeoPoint> = unknown('not located');

export function makeContext(
  anchor: IntentAnchor,
  overrides: Partial<GateContext> = {},
): GateContext {
  return {
    plan: deriveEffectivePlan(anchor, [], []),
    originalLocation: ORIGIN,
    attestations: {},
    exclusions: buildExclusions([], [anchor.originalVenue.name]),
    ...overrides,
  };
}

/** A point roughly the given number of kilometres north of the origin. */
export function northOf(km: number): GeoPoint {
  return { lat: 10 + km / 111.195, lon: 10 };
}
