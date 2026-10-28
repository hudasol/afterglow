/*
 * The baseline comparison. For one plan it builds the same top three in several ways, from the
 * same pool, and describes each list with the same measures:
 *
 *   random       a seeded random pick
 *   nearest      closest to the venue that fell through, with no taste data
 *   popular      Qloo's general popularity, with none of the group's signals
 *   taste only   Qloo affinity alone, with no distance
 *   afterglow    the product: the gate, then rescaled affinity blended with closeness
 *
 * Each arm is built twice. The gated lists are what the product could show. The ungated lists
 * are what a plain recommender would show, and stand for the way people choose a replacement
 * today. Both are checked against the plan's hard requirements by the independent oracle.
 */
import type { TasteProvider } from '../application/ports.js';
import type { CaseView, OptionView } from '../domain/case-view.js';
import { mean } from '../domain/metrics.js';
import { normaliseName } from '../domain/venue.js';
import type { ScenarioSpec } from '../simulation/scenarios.js';
import { oracleViolations } from './oracle.js';
import { openCaseView } from './runner.js';
import { mulberry32 } from './stats.js';

export const TOP = 3;
export const BASELINE_SEED = 20261028;

export const GATED_ARMS = ['random', 'nearest', 'popular', 'taste_only', 'afterglow'] as const;
export const UNGATED_ARMS = ['random', 'nearest', 'popular', 'taste_only'] as const;
export type GatedArm = (typeof GATED_ARMS)[number];
export type UngatedArm = (typeof UNGATED_ARMS)[number];

/** One place on a list, with what the independent oracle and the gate say about it. */
export interface ListedPlace {
  name: string;
  /** What the oracle finds against the place on a known fact. Empty when nothing is found. */
  against: string[];
  feasibility: OptionView['feasibility'];
  distanceKm: number | null;
  affinity: number | null;
}

export interface ListMeasures {
  names: string[];
  places: ListedPlace[];
  /** Places on the list that break a requirement, judged by the independent oracle. */
  violations: number;
  /** Places the gate rules out, places it cannot decide, and places that pass on known facts. */
  ruledOut: number;
  needsCheck: number;
  verified: number;
  meanKm: number | null;
  meanAffinity: number | null;
  /** Mean affinity of the list minus the mean of the eligible pool, in standard deviations of the pool. */
  affinityLift: number | null;
  /** Share of the places that carry tags and are on the list that carry a tag the person asked for. */
  vibeShare: number | null;
}

export interface TasteCoverage {
  scored: number;
  /** Share of the pool that Qloo scored. */
  scoredShare: number;
  spread: number | null;
  tasteStatus: string;
  /** Names of the example places sent for the vibes, when vibes were sent that way. */
  exemplarCount: number;
}

export interface BaselineResult {
  id: string;
  title: string;
  ok: boolean;
  error?: string;
  poolSize: number;
  eligible: number;
  coverage: TasteCoverage;
  gated: Record<GatedArm, ListMeasures | null>;
  ungated: Record<UngatedArm, ListMeasures | null>;
  /** Whether the AFTERGLOW top choice differs from the top choice of each gated baseline. */
  topChoiceDiffers: { nearest: boolean | null; popular: boolean | null; tasteOnly: boolean | null };
  /** The same plan run with vibe tags sent as tags, as the first version did. Null when not run. */
  ablationTags:
    (TasteCoverage & { list: ListMeasures | null; topChoiceDiffersNearest: boolean | null }) | null;
  providerCalls: number;
}

