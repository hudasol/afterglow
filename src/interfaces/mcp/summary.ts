import type { CaseView, OptionView } from '../../domain/case-view.js';
import { isKnown, type Fact } from '../../domain/evidence.js';
import { describeConstraint } from '../../domain/intent.js';

/*
 * A compact, honest view of a case for a tool caller. It keeps the source label on every result
 * so labelled demo data cannot be mistaken for live Qloo data, and it lists the questions only the
 * person can answer instead of leaving the caller to guess.
 */

const MAX_ACTIVE_OPTIONS = 8;
const MAX_REJECTED = 10;

function factSummary<T>(fact: Fact<T>): { value: T; source: string } | 'unknown' {
  return isKnown(fact) ? { value: fact.value, source: fact.provenance.source } : 'unknown';
}

function optionSummary(option: OptionView) {
  const { candidate } = option;
  return {
    id: candidate.id,
    name: candidate.name,
    state: option.state,
    feasibility: option.feasibility,
    positions: {
      tasteOn: option.tasteOn?.position ?? null,
      nearestFirst: option.tasteOffPosition,
      mostPopular: option.popularPosition,
    },
    distanceKm: option.distanceKm,
    tasteMatches: option.matchedTags,
    tasteWhy: option.providerTaste?.explanation ?? [],
    facts: {
      priceLevel: factSummary(candidate.facts.priceLevel),
      address: factSummary(candidate.facts.address),
    },
    gate: option.gate.verdicts.map((verdict) => ({
      constraint: verdict.description,
      outcome: verdict.outcome,
      reason: verdict.reason,
      basis: verdict.basis,
      ...(verdict.evidence ? { evidence: verdict.evidence } : {}),
    })),
    questionsForThePerson: option.gate.verificationQuestions,
  };
}

function nextActions(view: CaseView): string[] {
  switch (view.status) {
    case 'needs_choices':
      return [
        'Ask the person which entry they meant for each pending choice, or whether to skip it, then call afterglow_choose_signal.',
      ];
    case 'anchored':
      return ['Record what went wrong with afterglow_record_disruption.'];
    case 'attempting':
      return [
        'Ask the person whether they secured the place. Call afterglow_confirm_attempt only if they say yes, otherwise afterglow_fail_attempt.',
      ];
    case 'recovered':
    case 'abandoned':
      return ['The case is closed. Nothing further to do.'];
    case 'recovering': {
      if (view.searchFailure) {
        return ['The search failed. Tell the person what failed and offer afterglow_search_again.'];
      }
      const open = view.options.filter((option) => option.feasibility !== 'rejected');
      if (open.length === 0) {
        return view.relaxations.length > 0
          ? [
              'No option passes the hard constraints. Describe the offered relaxations to the person. Call afterglow_relax_constraints only after they agree to that exact change.',
            ]
          : [
              'No option passes the hard constraints and no relaxation is on offer. Tell the person.',
            ];
      }
      return [
        'Present the shortlist. For options that need verification, ask the person the listed questions and record only their answers with afterglow_attest_fact.',
        'When the person picks an option, call afterglow_start_attempt. The app never books for them.',
      ];
    }
  }
}

export function summariseCase(view: CaseView) {
  const live = view.mode === 'live';
  const ranked = view.options
    .filter((option) => option.feasibility !== 'rejected' && option.state !== 'failed')
    .sort(
      (a, b) =>
        (a.tasteOn?.position ?? a.tasteOffPosition ?? 999) -
        (b.tasteOn?.position ?? b.tasteOffPosition ?? 999),
    );
  const rejected = view.options.filter(
    (option) => option.feasibility === 'rejected' || option.state === 'failed',
  );
  const shortlisted = new Set(view.shortlistIds);

  return {
    caseId: view.id,
    status: view.status,
    source: {
      mode: view.mode,
      label: view.providerLabel,
      note: live
        ? 'Results come from the live Qloo API.'
        : 'Results come from a labelled demo catalogue with invented venues. They are not Qloo data.',
    },
    title: view.anchor.title,
    disruptions: view.disruptions.map((item) => item.description),
    plan: {
      start: view.plan.planStart,
      durationMinutes: view.plan.durationMinutes,
      partySize: view.plan.partySize,
      hardConstraints: view.plan.hardConstraints.map(describeConstraint),
      relaxedConstraints: view.plan.relaxedConstraintKeys,
    },
    pendingChoices: view.pendingChoices.map((choice) => ({
      key: choice.key,
      kind: choice.kind,
      input: choice.input,
      candidates: (choice.candidates ?? []).map(({ id, name, type, description }) => ({
        id,
        name,
        type,
        description,
      })),
    })),
    search: view.run
      ? {
          trigger: view.run.trigger,
          poolSize: view.run.poolSize,
          tasteStatus: view.run.tasteStatus,
          tasteNote: view.run.tasteNote,
          placeFacts: view.run.placeFacts,
          signals: view.run.appliedSignals,
        }
      : null,
    searchFailure: view.searchFailure,
    shortlist: ranked.filter((option) => shortlisted.has(option.candidate.id)).map(optionSummary),
    otherOptions: ranked
      .filter((option) => !shortlisted.has(option.candidate.id))
      .slice(0, MAX_ACTIVE_OPTIONS)
      .map(optionSummary),
    removed: {
      count: rejected.length,
      examples: rejected.slice(0, MAX_REJECTED).map((option) => ({
        id: option.candidate.id,
        name: option.candidate.name,
        reasons: option.rejectionReasons,
      })),
    },
    comparison: view.comparison,
    relaxationsOffered: view.relaxations,
    nextActions: nextActions(view),
  };
}

export type CaseSummary = ReturnType<typeof summariseCase>;
