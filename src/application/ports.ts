import type { CallTrace, CaseMode, ResolutionKind, TasteResolution } from '../domain/case.js';
import type { FactContext } from '../domain/fact-context.js';
import type { EffectivePlan } from '../domain/plan.js';
import type { Candidate, TasteScore } from '../domain/venue.js';

export class ProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = retryable;
  }
}

/** Collects a redacted record of every provider call made during one operation. */
export interface ProviderContext {
  traces: CallTrace[];
  /** City level context used only to tell apart places that share a name. */
  city?: string;
  signal?: AbortSignal;
}

export interface PoolRequest {
  city: string;
  categoryTagId?: string;
  take: number;
  /** The day, time and requirements of the plan, so facts such as opening hours can be judged. */
  facts?: FactContext;
}

export interface RankRequest {
  city: string;
  candidateIds: string[];
  entityIds: string[];
  tagIds: string[];
}

export interface RankResponse {
  scores: TasteScore[];
  /** Set when the provider had to drop part of the request. Shown to the person. */
  degradedNote?: string;
  /** The vibe tags that were applied, as tags or as example places. Can be fewer than were asked for. */
  appliedTagIds?: string[];
  /** Places found for a vibe tag and sent as signals in its place. Listed so the person can see them. */
  exemplars?: Array<{ tagId: string; places: Array<{ id: string; name: string }> }>;
}

export interface ProviderDescriptor {
  mode: CaseMode;
  /** Shown in the interface next to results so the source is never ambiguous. */
  label: string;
  /** False when the provider cannot serve requests, for example when no key is set. */
  configured: boolean;
  /** When set, the provider only serves these cities. Used by the simulated provider. */
  supportedCities?: string[];
}

/**
 * The only way the application reaches taste data. The live adapter talks to Qloo. The
 * simulation adapter serves a labelled demo catalogue and never claims to be Qloo.
 */
export interface TasteProvider {
  readonly descriptor: ProviderDescriptor;
  resolve(kind: ResolutionKind, input: string, ctx: ProviderContext): Promise<TasteResolution>;
  fetchPool(request: PoolRequest, ctx: ProviderContext): Promise<Candidate[]>;
  rank(request: RankRequest, ctx: ProviderContext): Promise<RankResponse>;
}

export interface PlaceFactsResult {
  candidates: Candidate[];
  /** How many places were looked up, how many were matched, and how many facts were filled in. */
  looked: number;
  matched: number;
  filled: number;
  /** Set when the lookup failed or was skipped in a way the person should know about. */
  note?: string;
}

/**
 * Fills in practical facts that the taste provider does not supply, such as opening hours. It only
 * ever sets a fact that is still unknown, it records where each value came from, and when it
 * cannot answer it leaves the fact unknown so the person is asked instead.
 */
export interface PlaceFactsProvider {
  /** Shown next to the facts it supplied. */
  readonly label: string;
  enrich(
    candidates: readonly Candidate[],
    plan: EffectivePlan,
    ctx: ProviderContext,
  ): Promise<PlaceFactsResult>;
}
