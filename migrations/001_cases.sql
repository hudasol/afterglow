-- Cases are event sourced. The cases table is an index for listing and expiry. The state of a
-- case is always rebuilt by folding its events in order.
CREATE TABLE cases (
  id          TEXT PRIMARY KEY,
  session_key TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('live', 'demo')),
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE INDEX idx_cases_session ON cases (session_key, updated_at DESC);
CREATE INDEX idx_cases_expiry ON cases (expires_at);

CREATE TABLE case_events (
  case_id TEXT NOT NULL REFERENCES cases (id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,
  at      TEXT NOT NULL,
  type    TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (case_id, seq)
);
