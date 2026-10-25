import type { ProviderDescriptor, TasteProvider } from '../application/ports.js';
import { RecoveryService } from '../application/recovery-service.js';
import type { CaseView, OptionView } from '../domain/case-view.js';
import { isKnown } from '../domain/evidence.js';
import { kendallTau, mean, overlapAtK } from '../domain/metrics.js';
import { normaliseName } from '../domain/venue.js';
import { Database } from '../infrastructure/database.js';
import { SqliteCaseRepository } from '../infrastructure/sqlite-case-repository.js';
import type { ScenarioSpec } from '../simulation/scenarios.js';
import { oracleViolations } from './oracle.js';

const TOP = 3;
const SESSION = 'evaluation-session-0000000000';

export interface ScenarioResult {
  id: string;
  title: string;
  ok: boolean;
  error?: string;
  poolSize: number;
  tasteStatus: string;
  rejected: number;
  feasible: number;
  needsVerification: number;
  /** Top three by provider rank with no feasibility gate, as a plain recommender would return. */
  ungatedTop: { names: string[]; violationCount: number; violators: string[] };
  /** Violations in the top three of each gated arm, judged by the independent oracle. */
  gatedViolations: { tasteOn: number; tasteOff: number };
  /** True when both arms offered exactly the same set of eligible options. */
  sameEligibleSet: boolean;
  tasteOffTop: string[];
  tasteOnTop: string[];
  popularTop: string[];
  overlapAt3: number | null;
  kendallTau: number | null;
  topChoiceChanged: boolean | null;
  /** Taste On against the Popular ordering. Null when the provider returned no popularity. */
  overlapAt3VsPopular: number | null;
  topChoiceChangedVsPopular: boolean | null;
  meanAffinityTop3: { tasteOn: number | null; tasteOff: number | null; popular: number | null };
  /** Share of top three places carrying a tag the person asked to preserve. Null when no tags were returned. */
  preservedTagShare: { tasteOn: number | null; tasteOff: number | null };
  noFeasibleOption: boolean;
  relaxationsOffered: number;
  unknownFactShare: number;
  /** Share of the pool for which each practical fact was known. Dietary is null when the plan has no dietary requirement. */
  factCoverage: { openWindow: number; stepFree: number; dietary: number | null };
  /** Requests that reached the provider, not counting answers served from the cache. */
  providerCalls: number;
  /** How many of the Taste On top three passed every hard requirement on known facts. */
  tasteOnFeasibleTop: number;
  /**
   * The same case run again with taste signals taken from a different scenario. It shows whether
   * the ranking responds to the person's own signals. Null when no placebo was requested.
   */
  placebo: {
    from: string;
    tasteOnTop: string[];
    overlapAt3: number | null;
    kendallTau: number | null;
    topChoiceChanged: boolean | null;
    /** Set when the second run failed, in which case the comparison fields are empty. */
    error?: string;
  } | null;
}

export interface AggregateResult {
  scenarios: number;
  completed: number;
  ungatedScenariosWithViolation: number;
  ungatedTopSlotsViolating: { violating: number; total: number };
  gatedViolations: { tasteOn: number; tasteOff: number };
  gateAgreesWithOracle: boolean;
  sameEligibleSetEverywhere: boolean;
  topChoiceChanged: { changed: number; compared: number };
  topChoiceChangedVsPopular: { changed: number; compared: number };
  meanOverlapAt3: number | null;
  meanOverlapAt3VsPopular: number | null;
  meanKendallTau: number | null;
  meanAffinityTop3: {
    tasteOn: number | null;
    tasteOff: number | null;
    popular: number | null;
    difference: number | null;
  };
  noFeasibleHandled: { scenarios: number; withWaysForward: number };
}

function rankedIds(view: CaseView, arm: 'taste_on' | 'taste_off' | 'popular'): string[] {
  const key = (o: OptionView) =>
    arm === 'taste_on'
      ? o.tasteOn?.position
      : arm === 'popular'
        ? o.popularPosition
        : o.tasteOffPosition;
  return view.options
    .filter((o) => key(o) !== undefined && key(o) !== null && o.feasibility !== 'rejected')
    .sort((a, b) => (key(a) as number) - (key(b) as number))
    .map((o) => o.candidate.id);
}

