import { z } from 'zod';
import { describeConstraint, constraintKey, type HardConstraint } from './intent.js';
import type { EffectivePlan } from './plan.js';
import { distanceKm, type GeoPoint } from './geo.js';
import { isKnown, type Fact, type SourceKind } from './evidence.js';
import { formatMinuteOfDay, localDayNumber, localMinuteOfDay, shiftIso } from './time.js';
import { normaliseName, type Candidate } from './venue.js';

export const attestationSchema = z.object({
  satisfied: z.boolean(),
  at: z.string().max(40),
});
export type Attestation = z.infer<typeof attestationSchema>;
/** candidateId -> constraint key -> what the person checked. */
export type AttestationMap = Record<string, Record<string, Attestation>>;

export type VerdictOutcome = 'pass' | 'fail' | 'unknown';

export interface ConstraintVerdict {
  key: string;
  description: string;
  outcome: VerdictOutcome;
  reason: string;
  /** Where the deciding fact came from. 'none' when the fact is missing. */
  basis: SourceKind | 'none';
  /** What the fact rests on, such as the tag value read from a map. Absent when there is none. */
  evidence?: string;
}

export type Feasibility = 'feasible' | 'needs_verification' | 'rejected';

export interface GateResult {
  candidateId: string;
  status: Feasibility;
  verdicts: ConstraintVerdict[];
  /** True when the candidate was ruled out by an earlier decision, not by a constraint. */
  excluded: boolean;
  /** Plain reasons the candidate was rejected, for display. */
  rejectionReasons: string[];
  /** Questions the person must answer before this candidate can be treated as feasible. */
  verificationQuestions: { key: string; question: string }[];
}

export interface Exclusions {
  ids: ReadonlySet<string>;
  normalisedNames: ReadonlySet<string>;
}

export interface GateContext {
  plan: EffectivePlan;
  /** Location of the original venue, when it was looked up. */
  originalLocation: Fact<GeoPoint>;
  attestations: AttestationMap;
  exclusions: Exclusions;
}

function verificationQuestion(constraint: HardConstraint, plan: EffectivePlan): string {
  switch (constraint.kind) {
    case 'max_price_level':
      return `Is the typical price level at most ${constraint.level} of 4?`;
    case 'max_distance_km':
      return `Is it within ${constraint.km} km of the original venue?`;
    case 'dietary':
      return `Can it serve a ${constraint.requirement.replace('_', ' ')} diet?`;
    case 'step_free_access':
      return 'Does it have step free access?';
    case 'open_at_plan_time':
      return `Is it open from ${formatMinuteOfDay(localMinuteOfDay(plan.planStart))} for ${plan.durationMinutes} minutes?`;
    case 'fits_party_size':
      return `Can it seat ${plan.partySize} people together?`;
    case 'covered_space':
      return 'Is the seating covered or indoors?';
  }
}

interface Raw {
  outcome: VerdictOutcome;
  reason: string;
  basis: SourceKind | 'none';
  evidence?: string;
}

function fromFact<T>(
  fact: Fact<T>,
  test: (value: T) => { ok: boolean; reason: string },
  missing: string,
): Raw {
  if (!isKnown(fact)) return { outcome: 'unknown', reason: missing, basis: 'none' };
  const result = test(fact.value);
  return {
    outcome: result.ok ? 'pass' : 'fail',
    reason: result.reason,
    basis: fact.provenance.source,
    ...(fact.provenance.source === 'openstreetmap' && fact.provenance.detail
      ? { evidence: fact.provenance.detail }
      : {}),
  };
}

function evaluateFromData(constraint: HardConstraint, candidate: Candidate, ctx: GateContext): Raw {
  const { facts } = candidate;
  switch (constraint.kind) {
    case 'max_price_level':
      return fromFact(
        facts.priceLevel,
        (level) => ({
          ok: level <= constraint.level,
          reason: `Price level ${level} against a limit of ${constraint.level}`,
        }),
        'The price level is not available for this venue',
      );
    case 'max_distance_km': {
      if (!isKnown(facts.location) || !isKnown(ctx.originalLocation)) {
        return {
          outcome: 'unknown',
          reason: 'The distance cannot be calculated without both locations',
          basis: 'none',
        };
      }
      const km = distanceKm(facts.location.value, ctx.originalLocation.value);
      return {
        outcome: km <= constraint.km ? 'pass' : 'fail',
        reason: `${km.toFixed(1)} km from the original venue against a limit of ${constraint.km} km`,
        basis: 'app',
      };
    }
    case 'dietary':
      return fromFact(
        facts.dietary,
        (options) => ({
          ok: options.includes(constraint.requirement),
          reason: options.includes(constraint.requirement)
            ? `Lists ${constraint.requirement.replace('_', ' ')} options`
            : `Does not list ${constraint.requirement.replace('_', ' ')} options`,
        }),
        'Dietary options are not available for this venue',
      );
    case 'step_free_access':
      return fromFact(
        facts.stepFree,
        (value) => ({
          ok: value,
          reason: value ? 'Step free access is available' : 'Step free access is not available',
        }),
        'Accessibility information is not available for this venue',
      );
    case 'open_at_plan_time':
      return fromFact(
        facts.openWindow,
        (window) => {
          if (window.closedAllDay) {
            return { ok: false, reason: 'Closed for the whole day of the plan' };
          }
          const startMinute = localMinuteOfDay(ctx.plan.planStart);
          const endIso = shiftIso(ctx.plan.planStart, ctx.plan.durationMinutes);
          const crossesMidnight = localDayNumber(endIso) !== localDayNumber(ctx.plan.planStart);
          const endMinute = startMinute + ctx.plan.durationMinutes;
          const ok = startMinute >= window.opensAt && endMinute <= window.closesAt;
          const hours = `Open ${formatMinuteOfDay(window.opensAt)} to ${formatMinuteOfDay(window.closesAt)}`;
          const planned = `the plan runs ${formatMinuteOfDay(startMinute)} to ${formatMinuteOfDay(endMinute)}`;
          return {
            ok,
            reason: ok
              ? `${hours}, ${planned}`
              : crossesMidnight && window.closesAt <= 1440
                ? `${hours}, so it closes before the plan ends (${planned})`
                : `${hours}, which does not cover the plan (${planned})`,
          };
        },
        'Opening hours are not available for this venue',
      );
    case 'fits_party_size':
      return fromFact(
        facts.groupCapacity,
        (capacity) => ({
          ok: capacity >= ctx.plan.partySize,
          reason: `Seats up to ${capacity} against a party of ${ctx.plan.partySize}`,
        }),
        'Group capacity is not available for this venue',
      );
    case 'covered_space':
      return fromFact(
        facts.covered,
        (value) => ({
          ok: value,
          reason: value ? 'Covered or indoor seating' : 'Outdoor seating only',
        }),
        'Covered seating information is not available for this venue',
      );
  }
}

