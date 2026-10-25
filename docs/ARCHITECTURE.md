# Architecture

AFTERGLOW is a TypeScript application with a layered design. Dependencies point inward: the domain imports nothing from outer layers and performs no input or output.

```
interfaces (HTTP, CLI)  ->  application  ->  domain
infrastructure (SQLite, config)  ->  application, domain
qloo and simulation (taste providers)  ->  application ports, domain
web (React)  ->  HTTP API, plus types and pure functions from the domain
```

## Domain

Pure rules and data shapes.

- **Evidence.** Every fact is a `Fact<T>`: either known, with a value and a provenance (Qloo, simulation, user, user attested, app), or unknown, with a reason. There is no way to hold a value without saying where it came from.
- **Intent Anchor.** The plan as described once. It requires at least one taste signal and rejects duplicate constraints. It is never modified.
- **Plan.** Disruptions are applied to the anchor to produce an effective plan. A budget change can only tighten. Weather adds a covered space requirement. A party change adds a seating requirement. Relaxations the person approved remove requirements from the effective plan without touching the anchor.
- **Feasibility gate.** For each candidate and each hard constraint the gate returns pass, fail or unknown. Any fail rules the place out. Any unknown leaves it needing verification. Only a full set of passes is feasible. A person's attestation overrides data, and the verdict records that basis.
- **Scoring.** Taste Off orders by distance, then price, then name. Taste On uses 0.75 times the taste score plus 0.25 times the closeness score. The taste score is the Qloo affinity, or a rank derived value when no affinity is returned. Closeness is one minus the distance to the original venue over ten kilometres. Missing components are dropped and the weights are renormalised.
- **Recommendation.** The gate runs once. Both arms order the same eligible set.
- **Relaxation.** Offered only when no option remains. It proposes the smallest sets of requirements, up to three, that would admit at least one place, and applies one only on the person's agreement.
- **Case events.** A case is an append only list of typed events: opened, matches recorded, choices made, disruptions, searches completed or failed, attestations, relaxations, rejections, attempts started, confirmed or failed, and closure. Folding the events gives the case state. A view builder turns state into the structure the interface shows.

## Application

`RecoveryService` implements the use cases: open a case, choose among ambiguous matches, record a disruption, search again, attest a fact, relax requirements, decline an option, start, confirm or fail an attempt, close, read, list, delete, and explain provenance. Writes are serialised per case with an in process lock and checked with optimistic concurrency. A `TasteProvider` port has three operations: resolve a name or phrase, fetch a pool of places, and rank a fixed pool.

## Infrastructure

SQLite through `node:sqlite` with SQL migrations and synchronous transactions. Configuration is validated at start. The server refuses to listen on a non loopback address unless a token or public demo mode is set.

## Taste providers

- `QlooTasteProvider` calls the Qloo API through `QlooClient`.
- `SimulatedTasteProvider` serves an invented city, Harbourvale, with 32 invented venues and a simulated affinity formula. Every screen that uses it says so. It exists for demonstration and tests and is never presented as Qloo data.

## HTTP interface

Express 5 with security headers, a host check for loopback binds, an origin check on writes, a rate limit, an optional bearer token, and a 64 KB JSON limit. Cases are scoped to a browser by a random session identifier sent in a header and stored only as a SHA 256 hash. The built interface is served from the same process.

## Web

React 19 with Vite and a hash router. The interface imports types and a few pure functions from the domain so that the view contract is checked at compile time. It never holds the Qloo key.

## Why event sourcing

The case history is a requirement of the product, not an add on. Because state is derived from events, the history tab, the evidence tab and the recovery view cannot disagree with each other, and every decision the person made is preserved in order.
