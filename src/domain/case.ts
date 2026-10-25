import { z } from 'zod';
import { attestationSchema, type AttestationMap } from './feasibility.js';
import { intentAnchorSchema } from './intent.js';
import { disruptionSchema, type Disruption } from './plan.js';
import { candidateSchema, normaliseName, tasteScoreSchema } from './venue.js';

export const caseModeSchema = z.enum(['live', 'demo']);
export type CaseMode = z.infer<typeof caseModeSchema>;

export const resolutionKindSchema = z.enum(['entity', 'tag', 'category', 'original_venue']);
export type ResolutionKind = z.infer<typeof resolutionKindSchema>;

export const resolvedRefSchema = z.object({
  id: z.string().min(1).max(300),
  name: z.string().min(1).max(200),
  type: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  location: z.object({ lat: z.number(), lon: z.number() }).optional(),
});
export type ResolvedRef = z.infer<typeof resolvedRefSchema>;

export const tasteResolutionSchema = z.object({
  kind: resolutionKindSchema,
  input: z.string().max(200),
  status: z.enum(['resolved', 'ambiguous', 'not_found']),
  selected: resolvedRefSchema.optional(),
  /** Up to five candidates when the status is ambiguous. The person chooses among them. */
  candidates: z.array(resolvedRefSchema).max(5).optional(),
  method: z.enum(['exact', 'identifier', 'user_choice', 'simulation']).optional(),
  warnings: z.array(z.string().max(300)).max(5).optional(),
});
export type TasteResolution = z.infer<typeof tasteResolutionSchema>;

export function resolutionKey(kind: ResolutionKind, input: string): string {
  return `${kind}:${normaliseName(input)}`;
}

/** A redacted record of one call to the taste provider. It never holds a credential. */
export const callTraceSchema = z.object({
  endpoint: z.string().max(100),
  params: z.record(z.string(), z.string().max(400)),
  status: z.number().int().optional(),
  attempts: z.number().int().min(0).max(10),
  durationMs: z.number().min(0),
  cache: z.enum(['hit', 'miss']),
  resultCount: z.number().int().min(0).optional(),
  error: z.string().max(300).optional(),
});
export type CallTrace = z.infer<typeof callTraceSchema>;

export const searchRunSchema = z.object({
  runId: z.string().min(1).max(60),
  at: z.string().max(40),
  trigger: z.enum(['case_opened', 'disruption', 'manual']),
  pool: z.array(candidateSchema).max(100),
  tasteScores: z.array(tasteScoreSchema).max(100).nullable(),
  tasteStatus: z.enum(['applied', 'degraded', 'unavailable']),
  tasteNote: z.string().max(500).optional(),
  appliedSignals: z.object({
    entityNames: z.array(z.string().max(200)).max(10),
    tagNames: z.array(z.string().max(200)).max(10),
    categoryTag: z.string().max(200).optional(),
    location: z.string().max(100),
  }),
  traces: z.array(callTraceSchema).max(60),
});
export type SearchRun = z.infer<typeof searchRunSchema>;

export const caseEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('case_opened'),
    anchor: intentAnchorSchema,
    mode: caseModeSchema,
    providerLabel: z.string().max(200),
  }),
  z.object({
    type: z.literal('taste_resolution_recorded'),
    resolution: tasteResolutionSchema,
    /** The provider calls that produced this resolution, redacted. */
    traces: z.array(callTraceSchema).max(5).optional(),
  }),
  z.object({
    type: z.literal('taste_choice_made'),
    key: z.string().max(300),
    chosen: resolvedRefSchema,
  }),
  z.object({ type: z.literal('disruption_recorded'), disruption: disruptionSchema }),
  z.object({ type: z.literal('search_completed'), run: searchRunSchema }),
  z.object({
    type: z.literal('search_failed'),
    runId: z.string().max(60),
    code: z.string().max(60),
    message: z.string().max(400),
  }),
  z.object({
    type: z.literal('fact_attested'),
    candidateId: z.string().max(200),
    constraintKey: z.string().max(80),
    attestation: attestationSchema,
  }),
  z.object({ type: z.literal('constraint_relaxed'), constraintKey: z.string().max(80) }),
  z.object({
    type: z.literal('option_rejected'),
    candidateId: z.string().max(200),
    reason: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal('attempt_started'), candidateId: z.string().max(200) }),
  z.object({ type: z.literal('attempt_confirmed'), candidateId: z.string().max(200) }),
  z.object({
    type: z.literal('attempt_failed'),
    candidateId: z.string().max(200),
    note: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal('case_closed'), outcome: z.enum(['recovered', 'abandoned']) }),
]);
export type CaseEvent = z.infer<typeof caseEventSchema>;