/**
 * The feasibility gate. It is deterministic and knows nothing about taste, so the Taste On and
 * Taste Off paths run exactly the same rules over exactly the same pool.
 */
export function evaluateCandidate(candidate: Candidate, ctx: GateContext): GateResult {
  const verdicts: ConstraintVerdict[] = [];
  const rejectionReasons: string[] = [];
  const verificationQuestions: { key: string; question: string }[] = [];

  let excluded = false;
  if (ctx.exclusions.ids.has(candidate.id)) {
    excluded = true;
    rejectionReasons.push('Excluded earlier in this case');
  } else if (ctx.exclusions.normalisedNames.has(normaliseName(candidate.name))) {
    excluded = true;
    rejectionReasons.push(
      'This is the venue the plan is recovering from, or one already ruled out',
    );
  }

  for (const constraint of ctx.plan.hardConstraints) {
    const key = constraintKey(constraint);
    const attested = ctx.attestations[candidate.id]?.[key];
    const raw: Raw = attested
      ? {
          outcome: attested.satisfied ? 'pass' : 'fail',
          reason: attested.satisfied
            ? 'Checked by you: satisfied'
            : 'Checked by you: not satisfied',
          basis: 'user_attested',
        }
      : evaluateFromData(constraint, candidate, ctx);
    verdicts.push({
      key,
      description: describeConstraint(constraint),
      outcome: raw.outcome,
      reason: raw.reason,
      basis: raw.basis,
      ...(raw.evidence ? { evidence: raw.evidence } : {}),
    });
    if (raw.outcome === 'fail') {
      rejectionReasons.push(`${describeConstraint(constraint)}: ${raw.reason}`);
    } else if (raw.outcome === 'unknown') {
      verificationQuestions.push({ key, question: verificationQuestion(constraint, ctx.plan) });
    }
  }

  const status: Feasibility =
    rejectionReasons.length > 0
      ? 'rejected'
      : verificationQuestions.length > 0
        ? 'needs_verification'
        : 'feasible';

  return {
    candidateId: candidate.id,
    status,
    verdicts,
    excluded,
    rejectionReasons,
    verificationQuestions: status === 'rejected' ? [] : verificationQuestions,
  };
}

export function buildExclusions(ids: Iterable<string>, names: Iterable<string>): Exclusions {
  return {
    ids: new Set(ids),
    normalisedNames: new Set([...names].map(normaliseName)),
  };
}

/**
 * When nothing passes, report the smallest sets of constraints that, if given up, would admit
 * candidates. The person decides. The product never relaxes a hard constraint on its own, and
 * a relaxation never edits the Intent Anchor.
 */
export interface RelaxationOption {
  constraintKeys: string[];
  descriptions: string[];
  admits: number;
  candidateNames: string[];
}

const MAX_RELAXATION_OPTIONS = 3;

export function suggestRelaxations(
  candidates: readonly Candidate[],
  ctx: GateContext,
): RelaxationOption[] {
  const descriptionByKey = new Map(
    ctx.plan.hardConstraints.map((constraint) => [
      constraintKey(constraint),
      describeConstraint(constraint),
    ]),
  );
  const failing = candidates
    .map((candidate) => {
      const result = evaluateCandidate(candidate, ctx);
      return {
        candidate,
        excluded: result.excluded,
        failedKeys: result.verdicts.filter((v) => v.outcome === 'fail').map((v) => v.key),
      };
    })
    .filter((entry) => !entry.excluded && entry.failedKeys.length > 0);

  const groups = new Map<string, string[]>();
  for (const entry of failing) {
    const sorted = [...entry.failedKeys].sort();
    groups.set(sorted.join('|'), sorted);
  }

  const options: RelaxationOption[] = [];
  for (const keys of groups.values()) {
    const admitted = failing.filter((entry) => entry.failedKeys.every((key) => keys.includes(key)));
    options.push({
      constraintKeys: keys,
      descriptions: keys.map((key) => descriptionByKey.get(key) ?? key),
      admits: admitted.length,
      candidateNames: admitted.slice(0, 3).map((entry) => entry.candidate.name),
    });
  }
  return options
    .sort(
      (a, b) =>
        a.constraintKeys.length - b.constraintKeys.length ||
        b.admits - a.admits ||
        a.constraintKeys.join('|').localeCompare(b.constraintKeys.join('|'), 'en'),
    )
    .slice(0, MAX_RELAXATION_OPTIONS);
}
