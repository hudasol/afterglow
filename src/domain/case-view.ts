import {
  deriveStatus,
  pendingChoices,
  resolutionKey,
  type CallTrace,
  type CaseMode,
  type CaseState,
  type CaseStatus,
  type SearchRun,
  type StoredEvent,
  type TasteResolution,
} from './case.js';
import { isKnown, known, unknown, type Fact } from './evidence.js';
import {
  buildExclusions,
  suggestRelaxations,
  type Feasibility,
  type GateContext,
  type GateResult,
  type RelaxationOption,
} from './feasibility.js';
import type { GeoPoint } from './geo.js';
import type { IntentAnchor } from './intent.js';
import { kendallTau, overlapAtK } from './metrics.js';
import { deriveEffectivePlan, describeDisruption, type EffectivePlan } from './plan.js';
import { recommend, type Arm, type RankedOption } from './recommend.js';
import { SCORE_FORMULA, distanceToOriginal, type ScoreBreakdown } from './scoring.js';
import { normaliseName, type Candidate } from './venue.js';

export type OptionState =
  'evaluated' | 'rejected' | 'awaiting_approval' | 'attempted' | 'confirmed' | 'failed';

export interface OptionView {
  candidate: Candidate;
  state: OptionState;
  feasibility: Feasibility;
  gate: GateResult;
  /** Why this option was removed, when it was. Includes the person's own rejection. */
  rejectionReasons: string[];
  tasteOn: {
    position: number;
    score: ScoreBreakdown;
    providerRank: number | null;
    providerAffinity: number | null;
  } | null;
  /** What the taste provider returned for this place, whether or not it passed the gate. */
  providerTaste: { rank: number; affinity: number | null; explanation: string[] } | null;
  tasteOffPosition: number | null;
  /** Position in the Popular ordering, or null when no popularity value was available. */
  popularPosition: number | null;
  distanceKm: number | null;
  /** Tags the provider returned for this venue that match a tag the person asked to preserve. */
  matchedTags: string[];
}

export interface ComparisonView {
  tasteOffTopIds: string[];
  tasteOnTopIds: string[];
  overlapAt3: number | null;
  kendallTau: number | null;
  topChoiceChanged: boolean;
  /** Taste On against the Popular ordering. Null when no popularity values were available. */
  popular: {
    topIds: string[];
    overlapAt3: number | null;
    kendallTau: number | null;
    topChoiceChanged: boolean;
  } | null;
}

export interface HistoryEntry {
  seq: number;
  at: string;
  kind: string;
  text: string;
}

export interface RunSummary {
  runId: string;
  at: string;
  trigger: SearchRun['trigger'];
  poolSize: number;
  tasteStatus: SearchRun['tasteStatus'];
  tasteNote: string | null;
  appliedSignals: SearchRun['appliedSignals'];
  traces: CallTrace[];
}

export interface CaseView {
  id: string;
  mode: CaseMode;
  providerLabel: string;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  anchor: IntentAnchor;
  plan: EffectivePlan;
  disruptions: { description: string; kind: string }[];
  resolutions: TasteResolution[];
  pendingChoices: (TasteResolution & { key: string })[];
  run: RunSummary | null;
  resolutionTraces: CallTrace[];
  runCount: number;
  activeArm: Arm | null;
  options: OptionView[];
  shortlistIds: string[];
  comparison: ComparisonView | null;
  relaxations: RelaxationOption[];
  searchFailure: { code: string; message: string; at: string } | null;
  scoreFormula: string;
  history: HistoryEntry[];
}

const SHORTLIST_SIZE = 3;

function originalLocationFact(state: CaseState, pool: readonly Candidate[]): Fact<GeoPoint> {
  const originalName = state.opened.anchor.originalVenue.name;
  const resolution = state.resolutions[resolutionKey('original_venue', originalName)];
  const selected = resolution?.selected;
  if (selected?.location) {
    return known(selected.location, {
      source: state.opened.mode === 'demo' ? 'simulation' : 'qloo',
      label: `Location of ${selected.name}`,
    });
  }
  const normalised = normaliseName(originalName);
  const match = pool.find((candidate) => normaliseName(candidate.name) === normalised);
  if (match && isKnown(match.facts.location)) return match.facts.location;
  return unknown('The original venue was not located');
}

function matchedTagsFor(candidate: Candidate, state: CaseState): string[] {
  const wanted = new Set(
    Object.values(state.resolutions)
      .filter((resolution) => resolution.kind === 'tag' && resolution.selected)
      .map((resolution) => normaliseName(resolution.selected?.name ?? '')),
  );
  if (wanted.size === 0) return [];
  return (candidate.taste.tagNames ?? []).filter((tag) => wanted.has(normaliseName(tag)));
}

