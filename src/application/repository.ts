import type { CaseEvent, CaseMode, StoredEvent } from '../domain/case.js';

export class ConcurrencyError extends Error {
  constructor() {
    super('The case changed while this request was running. Reload and try again.');
    this.name = 'ConcurrencyError';
  }
}

export interface CaseSummary {
  id: string;
  title: string;
  mode: CaseMode;
  createdAt: string;
  updatedAt: string;
}

export interface CaseRepository {
  /** Creates a case with its first events. The first event must be case_opened. */
  create(input: {
    id: string;
    sessionKey: string;
    mode: CaseMode;
    title: string;
    at: string;
    expiresAt: string;
    events: CaseEvent[];
  }): void;
  /** Appends events if and only if the case still has expectedCount events. */
  append(caseId: string, expectedCount: number, at: string, events: CaseEvent[]): void;
  load(sessionKey: string, caseId: string): StoredEvent[] | null;
  list(sessionKey: string): CaseSummary[];
  remove(sessionKey: string, caseId: string): boolean;
  purgeExpired(now: string): number;
}
