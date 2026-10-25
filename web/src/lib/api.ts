import type { CaseView } from '../../../src/domain/case-view.js';
import type { Disruption } from '../../../src/domain/plan.js';
import type { CaseMode } from '../../../src/domain/case.js';
import type { IntentAnchor } from '../../../src/domain/intent.js';
import type { AgentTrace } from '../../../src/domain/trace.js';
import { getSession } from './session';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        'x-afterglow-session': getSession(),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      'network',
      'The server could not be reached. Check your connection and try again.',
      0,
    );
  }
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      error?.code ?? 'error',
      error?.message ?? 'The request failed.',
      response.status,
    );
  }
  return payload as T;
}

export interface ServerStatus {
  version: string;
  publicDemo: boolean;
  modes: {
    live: {
      configured: boolean;
      label: string;
      baseUrl: string;
      callsToday: number | null;
      dailyCap: number;
      /** True when live cases may read opening hours and similar facts from OpenStreetMap. */
      placeFacts: boolean;
    };
    demo: { configured: boolean; label: string; cities: string[] };
  };
}

export interface ScenarioPreset {
  id: string;
  title: string;
  summary: string;
  anchor: IntentAnchor;
  disruption: Disruption;
  choices?: Record<string, string>;
}

export interface CaseListItem {
  id: string;
  title: string;
  mode: CaseMode;
  status: CaseView['status'];
  createdAt: string;
  updatedAt: string;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  code?: string;
  message: string;
}

export interface Provenance {
  caseId: string;
  generatedAt: string;
  mode: CaseMode;
  providerLabel: string;
  sentToProvider: {
    locationQuery: string;
    categoryPhrase: string;
    entityNames: string[];
    tagPhrases: string[];
    originalVenueName: string | null;
  };
  sentToPlaceFacts: { source: string; sent: string; places: number } | null;
  keptLocal: string[];
  choices: {
    kind: string;
    input: string;
    status: string;
    selected: { id: string; name: string } | null;
    method: string | null;
    alternativesConsidered: { id: string; name: string }[];
  }[];
  calls: { resolution: CallRecord[]; latestSearch: CallRecord[] };
  result: {
    runId: string;
    poolSize: number;
    tasteStatus: string;
    tasteNote: string | undefined;
    placeFacts: { looked: number; matched: number; filled: number; note?: string } | undefined;
    shortlist: {
      name: string;
      providerRank: number | null;
      providerAffinity: number | null;
      feasibility: string;
    }[];
  } | null;
  note: string;
}

export interface CallRecord {
  endpoint: string;
  params: Record<string, string>;
  status?: number;
  attempts: number;
  durationMs: number;
  cache: 'hit' | 'miss';
  resultCount?: number;
  error?: string;
}

export interface EvaluationReportFile {
  kind: 'offline_simulated' | 'live_qloo';
  generatedAt: string;
  provider: { mode: string; label: string };
  scenarioCount: number;
  summary: {
    scenarios: number;
    completed: number;
    ungatedScenariosWithViolation: number;
    ungatedTopSlotsViolating: { violating: number; total: number };
    gatedViolations: { tasteOn: number; tasteOff: number };
    sameEligibleSetEverywhere: boolean;
    topChoiceChanged: { changed: number; compared: number };
    meanOverlapAt3: number | null;
    meanKendallTau: number | null;
    meanAffinityTop3: {
      tasteOn: number | null;
      tasteOff: number | null;
      difference: number | null;
    };
    noFeasibleHandled: { scenarios: number; withWaysForward: number };
  };
  method: string[];
  limits: string[];
}

export interface SmokeReportFile {
  generatedAt: string;
  verdict: 'go' | 'conditional' | 'no_go';
  reasons: string[];
  checks: { name: string; ok: boolean; detail: string }[];
  options: { city: string };
}

export interface ShowcaseEntry {
  name: string;
  ruledOutBecause: string | null;
  needsCheck: string | null;
  providerRank: number | null;
}

export interface Showcase {
  label: string;
  title: string;
  summary: string;
  disruption: string;
  withoutGate: ShowcaseEntry[];
  afterglow: ShowcaseEntry[];
}

export const api = {
  showcase: () => request<Showcase>('GET', '/showcase'),
  status: () => request<ServerStatus>('GET', '/status'),
  scenarios: () => request<{ scenarios: ScenarioPreset[] }>('GET', '/scenarios'),
  evaluation: () =>
    request<{ reports: EvaluationReportFile[]; smoke: SmokeReportFile[] }>('GET', '/evaluation'),
  probe: () => request<ProbeResult>('POST', '/integration/probe'),
  listCases: () => request<{ cases: CaseListItem[] }>('GET', '/cases'),
  openCase: (input: { mode: CaseMode; anchor: IntentAnchor; disruption: Disruption }) =>
    request<CaseView>('POST', '/cases', input),
  getCase: (id: string) => request<CaseView>('GET', `/cases/${encodeURIComponent(id)}`),
  deleteCase: (id: string) => request<void>('DELETE', `/cases/${encodeURIComponent(id)}`),
  trace: (id: string) => request<AgentTrace>('GET', `/cases/${encodeURIComponent(id)}/trace`),
  provenance: (id: string) =>
    request<Provenance>('GET', `/cases/${encodeURIComponent(id)}/provenance`),
  choose: (id: string, body: { key: string; chosenId?: string; skip?: boolean }) =>
    request<CaseView>('POST', `/cases/${encodeURIComponent(id)}/choices`, body),
  disrupt: (id: string, disruption: Disruption) =>
    request<CaseView>('POST', `/cases/${encodeURIComponent(id)}/disruptions`, { disruption }),
  search: (id: string) => request<CaseView>('POST', `/cases/${encodeURIComponent(id)}/search`),
  attest: (id: string, body: { candidateId: string; constraintKey: string; satisfied: boolean }) =>
    request<CaseView>('POST', `/cases/${encodeURIComponent(id)}/attestations`, body),
  relax: (id: string, constraintKeys: string[]) =>
    request<CaseView>('POST', `/cases/${encodeURIComponent(id)}/relaxations`, { constraintKeys }),
  reject: (id: string, candidateId: string, reason?: string) =>
    request<CaseView>(
      'POST',
      `/cases/${encodeURIComponent(id)}/options/${encodeURIComponent(candidateId)}/reject`,
      reason ? { reason } : {},
    ),
  attempt: (id: string, candidateId: string) =>
    request<CaseView>(
      'POST',
      `/cases/${encodeURIComponent(id)}/options/${encodeURIComponent(candidateId)}/attempt`,
    ),
  confirm: (id: string, candidateId: string) =>
    request<CaseView>(
      'POST',
      `/cases/${encodeURIComponent(id)}/options/${encodeURIComponent(candidateId)}/confirm`,
    ),
  fail: (id: string, candidateId: string, note?: string) =>
    request<CaseView>(
      'POST',
      `/cases/${encodeURIComponent(id)}/options/${encodeURIComponent(candidateId)}/fail`,
      note ? { note } : {},
    ),
  close: (id: string, outcome: 'recovered' | 'abandoned') =>
    request<CaseView>('POST', `/cases/${encodeURIComponent(id)}/close`, { outcome }),
};
