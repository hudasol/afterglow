# 0006. Accept ephemeral storage on the hosted demo

Status: accepted, 25 October 2026.

## Context

The hosted demo runs on a free Render web service. Its disk is ephemeral, it sleeps after fifteen minutes without traffic, and a free database would add a second moving part to a demonstration that holds nothing private.

## Decision

The demo keeps cases in a SQLite file under `/tmp` and says on screen that a public demo keeps cases only temporarily. Idle cases are removed after 48 hours. A scheduled workflow pings the health endpoint during the judging window so that the service does not sleep. The application itself uses a file path from `DATABASE_PATH`, so a persistent disk or another host needs no code change.

## Consequences

- A restart or a redeploy loses cases. A link to a case can then show that it no longer exists.
- Nothing of value is stored: there are no accounts, and the data is a plan the person typed and the places Qloo returned.
- A production deployment would need a persistent volume and one instance per database file, because case locking is in process.