export interface StoredEvent {
  seq: number;
  at: string;
  event: CaseEvent;
}

export type AttemptState = 'attempted' | 'confirmed' | 'failed';

export type CaseStatus =
  'needs_choices' | 'anchored' | 'recovering' | 'attempting' | 'recovered' | 'abandoned';

export interface CaseState {
  opened: Extract<CaseEvent, { type: 'case_opened' }>;
  createdAt: string;
  updatedAt: string;
  disruptions: Disruption[];
  resolutions: Record<string, TasteResolution>;
  resolutionTraces: CallTrace[];
  runs: SearchRun[];
  lastSearchFailure: { code: string; message: string; at: string } | null;
  attestations: AttestationMap;
  relaxedKeys: string[];
  userRejected: Record<string, string>;
  attempts: Record<string, AttemptState>;
  closed: 'recovered' | 'abandoned' | null;
}

export function foldEvents(events: readonly StoredEvent[]): CaseState {
  const first = events[0];
  if (!first || first.event.type !== 'case_opened') {
    throw new Error('A case must begin with a case_opened event.');
  }
  const state: CaseState = {
    opened: first.event,
    createdAt: first.at,
    updatedAt: first.at,
    disruptions: [],
    resolutions: {},
    resolutionTraces: [],
    runs: [],
    lastSearchFailure: null,
    attestations: {},
    relaxedKeys: [],
    userRejected: {},
    attempts: {},
    closed: null,
  };

  for (const stored of events.slice(1)) {
    const event = stored.event;
    state.updatedAt = stored.at;
    switch (event.type) {
      case 'case_opened':
        throw new Error('A case can only be opened once.');
      case 'taste_resolution_recorded':
        state.resolutions[resolutionKey(event.resolution.kind, event.resolution.input)] =
          event.resolution;
        if (event.traces) state.resolutionTraces.push(...event.traces);
        break;
      case 'taste_choice_made': {
        const existing = state.resolutions[event.key];
        if (existing) {
          state.resolutions[event.key] = {
            ...existing,
            status: 'resolved',
            selected: event.chosen,
            method: 'user_choice',
          };
        }
        break;
      }
      case 'disruption_recorded':
        state.disruptions.push(event.disruption);
        break;
      case 'search_completed':
        state.runs.push(event.run);
        state.lastSearchFailure = null;
        break;
      case 'search_failed':
        state.lastSearchFailure = { code: event.code, message: event.message, at: stored.at };
        break;
      case 'fact_attested': {
        const forCandidate = state.attestations[event.candidateId] ?? {};
        forCandidate[event.constraintKey] = event.attestation;
        state.attestations[event.candidateId] = forCandidate;
        break;
      }
      case 'constraint_relaxed':
        if (!state.relaxedKeys.includes(event.constraintKey)) {
          state.relaxedKeys.push(event.constraintKey);
        }
        break;
      case 'option_rejected':
        state.userRejected[event.candidateId] = event.reason ?? 'Declined by you';
        break;
      case 'attempt_started':
        state.attempts[event.candidateId] = 'attempted';
        break;
      case 'attempt_confirmed':
        state.attempts[event.candidateId] = 'confirmed';
        break;
      case 'attempt_failed':
        state.attempts[event.candidateId] = 'failed';
        break;
      case 'case_closed':
        state.closed = event.outcome;
        break;
    }
  }
  return state;
}

export function pendingChoices(state: CaseState): TasteResolution[] {
  return Object.values(state.resolutions).filter((resolution) => resolution.status === 'ambiguous');
}

export function deriveStatus(state: CaseState): CaseStatus {
  if (state.closed === 'recovered') return 'recovered';
  if (state.closed === 'abandoned') return 'abandoned';
  if (Object.values(state.attempts).includes('confirmed')) return 'recovered';
  if (Object.values(state.attempts).includes('attempted')) return 'attempting';
  if (pendingChoices(state).length > 0) return 'needs_choices';
  if (state.disruptions.length === 0) return 'anchored';
  return 'recovering';
}