export function gateContextFor(state: CaseState, pool: readonly Candidate[]): GateContext {
  const plan = deriveEffectivePlan(state.opened.anchor, state.disruptions, state.relaxedKeys);
  const excludedIds = [
    ...Object.keys(state.userRejected),
    ...Object.entries(state.attempts)
      .filter(([, attempt]) => attempt === 'failed')
      .map(([id]) => id),
  ];
  return {
    plan,
    originalLocation: originalLocationFact(state, pool),
    attestations: state.attestations,
    exclusions: buildExclusions(excludedIds, [state.opened.anchor.originalVenue.name]),
  };
}

export function buildCaseView(
  id: string,
  state: CaseState,
  events: readonly StoredEvent[],
): CaseView {
  const run = state.runs.at(-1) ?? null;
  const pool = run?.pool ?? [];
  const ctx = gateContextFor(state, pool);
  const outcome = run ? recommend(pool, ctx, run.tasteScores) : null;
  const activeArm: Arm | null = outcome ? (outcome.tasteOn ? 'taste_on' : 'taste_off') : null;

  const options: OptionView[] = [];
  if (run && outcome) {
    const offByid = new Map(outcome.tasteOff.options.map((option) => [option.candidateId, option]));
    const popularById = new Map(
      (outcome.popular?.options ?? []).map((option) => [option.candidateId, option]),
    );
    const onById = new Map<string, RankedOption>(
      (outcome.tasteOn?.options ?? []).map((option) => [option.candidateId, option]),
    );
    const activeOptions =
      (activeArm === 'taste_on' ? outcome.tasteOn : outcome.tasteOff)?.options ?? [];
    const shortlist = new Set(
      activeOptions
        .filter((option) => !state.attempts[option.candidateId])
        .slice(0, SHORTLIST_SIZE)
        .map((option) => option.candidateId),
    );

    const providerById = new Map(
      (run.tasteScores ?? []).map((score) => [score.candidateId, score]),
    );

    for (const candidate of pool) {
      const gate = outcome.gate[candidate.id] as GateResult;
      const provider = providerById.get(candidate.id);
      const on = onById.get(candidate.id);
      const off = offByid.get(candidate.id);
      const attempt = state.attempts[candidate.id];
      const userReason = state.userRejected[candidate.id];
      let optionState: OptionState;
      if (attempt === 'confirmed') optionState = 'confirmed';
      else if (attempt === 'attempted') optionState = 'attempted';
      else if (attempt === 'failed') optionState = 'failed';
      else if (gate.status === 'rejected') optionState = 'rejected';
      else if (shortlist.has(candidate.id)) optionState = 'awaiting_approval';
      else optionState = 'evaluated';

      options.push({
        candidate,
        state: optionState,
        feasibility: gate.status,
        gate,
        rejectionReasons: userReason
          ? [userReason, ...gate.rejectionReasons]
          : gate.rejectionReasons,
        tasteOn: on?.score
          ? {
              position: on.position,
              score: on.score,
              providerRank: on.providerRank ?? null,
              providerAffinity: on.providerAffinity ?? null,
            }
          : null,
        providerTaste: provider
          ? {
              rank: provider.rank,
              affinity: provider.affinity ?? null,
              explanation: provider.explanation ?? [],
            }
          : null,
        tasteOffPosition: off?.position ?? null,
        popularPosition: popularById.get(candidate.id)?.position ?? null,
        // Measured for every place, including ruled out ones, so the person can see why a distance limit applied.
        distanceKm:
          on?.distanceKm ?? off?.distanceKm ?? distanceToOriginal(candidate, ctx.originalLocation),
        matchedTags: matchedTagsFor(candidate, state),
      });
    }

    const rank = (option: OptionView): number => {
      const order: Record<OptionState, number> = {
        confirmed: 0,
        attempted: 1,
        awaiting_approval: 2,
        evaluated: 3,
        failed: 4,
        rejected: 5,
      };
      return order[option.state];
    };
    const activePosition = (option: OptionView): number =>
      (activeArm === 'taste_on' ? option.tasteOn?.position : option.tasteOffPosition) ?? 10_000;
    options.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        activePosition(a) - activePosition(b) ||
        a.candidate.name.localeCompare(b.candidate.name, 'en'),
    );
  }

  const shortlistIds = options
    .filter((option) => option.state === 'awaiting_approval')
    .map((option) => option.candidate.id);

  let comparison: ComparisonView | null = null;
  if (outcome?.tasteOn) {
    const offIds = outcome.tasteOff.options.map((option) => option.candidateId);
    const onIds = outcome.tasteOn.options.map((option) => option.candidateId);
    comparison = {
      tasteOffTopIds: offIds.slice(0, SHORTLIST_SIZE),
      tasteOnTopIds: onIds.slice(0, SHORTLIST_SIZE),
      overlapAt3: overlapAtK(offIds, onIds, SHORTLIST_SIZE),
      kendallTau: kendallTau(offIds, onIds),
      topChoiceChanged: offIds[0] !== undefined && onIds[0] !== undefined && offIds[0] !== onIds[0],
      popular: outcome.popular
        ? (() => {
            const popularIds = outcome.popular.options.map((option) => option.candidateId);
            return {
              topIds: popularIds.slice(0, SHORTLIST_SIZE),
              overlapAt3: overlapAtK(popularIds, onIds, SHORTLIST_SIZE),
              kendallTau: kendallTau(popularIds, onIds),
              topChoiceChanged:
                popularIds[0] !== undefined && onIds[0] !== undefined && popularIds[0] !== onIds[0],
            };
          })()
        : null,
    };
  }

  const eligibleCount = options.filter(
    (option) => option.feasibility !== 'rejected' && option.state !== 'failed',
  ).length;
  const relaxations =
    run && outcome && eligibleCount === 0 && state.disruptions.length > 0
      ? suggestRelaxations(pool, ctx)
      : [];

  return {
    id,
    mode: state.opened.mode,
    providerLabel: state.opened.providerLabel,
    status: deriveStatus(state),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    anchor: state.opened.anchor,
    plan: ctx.plan,
    disruptions: state.disruptions.map((disruption) => ({
      kind: disruption.kind,
      description: describeDisruption(disruption),
    })),
    resolutions: Object.values(state.resolutions),
    pendingChoices: Object.entries(state.resolutions)
      .filter(([, resolution]) => resolution.status === 'ambiguous')
      .map(([key, resolution]) => ({ ...resolution, key })),
    run: run
      ? {
          runId: run.runId,
          at: run.at,
          trigger: run.trigger,
          poolSize: run.pool.length,
          tasteStatus: run.tasteStatus,
          tasteNote: run.tasteNote ?? null,
          appliedSignals: run.appliedSignals,
          traces: run.traces,
        }
      : null,
    resolutionTraces: state.resolutionTraces,
    runCount: state.runs.length,
    activeArm,
    options,
    shortlistIds,
    comparison,
    relaxations,
    searchFailure: state.lastSearchFailure,
    scoreFormula: SCORE_FORMULA,
    history: buildHistory(events, pool),
  };
}

