/**
 * A separately written statement of the hard constraint rules that works on raw candidate facts.
 * The evaluation uses it to check the gate from outside, and a test compares the two on generated
 * facts. It is not fully independent: it shares the distance, local time and name helpers with the
 * gate, and it reads the same facts, so it can find a disagreement in the rules but not a wrong
 * fact. Unknown facts are never counted as violations here.
 */
import { distanceKm, type GeoPoint } from '../domain/geo.js';
import type { EffectivePlan } from '../domain/plan.js';
import { localMinuteOfDay } from '../domain/time.js';
import { normaliseName, type Candidate } from '../domain/venue.js';

export function oracleViolations(
  candidate: Candidate,
  plan: EffectivePlan,
  originalLocation: GeoPoint | null,
  originalName: string,
  checkOriginal = true,
): string[] {
  const violations: string[] = [];
  const f = candidate.facts;
  if (checkOriginal && normaliseName(candidate.name) === normaliseName(originalName)) {
    violations.push('is the original venue');
  }

  for (const c of plan.hardConstraints) {
    if (c.kind === 'max_price_level') {
      if (f.priceLevel.status === 'known' && f.priceLevel.value > c.level) violations.push('price');
    } else if (c.kind === 'max_distance_km') {
      if (f.location.status === 'known' && originalLocation) {
        if (distanceKm(f.location.value, originalLocation) > c.km) violations.push('distance');
      }
    } else if (c.kind === 'dietary') {
      if (f.dietary.status === 'known' && !f.dietary.value.includes(c.requirement)) {
        violations.push(`dietary:${c.requirement}`);
      }
    } else if (c.kind === 'step_free_access') {
      if (f.stepFree.status === 'known' && f.stepFree.value === false) violations.push('step_free');
    } else if (c.kind === 'open_at_plan_time') {
      if (f.openWindow.status === 'known') {
        const start = localMinuteOfDay(plan.planStart);
        const end = start + plan.durationMinutes;
        if (start < f.openWindow.value.opensAt || end > f.openWindow.value.closesAt)
          violations.push('hours');
      }
    } else if (c.kind === 'fits_party_size') {
      if (f.groupCapacity.status === 'known' && f.groupCapacity.value < plan.partySize)
        violations.push('capacity');
    } else if (c.kind === 'covered_space') {
      if (f.covered.status === 'known' && f.covered.value === false) violations.push('covered');
    }
  }
  return violations;
}