function hashSeed(seed: number, text: string): number {
  let hash = seed >>> 0;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

const byDistance = (a: OptionView, b: OptionView): number =>
  (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
  a.candidate.name.localeCompare(b.candidate.name, 'en');

const groupOf = (option: OptionView): number => (option.feasibility === 'feasible' ? 0 : 1);

function standardDeviation(values: readonly number[]): number {
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length);
}

function affinityOf(option: OptionView): number | null {
  const value = option.providerTaste?.affinity;
  return typeof value === 'number' ? value : null;
}

function measure(
  view: CaseView,
  list: readonly OptionView[],
  checkOriginal: boolean,
): ListMeasures {
  const eligibleAffinities = view.options
    .filter((o) => o.feasibility !== 'rejected')
    .map(affinityOf)
    .filter((v): v is number => v !== null);
  const listAffinity = mean(list.map(affinityOf).filter((v): v is number => v !== null));
  const sd = eligibleAffinities.length > 1 ? standardDeviation(eligibleAffinities) : 0;
  const poolMean = mean(eligibleAffinities);
  const tagged = list.filter((o) => (o.candidate.taste.tagNames?.length ?? 0) > 0);
  const against = (o: OptionView): string[] =>
    oracleViolations(
      o.candidate,
      view.plan,
      view.originalLocation,
      view.anchor.originalVenue.name,
      checkOriginal,
    );
  return {
    names: list.map((o) => o.candidate.name),
    places: list.map((o) => ({
      name: o.candidate.name,
      against: against(o),
      feasibility: o.feasibility,
      distanceKm: o.distanceKm,
      affinity: affinityOf(o),
    })),
    violations: list.filter((o) => against(o).length > 0).length,
    ruledOut: list.filter((o) => o.feasibility === 'rejected').length,
    needsCheck: list.filter((o) => o.feasibility === 'needs_verification').length,
    verified: list.filter((o) => o.feasibility === 'feasible').length,
    meanKm: mean(list.map((o) => o.distanceKm).filter((v): v is number => v !== null)),
    meanAffinity: listAffinity,
    affinityLift:
      listAffinity !== null && poolMean !== null && sd > 1e-9
        ? (listAffinity - poolMean) / sd
        : null,
    vibeShare:
      tagged.length === 0
        ? null
        : tagged.filter((o) => o.matchedTags.length > 0).length / tagged.length,
  };
}

function coverageOf(view: CaseView): TasteCoverage {
  const affinities = view.options.map(affinityOf).filter((v): v is number => v !== null);
  const scored = view.options.filter((o) => o.providerTaste !== null).length;
  return {
    scored,
    scoredShare: view.options.length === 0 ? 0 : scored / view.options.length,
    spread: affinities.length > 1 ? Math.max(...affinities) - Math.min(...affinities) : null,
    tasteStatus: view.run?.tasteStatus ?? 'no run',
    exemplarCount: (view.run?.appliedSignals.exemplars ?? []).reduce(
      (sum, set) => sum + set.places.length,
      0,
    ),
  };
}

/** The gated lists of every arm, from one case view. */
export function gatedLists(
  view: CaseView,
  seed: number,
  id: string,
): Record<GatedArm, OptionView[]> {
  const eligible = view.options.filter((o) => o.feasibility !== 'rejected');
  const grouped = (order: (a: OptionView, b: OptionView) => number) =>
    [...eligible].sort((a, b) => groupOf(a) - groupOf(b) || order(a, b));
  const random = mulberry32(hashSeed(seed, id));
  const shuffleOrder = new Map(shuffled(eligible, random).map((o, i) => [o.candidate.id, i]));
  return {
    random: grouped(
      (a, b) => (shuffleOrder.get(a.candidate.id) ?? 0) - (shuffleOrder.get(b.candidate.id) ?? 0),
    ),
    nearest: [...eligible].sort(
      (a, b) => (a.tasteOffPosition ?? Infinity) - (b.tasteOffPosition ?? Infinity),
    ),
    popular: [...eligible]
      .filter((o) => o.popularPosition !== null)
      .sort((a, b) => (a.popularPosition ?? Infinity) - (b.popularPosition ?? Infinity)),
    taste_only: grouped((a, b) => {
      const x = affinityOf(a);
      const y = affinityOf(b);
      if (x !== null && y !== null && x !== y) return y - x;
      if (x !== null && y === null) return -1;
      if (x === null && y !== null) return 1;
      return byDistance(a, b);
    }),
    afterglow: [...eligible]
      .filter((o) => o.tasteOn !== null)
      .sort((a, b) => (a.tasteOn?.position ?? Infinity) - (b.tasteOn?.position ?? Infinity)),
  };
}

/** The ungated lists. The venue that fell through is left out, as any sensible recommender would. */
export function ungatedLists(
  view: CaseView,
  seed: number,
  id: string,
): Record<UngatedArm, OptionView[]> {
  const original = normaliseName(view.anchor.originalVenue.name);
  const pool = view.options.filter((o) => normaliseName(o.candidate.name) !== original);
  const random = mulberry32(hashSeed(seed + 1, id));
  return {
    random: shuffled(pool, random),
    nearest: [...pool].filter((o) => o.distanceKm !== null).sort(byDistance),
    popular: [...pool]
      .filter((o) => typeof o.candidate.taste.popularity === 'number')
      .sort(
        (a, b) =>
          (b.candidate.taste.popularity ?? 0) - (a.candidate.taste.popularity ?? 0) ||
          byDistance(a, b),
      ),
    taste_only: [...pool]
      .filter((o) => o.providerTaste !== null)
      .sort((a, b) => (a.providerTaste?.rank ?? 0) - (b.providerTaste?.rank ?? 0)),
  };
}

const top = (list: readonly OptionView[]): OptionView[] => list.slice(0, TOP);
const firstId = (list: readonly OptionView[]): string | null => list[0]?.candidate.id ?? null;
const differs = (a: string | null, b: string | null): boolean | null =>
  a === null || b === null ? null : a !== b;

export interface BaselineOptions {
  seed?: number;
  /** A second provider that sends vibe tags as tags, for the ablation. Omit to skip it. */
  ablation?: TasteProvider;
}

export async function evaluateBaselines(
  provider: TasteProvider,
  spec: ScenarioSpec,
  options: BaselineOptions = {},
): Promise<BaselineResult> {
  const seed = options.seed ?? BASELINE_SEED;
  const failure = (error: string): BaselineResult => ({
    id: spec.id,
    title: spec.title,
    ok: false,
    error,
    poolSize: 0,
    eligible: 0,
    coverage: {
      scored: 0,
      scoredShare: 0,
      spread: null,
      tasteStatus: 'unavailable',
      exemplarCount: 0,
    },
    gated: { random: null, nearest: null, popular: null, taste_only: null, afterglow: null },
    ungated: { random: null, nearest: null, popular: null, taste_only: null },
    topChoiceDiffers: { nearest: null, popular: null, tasteOnly: null },
    ablationTags: null,
    providerCalls: 0,
  });

  let opened;
  try {
    opened = await openCaseView(provider, spec);
    const view = opened.view;
    if (!view.run) {
      return failure(
        view.searchFailure
          ? `${view.searchFailure.code}: ${view.searchFailure.message}`
          : 'No search ran',
      );
    }
    const gated = gatedLists(view, seed, spec.id);
    const ungated = ungatedLists(view, seed, spec.id);
    const measureGated = (arm: GatedArm) =>
      gated[arm].length > 0 ? measure(view, top(gated[arm]), true) : null;
    const measureUngated = (arm: UngatedArm) =>
      ungated[arm].length > 0 ? measure(view, top(ungated[arm]), false) : null;

    let ablationTags: BaselineResult['ablationTags'] = null;
    if (options.ablation) {
      let other;
      try {
        other = await openCaseView(options.ablation, spec);
        const list = gatedLists(other.view, seed, spec.id).afterglow;
        ablationTags = {
          ...coverageOf(other.view),
          list: list.length > 0 ? measure(other.view, top(list), true) : null,
          topChoiceDiffersNearest: differs(
            firstId(list),
            firstId(gatedLists(other.view, seed, spec.id).nearest),
          ),
        };
      } catch {
        ablationTags = null;
      } finally {
        other?.close();
      }
    }

    return {
      id: spec.id,
      title: spec.title,
      ok: true,
      poolSize: view.options.length,
      eligible: view.options.filter((o) => o.feasibility !== 'rejected').length,
      coverage: coverageOf(view),
      gated: {
        random: measureGated('random'),
        nearest: measureGated('nearest'),
        popular: measureGated('popular'),
        taste_only: measureGated('taste_only'),
        afterglow: measureGated('afterglow'),
      },
      ungated: {
        random: measureUngated('random'),
        nearest: measureUngated('nearest'),
        popular: measureUngated('popular'),
        taste_only: measureUngated('taste_only'),
      },
      topChoiceDiffers: {
        nearest: differs(firstId(gated.afterglow), firstId(gated.nearest)),
        popular: differs(firstId(gated.afterglow), firstId(gated.popular)),
        tasteOnly: differs(firstId(gated.afterglow), firstId(gated.taste_only)),
      },
      ablationTags,
      providerCalls: [...view.resolutionTraces, ...view.run.traces].filter(
        (trace) => trace.cache === 'miss',
      ).length,
    };
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'Unknown error');
  } finally {
    opened?.close();
  }
}
