import { foldEvents, type CaseEvent, type StoredEvent } from './case.js';
import { buildCaseView, describeEvent, type CaseView } from './case-view.js';
import { constraintKey, describeConstraint } from './intent.js';

/*
 * The agent trace. AFTERGLOW is a fixed procedure, not a chat model, and this module shows that
 * procedure one cycle at a time: what it observed, what it planned, what it did, what it decided
 * and where it handed the decision back. Every line is rebuilt from the recorded events, so the
 * trace cannot describe something that did not happen.
 */

export type TracePhase = 'observe' | 'plan' | 'act' | 'decide' | 'hand_over';

export interface TraceStep {
  phase: TracePhase;
  text: string;
}

export interface TraceCycle {
  number: number;
  at: string;
  /** A search fetches new places. A re-check applies a change to the places already fetched. */
  kind: 'search' | 'recheck';
  outcome: 'ranked' | 'failed';
  heading: string;
  steps: TraceStep[];
  /** Counts after the gate for this cycle. Null when the search failed. */
  tally: { pool: number; feasible: number; needsVerification: number; ruledOut: number } | null;
}

export interface AgentTrace {
  cycles: TraceCycle[];
  /** What happened after the last cycle, such as an attempt or a closed case. */
  since: string[];
}

const MAX_NAMES = 3;
const MAX_QUESTIONS = 3;
const MAX_REASONS = 2;

/** Events that change the verdict on places already fetched, without needing a new search. */
const RECHECK_EVENTS: ReadonlySet<CaseEvent['type']> = new Set([
  'fact_attested',
  'constraint_relaxed',
  'option_rejected',
  'attempt_failed',
]);

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

function topReasons(view: CaseView): string[] {
  const tally = new Map<string, number>();
  for (const option of view.options) {
    if (option.feasibility !== 'rejected') continue;
    for (const reason of option.rejectionReasons) tally.set(reason, (tally.get(reason) ?? 0) + 1);
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))
    .slice(0, MAX_REASONS)
    .map(([reason, n]) => `${reason} (${count(n, 'place')})`);
}