function nameOf(view: CaseView, id: string): string {
  return view.options.find((o) => o.candidate.id === id)?.candidate.name ?? id;
}

function affinityOf(view: CaseView, ids: string[]): number | null {
  return mean(
    ids
      .map((id) => view.options.find((o) => o.candidate.id === id)?.providerTaste?.affinity)
      .filter((v): v is number => typeof v === 'number'),
  );
}

function preservedShare(view: CaseView, ids: string[]): number | null {
  const withTags = ids
    .map((id) => view.options.find((o) => o.candidate.id === id))
    .filter((o): o is OptionView => !!o && (o.candidate.taste.tagNames?.length ?? 0) > 0);
  if (withTags.length === 0) return null;
  return withTags.filter((o) => o.matchedTags.length > 0).length / withTags.length;
}

export interface RunnerOptions {
  /** When false the independent oracle is skipped. */
  useOracle: boolean;
  /**
   * Returns a scenario whose taste signals stand in for this one's, or nothing. The case is then
   * run again with those signals so the two Taste On rankings can be compared.
   */
  placeboFor?: (scenarioId: string) => ScenarioSpec | undefined;
}

interface OpenedCase {
  view: CaseView;
  close: () => void;
}

/** Opens a case in a private in memory store and settles any ambiguous signals as the scenario says. */
async function openCaseView(provider: TasteProvider, spec: ScenarioSpec): Promise<OpenedCase> {
  const db = new Database(':memory:');
  db.migrate(new URL('../../migrations', import.meta.url).pathname);
  const providers = { demo: provider, live: provider } as Record<'demo' | 'live', TasteProvider>;
  const service = new RecoveryService({
    repo: new SqliteCaseRepository(db),
    providers,
    caseTtlHours: 1,
  });
  try {
    let view = await service.openCase(SESSION, {
      mode: provider.descriptor.mode,
      anchor: spec.anchor,
      disruption: spec.disruption,
    });
    for (const pending of view.pendingChoices) {
      // A choice names an entry by its id or by its type, because the ids of a live service are
      // not known when a scenario is written.
      const wanted = spec.choices?.[normaliseName(pending.input)] ?? spec.choices?.[pending.input];
      const chosen = (pending.candidates ?? []).find(
        (candidate) => candidate.id === wanted || candidate.type === wanted,
      );
      const chosenId = chosen?.id ?? wanted;
      view = await service.chooseResolution(SESSION, view.id, {
        key: pending.key,
        ...(chosenId ? { chosenId } : { skip: true }),
      });
    }
    return { view, close: () => db.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}

export async function evaluateScenario(
  provider: TasteProvider,
  spec: ScenarioSpec,
  options: RunnerOptions,
): Promise<ScenarioResult> {
  const empty = (error: string): ScenarioResult => ({
    id: spec.id,
    title: spec.title,
    ok: false,
    error,
    poolSize: 0,
    tasteStatus: 'unavailable',
    rejected: 0,
    feasible: 0,
    needsVerification: 0,
    ungatedTop: { names: [], violationCount: 0, violators: [] },
    gatedViolations: { tasteOn: 0, tasteOff: 0 },
    sameEligibleSet: true,
    tasteOffTop: [],
    tasteOnTop: [],
    popularTop: [],
    overlapAt3: null,
    kendallTau: null,
    topChoiceChanged: null,
    overlapAt3VsPopular: null,
    topChoiceChangedVsPopular: null,
    meanAffinityTop3: { tasteOn: null, tasteOff: null, popular: null },
    preservedTagShare: { tasteOn: null, tasteOff: null },
    noFeasibleOption: false,
    relaxationsOffered: 0,
    unknownFactShare: 0,
    factCoverage: { openWindow: 0, stepFree: 0, dietary: null },
    providerCalls: 0,
    tasteOnFeasibleTop: 0,
    placebo: null,
  });

  let opened: OpenedCase | undefined;
  try {
    opened = await openCaseView(provider, spec);
    const view = opened.view;
    if (!view.run)
      return empty(
        view.searchFailure
          ? `${view.searchFailure.code}: ${view.searchFailure.message}`
          : 'No search ran',
      );

    const pool = view.options;
    const eligible = pool.filter((o) => o.feasibility !== 'rejected');
    const offIds = rankedIds(view, 'taste_off');
    const onIds = view.comparison ? rankedIds(view, 'taste_on') : [];
    const popularIds = view.comparison?.popular ? rankedIds(view, 'popular') : [];

    const originalLocation = (() => {
      const normalised = normaliseName(view.anchor.originalVenue.name);
      const hit = pool.find((o) => normaliseName(o.candidate.name) === normalised);
      return hit && isKnown(hit.candidate.facts.location)
        ? hit.candidate.facts.location.value
        : null;
    })();
    // The ungated list already leaves out the original venue, as any sensible recommender would.
    // Only the gated lists are also checked against it.
    const violationsOf = (o: OptionView, checkOriginal: boolean) =>
      options.useOracle
        ? oracleViolations(
            o.candidate,
            view.plan,
            originalLocation,
            view.anchor.originalVenue.name,
            checkOriginal,
          )
        : o.feasibility === 'rejected'
          ? ['gate']
          : [];

    const ungatedCandidates = [...pool]
      .filter(
        (o) =>
          o.providerTaste &&
          normaliseName(o.candidate.name) !== normaliseName(view.anchor.originalVenue.name),
      )
      .sort((a, b) => (a.providerTaste?.rank ?? 0) - (b.providerTaste?.rank ?? 0))
      .slice(0, TOP);
    const ungatedViolators = ungatedCandidates.filter((o) => violationsOf(o, false).length > 0);
    const topViolations = (ids: string[]) =>
      ids.slice(0, TOP).filter((id) => {
        const o = pool.find((p) => p.candidate.id === id);
        return o ? violationsOf(o, true).length > 0 : false;
      }).length;

    const allFacts = pool.flatMap((o) => Object.values(o.candidate.facts));
    const unknownShare =
      allFacts.length === 0
        ? 0
        : allFacts.filter((f) => f.status === 'unknown').length / allFacts.length;

    const sameSet =
      view.comparison === null ||
      (offIds.length === onIds.length &&
        new Set(offIds).size === new Set(onIds).size &&
        offIds.every((id) => onIds.includes(id)));

    const shareKnown = (fact: (o: OptionView) => { status: string }): number =>
      pool.length === 0 ? 0 : pool.filter((o) => fact(o).status === 'known').length / pool.length;

    const placeboRun = async (): Promise<ScenarioResult['placebo']> => {
      const stand = options.placeboFor?.(spec.id);
      if (!stand) return null;
      // Only the person's own taste signals are swapped. The plan, the constraints, the original
      // venue and the pool are the same, so any difference comes from the signals.
      const swapped: ScenarioSpec = {
        ...spec,
        anchor: {
          ...spec.anchor,
          tasteEntities: stand.anchor.tasteEntities,
          tasteTags: stand.anchor.tasteTags,
        },
        choices: { ...spec.choices, ...stand.choices },
      };
      let other: OpenedCase;
      try {
        other = await openCaseView(provider, swapped);
      } catch (error) {
        return {
          from: stand.id,
          tasteOnTop: [],
          overlapAt3: null,
          kendallTau: null,
          topChoiceChanged: null,
          error: error instanceof Error ? error.message.slice(0, 200) : 'The second run failed.',
        };
      }
      try {
        const otherOn = rankedIds(other.view, 'taste_on');
        return {
          from: stand.id,
          tasteOnTop: otherOn.slice(0, TOP).map((id) => nameOf(other.view, id)),
          overlapAt3: overlapAtK(onIds, otherOn, TOP),
          kendallTau: kendallTau(onIds, otherOn),
          topChoiceChanged:
            onIds[0] !== undefined && otherOn[0] !== undefined ? onIds[0] !== otherOn[0] : null,
        };
      } finally {
        other.close();
      }
    };

    return {
      id: spec.id,
      title: spec.title,
      ok: true,
      poolSize: pool.length,
      tasteStatus: view.run.tasteStatus,
      rejected: pool.length - eligible.length,
      feasible: pool.filter((o) => o.feasibility === 'feasible').length,
      needsVerification: pool.filter((o) => o.feasibility === 'needs_verification').length,
      ungatedTop: {
        names: ungatedCandidates.map((o) => o.candidate.name),
        violationCount: ungatedViolators.length,
        violators: ungatedViolators.map((o) => o.candidate.name),
      },
      gatedViolations: { tasteOn: topViolations(onIds), tasteOff: topViolations(offIds) },
      sameEligibleSet: sameSet,
      tasteOffTop: offIds.slice(0, TOP).map((id) => nameOf(view, id)),
      tasteOnTop: onIds.slice(0, TOP).map((id) => nameOf(view, id)),
      popularTop: popularIds.slice(0, TOP).map((id) => nameOf(view, id)),
      overlapAt3: view.comparison?.overlapAt3 ?? null,
      kendallTau: view.comparison?.kendallTau ?? null,
      topChoiceChanged: view.comparison ? view.comparison.topChoiceChanged : null,
      overlapAt3VsPopular: view.comparison?.popular?.overlapAt3 ?? null,
      topChoiceChangedVsPopular: view.comparison?.popular
        ? view.comparison.popular.topChoiceChanged
        : null,
      meanAffinityTop3: {
        tasteOn: view.comparison ? affinityOf(view, onIds.slice(0, TOP)) : null,
        tasteOff: view.comparison ? affinityOf(view, offIds.slice(0, TOP)) : null,
        popular: view.comparison?.popular ? affinityOf(view, popularIds.slice(0, TOP)) : null,
      },
      preservedTagShare: {
        tasteOn: view.comparison ? preservedShare(view, onIds.slice(0, TOP)) : null,
        tasteOff: view.comparison ? preservedShare(view, offIds.slice(0, TOP)) : null,
      },
      noFeasibleOption: eligible.length === 0,
      relaxationsOffered: view.relaxations.length,
      unknownFactShare: unknownShare,
      factCoverage: {
        openWindow: shareKnown((o) => o.candidate.facts.openWindow),
        stepFree: shareKnown((o) => o.candidate.facts.stepFree),
        dietary: view.plan.hardConstraints.some((c) => c.kind === 'dietary')
          ? shareKnown((o) => o.candidate.facts.dietary)
          : null,
      },
      providerCalls: [...view.resolutionTraces, ...view.run.traces].filter(
        (trace) => trace.cache === 'miss',
      ).length,
      tasteOnFeasibleTop: onIds
        .slice(0, TOP)
        .filter((id) => pool.find((o) => o.candidate.id === id)?.feasibility === 'feasible').length,
      placebo: await placeboRun(),
    };
  } catch (error) {
    return empty(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    opened?.close();
  }
}

export function aggregate(results: readonly ScenarioResult[]): AggregateResult {
  const done = results.filter((r) => r.ok);
  const compared = done.filter((r) => r.topChoiceChanged !== null);
  const ungatedSlots = done.reduce((sum, r) => sum + r.ungatedTop.names.length, 0);
  const on = mean(
    done.map((r) => r.meanAffinityTop3.tasteOn).filter((v): v is number => v !== null),
  );
  const off = mean(
    done.map((r) => r.meanAffinityTop3.tasteOff).filter((v): v is number => v !== null),
  );
  const pop = mean(
    done.map((r) => r.meanAffinityTop3.popular).filter((v): v is number => v !== null),
  );
  const comparedPopular = done.filter((r) => r.topChoiceChangedVsPopular !== null);
  const empties = done.filter((r) => r.noFeasibleOption);
  return {
    scenarios: results.length,
    completed: done.length,
    ungatedScenariosWithViolation: done.filter((r) => r.ungatedTop.violationCount > 0).length,
    ungatedTopSlotsViolating: {
      violating: done.reduce((sum, r) => sum + r.ungatedTop.violationCount, 0),
      total: ungatedSlots,
    },
    gatedViolations: {
      tasteOn: done.reduce((sum, r) => sum + r.gatedViolations.tasteOn, 0),
      tasteOff: done.reduce((sum, r) => sum + r.gatedViolations.tasteOff, 0),
    },
    gateAgreesWithOracle: done.every(
      (r) => r.gatedViolations.tasteOn === 0 && r.gatedViolations.tasteOff === 0,
    ),
    sameEligibleSetEverywhere: done.every((r) => r.sameEligibleSet),
    topChoiceChanged: {
      changed: compared.filter((r) => r.topChoiceChanged).length,
      compared: compared.length,
    },
    topChoiceChangedVsPopular: {
      changed: comparedPopular.filter((r) => r.topChoiceChangedVsPopular).length,
      compared: comparedPopular.length,
    },
    meanOverlapAt3: mean(done.map((r) => r.overlapAt3).filter((v): v is number => v !== null)),
    meanOverlapAt3VsPopular: mean(
      done.map((r) => r.overlapAt3VsPopular).filter((v): v is number => v !== null),
    ),
    meanKendallTau: mean(done.map((r) => r.kendallTau).filter((v): v is number => v !== null)),
    meanAffinityTop3: {
      tasteOn: on,
      tasteOff: off,
      popular: pop,
      difference: on !== null && off !== null ? on - off : null,
    },
    noFeasibleHandled: {
      scenarios: empties.length,
      withWaysForward: empties.filter((r) => r.relaxationsOffered > 0).length,
    },
  };
}

export interface EvaluationReport {
  kind: 'offline_simulated' | 'live_qloo';
  generatedAt: string;
  provider: Pick<ProviderDescriptor, 'mode' | 'label'>;
  scenarioCount: number;
  results: ScenarioResult[];
  summary: AggregateResult;
  method: string[];
  limits: string[];
}

export async function runEvaluation(
  provider: TasteProvider,
  specs: readonly ScenarioSpec[],
  options: RunnerOptions & { kind: EvaluationReport['kind']; now: Date },
): Promise<EvaluationReport> {
  const results: ScenarioResult[] = [];
  for (const spec of specs) results.push(await evaluateScenario(provider, spec, options));
  const simulated = options.kind === 'offline_simulated';
  return {
    kind: options.kind,
    generatedAt: options.now.toISOString(),
    provider: { mode: provider.descriptor.mode, label: provider.descriptor.label },
    scenarioCount: specs.length,
    results,
    summary: aggregate(results),
    method: [
      'Each scenario opens a case, records one disruption and runs one search.',
      'Both arms use the identical candidate pool, the identical feasibility gate and the identical exclusions. Only the ordering rule differs.',
      'Taste Off orders by distance to the original venue, then price level, then name. It uses no taste data.',
      'Popular orders by the provider general popularity, most popular first, with distance and price as tie breakers. It uses none of the group signals.',
      'Taste On orders by the app recovery score, which combines the provider affinity with closeness. Affinity is reported separately.',
      'The ungated list is the top three places by provider rank with no feasibility gate. It stands for a plain recommender.',
      options.useOracle
        ? 'Violations are judged by an independent implementation of the constraint rules that reads raw venue facts.'
        : 'Live venues lack most facts, so violations are those the gate itself can establish from facts the provider returned.',
    ],
    limits: simulated
      ? [
          'The catalogue, the venues and the affinity are invented and hand authored for this project.',
          'These results show how the pipeline behaves. They do not measure how well Qloo predicts what real people enjoy.',
          'The mean affinity difference is not independent evidence of better taste, because the simulated affinity defines taste in this catalogue.',
          'How often an ungated list breaks a constraint depends on how the catalogue and scenarios were authored. It must not be read as a rate in the real world.',
          'No people were involved in this evaluation.',
        ]
      : [
          'Results depend on the cities, the signals and the places Qloo returned on the day of the run.',
          'Qloo affinity describes what groups tend to like. It does not establish what a given person will enjoy.',
          'Opening hours, step free access and dietary options are read from Qloo when it states them. It never states group capacity or covered seating, so requirements on those stay unverified.',
          'No people were involved in this evaluation.',
        ],
  };
}
