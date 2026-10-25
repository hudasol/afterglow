import { caseEventSchema, type CaseEvent, type StoredEvent } from '../domain/case.js';
import {
  ConcurrencyError,
  type CaseRepository,
  type CaseSummary,
} from '../application/repository.js';
import type { Database } from './database.js';

interface EventRow {
  seq: number;
  at: string;
  payload: string;
}

export class SqliteCaseRepository implements CaseRepository {
  constructor(private readonly db: Database) {}

  create(input: Parameters<CaseRepository['create']>[0]): void {
    this.db.transaction(() => {
      this.db.sql
        .prepare(
          `INSERT INTO cases (id, session_key, mode, title, created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.sessionKey,
          input.mode,
          input.title,
          input.at,
          input.at,
          input.expiresAt,
        );
      this.#insert(input.id, 0, input.at, input.events);
    });
  }

  append(caseId: string, expectedCount: number, at: string, events: CaseEvent[]): void {
    this.db.transaction(() => {
      const row = this.db.sql
        .prepare('SELECT COUNT(*) AS count FROM case_events WHERE case_id = ?')
        .get(caseId) as { count: number } | undefined;
      if (!row || row.count !== expectedCount) throw new ConcurrencyError();
      this.#insert(caseId, expectedCount, at, events);
      this.db.sql.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(at, caseId);
    });
  }

  #insert(caseId: string, startSeq: number, at: string, events: CaseEvent[]): void {
    const statement = this.db.sql.prepare(
      'INSERT INTO case_events (case_id, seq, at, type, payload) VALUES (?, ?, ?, ?, ?)',
    );
    events.forEach((event, index) => {
      statement.run(caseId, startSeq + index, at, event.type, JSON.stringify(event));
    });
  }

  load(sessionKey: string, caseId: string): StoredEvent[] | null {
    const owner = this.db.sql
      .prepare('SELECT id FROM cases WHERE id = ? AND session_key = ?')
      .get(caseId, sessionKey);
    if (!owner) return null;
    const rows = this.db.sql
      .prepare('SELECT seq, at, payload FROM case_events WHERE case_id = ? ORDER BY seq')
      .all(caseId) as unknown as EventRow[];
    return rows.map((row) => ({
      seq: row.seq,
      at: row.at,
      event: caseEventSchema.parse(JSON.parse(row.payload)),
    }));
  }

  list(sessionKey: string): CaseSummary[] {
    const rows = this.db.sql
      .prepare(
        `SELECT id, title, mode, created_at, updated_at FROM cases
         WHERE session_key = ? ORDER BY updated_at DESC LIMIT 50`,
      )
      .all(sessionKey) as unknown as {
      id: string;
      title: string;
      mode: 'live' | 'demo';
      created_at: string;
      updated_at: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      mode: row.mode,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  remove(sessionKey: string, caseId: string): boolean {
    const result = this.db.sql
      .prepare('DELETE FROM cases WHERE id = ? AND session_key = ?')
      .run(caseId, sessionKey);
    return Number(result.changes) > 0;
  }

  purgeExpired(now: string): number {
    const result = this.db.sql.prepare('DELETE FROM cases WHERE expires_at < ?').run(now);
    return Number(result.changes);
  }
}