function buildHistory(events: readonly StoredEvent[], pool: readonly Candidate[]): HistoryEntry[] {
  const nameOf = (candidateId: string): string =>
    pool.find((candidate) => candidate.id === candidateId)?.name ?? 'an option';
  const entries: HistoryEntry[] = [];
  for (const { seq, at, event } of events) {
    let kind: string = event.type;
    let text: string;
    switch (event.type) {
      case 'case_opened':
        text = `Case opened for "${event.anchor.title}". The intent anchor was recorded and will not change.`;
        break;
      case 'taste_resolution_recorded':
        text =
          event.resolution.status === 'resolved'
            ? `Resolved "${event.resolution.input}" to ${event.resolution.selected?.name ?? 'a match'}.`
            : event.resolution.status === 'ambiguous'
              ? `"${event.resolution.input}" matched several entries. A choice is needed.`
              : `"${event.resolution.input}" was not found and is not used.`;
        break;
      case 'taste_choice_made':
        text = `You chose ${event.chosen.name} for an ambiguous signal.`;
        break;
      case 'disruption_recorded':
        text = `Disruption recorded: ${describeDisruption(event.disruption)}.`;
        break;
      case 'search_completed':
        text = `Search ${event.run.runId} completed over ${event.run.pool.length} places. Taste ranking: ${event.run.tasteStatus}.`;
        break;
      case 'search_failed':
        text = `Search failed (${event.code}): ${event.message}`;
        break;
      case 'fact_attested':
        text = `You checked "${event.constraintKey}" for ${nameOf(event.candidateId)}: ${event.attestation.satisfied ? 'satisfied' : 'not satisfied'}.`;
        break;
      case 'constraint_relaxed':
        text = `You agreed to give up the constraint "${event.constraintKey}". The anchor is unchanged.`;
        break;
      case 'option_rejected':
        text = `You declined ${nameOf(event.candidateId)}.`;
        break;
      case 'attempt_started':
        text = `You started trying ${nameOf(event.candidateId)}.`;
        break;
      case 'attempt_confirmed':
        text = `You confirmed ${nameOf(event.candidateId)}. This is your attestation, not an automatic booking.`;
        break;
      case 'attempt_failed':
        text = `${nameOf(event.candidateId)} did not work out.`;
        break;
      case 'case_closed':
        kind = 'case_closed';
        text =
          event.outcome === 'recovered'
            ? 'Case closed as recovered.'
            : 'Case closed without a recovery.';
        break;
    }
    entries.push({ seq, at, kind, text });
  }
  return entries;
}

export { pendingChoices };
