import type { CallTrace, CaseMode, ResolutionKind, TasteResolution } from '../domain/case.js';
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