function plannedSignals(view: CaseView): string {
  const run = view.run;
  if (!run) return 'No taste signals were available.';
  const { entityNames, tagNames, lostVenue } = run.appliedSignals;
  const parts = [
    entityNames.length > 0 ? `names: ${list(entityNames)}` : null,
    tagNames.length > 0 ? `vibes: ${list(tagNames)}` : null,
    lostVenue ? `the venue that fell through: ${lostVenue}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0
    ? `Taste signals for this search: ${parts.join('; ')}.`
    : 'No taste signals were used, so places are ordered by distance.';
}

function requirementSteps(view: CaseView): TraceStep[] {
  const constraints = view.plan.hardConstraints.map(describeConstraint);
  const steps: TraceStep[] = [
    {
      phase: 'plan',
      text:
        constraints.length > 0
          ? `Hard requirements in force: ${list(constraints)}.`
          : 'No hard requirements were set.',
    },
  ];
  const givenUp = view.anchor.hardConstraints
    .filter((constraint) => view.plan.relaxedConstraintKeys.includes(constraintKey(constraint)))
    .map(describeConstraint);
  if (givenUp.length > 0) {
    steps.push({ phase: 'plan', text: `Given up with your agreement: ${list(givenUp)}.` });
  }
  return steps;
}

function tallyOf(view: CaseView) {
  const feasible = view.options.filter((option) => option.feasibility === 'feasible').length;
  const needsVerification = view.options.filter(
    (option) => option.feasibility === 'needs_verification',
  ).length;
  const ruledOut = view.options.filter((option) => option.feasibility === 'rejected').length;
  return { pool: view.options.length, feasible, needsVerification, ruledOut };
}

function decisionSteps(view: CaseView, tally: ReturnType<typeof tallyOf>): TraceStep[] {
  const steps: TraceStep[] = [
    {
      phase: 'decide',
      text: `Checked every place against every requirement: ${tally.feasible} feasible, ${tally.needsVerification} waiting for a check from you, ${tally.ruledOut} ruled out.`,
    },
  ];
  const reasons = topReasons(view);
  if (reasons.length > 0) {
    steps.push({ phase: 'decide', text: `Most common reasons for ruling out: ${list(reasons)}.` });
  }

  const shortlist = view.options.filter((option) =>
    view.shortlistIds.includes(option.candidate.id),
  );
  const names = list(shortlist.slice(0, MAX_NAMES).map((option) => option.candidate.name));
  if (shortlist.length > 0) {
    steps.push({
      phase: 'decide',
      text:
        view.activeArm === 'taste_on'
          ? `Ordered the remaining places by taste and closeness. Shortlist: ${names}.`
          : `Ordered the remaining places by distance. Shortlist: ${names}.`,
    });
  } else if (view.relaxations.length > 0) {
    const options = view.relaxations.map((option) => list(option.descriptions));
    steps.push({
      phase: 'decide',
      text: `No place meets every requirement. Offered ${count(options.length, 'way')} to relax them and waited for your agreement: ${options.join('; ')}.`,
    });
  } else {
    steps.push({
      phase: 'decide',
      text: 'No place meets every requirement and no smaller change would help.',
    });
  }

  const questions = shortlist.flatMap((option) =>
    option.gate.verificationQuestions.map((q) => `${option.candidate.name}: ${q.question}`),
  );
  if (questions.length > 0) {
    steps.push({
      phase: 'hand_over',
      text: `Waiting for you to check: ${questions.slice(0, MAX_QUESTIONS).join(' ')}`,
    });
  }
  steps.push({
    phase: 'hand_over',
    text: 'The application does not book, call or pay. Choosing a place and securing it is yours to do.',
  });
  return steps;
}

function searchHeading(trigger: string | undefined): string {
  switch (trigger) {
    case 'disruption':
      return 'New search after a disruption';
    case 'manual':
      return 'Search run again';
    default:
      return 'First search';
  }
}

function searchCycle(
  number: number,
  at: string,
  view: CaseView,
  observed: readonly string[],
  failure: { code: string; message: string } | null,
): TraceCycle {
  const steps: TraceStep[] = observed.map((text) => ({ phase: 'observe', text }));
  if (observed.length === 0) steps.push({ phase: 'observe', text: 'The search was run again.' });
  steps.push(...requirementSteps(view), { phase: 'plan', text: plannedSignals(view) });

  if (failure) {
    steps.push(
      {
        phase: 'act',
        text: `The request to ${view.providerLabel} failed (${failure.code}): ${failure.message}`,
      },
      {
        phase: 'hand_over',
        text: 'Nothing was ranked. The application stopped rather than guess. You can search again.',
      },
    );
    return {
      number,
      at,
      kind: 'search',
      outcome: 'failed',
      heading: 'The search failed',
      steps,
      tally: null,
    };
  }

  const run = view.run;
  steps.push({
    phase: 'act',
    text: `Fetched ${count(run?.poolSize ?? 0, 'candidate place')} from ${view.providerLabel}.`,
  });
  if (run?.placeFacts) steps.push({ phase: 'act', text: placeFactsText(run.placeFacts) });
  steps.push({
    phase: 'act',
    text:
      run?.tasteStatus === 'applied'
        ? 'Asked for taste affinity for those places. The answer was used.'
        : run?.tasteStatus === 'degraded'
          ? `Asked for taste affinity. The answer was partial. ${run.tasteNote ?? ''}`.trim()
          : `Taste affinity was not available, so places are ordered by distance. ${run?.tasteNote ?? ''}`.trim(),
  });
  const tally = tallyOf(view);
  steps.push(...decisionSteps(view, tally));
  return {
    number,
    at,
    kind: 'search',
    outcome: 'ranked',
    heading: searchHeading(run?.trigger),
    steps,
    tally,
  };
}

function placeFactsText(facts: NonNullable<CaseView['run']>['placeFacts'] & object): string {
  const asked = `Asked OpenStreetMap about ${count(facts.looked, 'place')} for facts the plan depends on and Qloo does not supply.`;
  if (facts.looked > 0 && facts.matched === 0 && facts.filled === 0 && facts.note) {
    return `${asked} ${facts.note}`;
  }
  const found = `${facts.matched} matched by name and position, ${count(facts.filled, 'fact')} filled in. Anything it could not answer stays unknown and is asked about.`;
  return facts.note ? `${asked} ${found} ${facts.note}` : `${asked} ${found}`;
}

function recheckCycle(
  number: number,
  at: string,
  view: CaseView,
  observed: readonly string[],
): TraceCycle {
  const tally = tallyOf(view);
  const steps: TraceStep[] = [
    ...observed.map((text): TraceStep => ({ phase: 'observe', text })),
    ...requirementSteps(view),
    {
      phase: 'act',
      text: `No new request was needed. The same ${count(tally.pool, 'place')} were checked again.`,
    },
    ...decisionSteps(view, tally),
  ];
  return {
    number,
    at,
    kind: 'recheck',
    outcome: 'ranked',
    heading: 'Re-check after your change',
    steps,
    tally,
  };
}

/**
 * Matches that went smoothly are summarised in one line, because the Evidence tab lists each one.
 * Anything that needed the person, or failed, keeps its own line.
 */
function withMatchSummary(pending: readonly string[], matched: number): string[] {
  if (matched === 0) return [...pending];
  const summary = `Matched ${count(matched, 'name or phrase', 'names and phrases')} to taste entries.`;
  const [first, ...rest] = pending;
  return first?.startsWith('Case opened') ? [first, summary, ...rest] : [summary, ...pending];
}

export function buildTrace(caseId: string, events: readonly StoredEvent[]): AgentTrace {
  const cycles: TraceCycle[] = [];
  let pending: string[] = [];
  let matched = 0;

  events.forEach((stored, index) => {
    const { event } = stored;
    const before = events.slice(0, index);
    const upTo = events.slice(0, index + 1);
    const names = before.length > 0 ? (foldEvents(before).runs.at(-1)?.pool ?? []) : [];
    const nameOf = (candidateId: string): string =>
      names.find((candidate) => candidate.id === candidateId)?.name ?? 'an option';

    if (event.type === 'search_completed' || event.type === 'search_failed') {
      const view = buildCaseView(caseId, foldEvents(upTo), upTo);
      cycles.push(
        searchCycle(
          cycles.length + 1,
          stored.at,
          view,
          withMatchSummary(pending, matched),
          event.type === 'search_failed' ? { code: event.code, message: event.message } : null,
        ),
      );
      pending = [];
      matched = 0;
      return;
    }

    if (event.type === 'taste_resolution_recorded' && event.resolution.status === 'resolved') {
      matched += 1;
      return;
    }
    pending.push(describeEvent(event, nameOf));
    // Giving up several requirements at once records one event per requirement. They are one
    // change from the person's side, so the re-check waits for the last of them.
    const partOfBatch =
      event.type === 'constraint_relaxed' && events[index + 1]?.event.type === 'constraint_relaxed';
    const state = foldEvents(upTo);
    if (RECHECK_EVENTS.has(event.type) && !partOfBatch && state.runs.length > 0) {
      cycles.push(
        recheckCycle(
          cycles.length + 1,
          stored.at,
          buildCaseView(caseId, state, upTo),
          withMatchSummary(pending, matched),
        ),
      );
      pending = [];
      matched = 0;
    }
  });

  return { cycles, since: withMatchSummary(pending, matched) };
}
