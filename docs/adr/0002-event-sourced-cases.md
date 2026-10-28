# 0002. Store a case as an append only list of events

Status: accepted, 25 October 2026.

## Context

The product promises that the plan is fixed once, that every later change is layered on top, and that the person can see what happened and why. Several screens read the same history: the recovery view, the history tab, the evidence tab and the agent trace.

## Decision

A case is an append only list of typed events: opened, matches recorded, choices made, disruptions, searches, attestations, relaxations, rejections, attempts and closure. State is derived by folding the events, and the interface views are built from that state. Writes are serialised per case and checked with optimistic concurrency. The agent trace is computed from the events and never stored.

## Consequences

- The screens cannot disagree with each other, and the trace cannot describe a step that did not happen.
- The intent anchor cannot be edited, because there is no event that edits it.
- Reading a case replays its events. Cases are short, so this is cheap, and a snapshot can be added later without changing the log.
- The schema is a log, so correcting an event means appending a new one.
