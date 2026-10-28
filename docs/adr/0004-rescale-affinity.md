# 0004. Rescale affinity across the eligible places before blending

Status: accepted, 28 October 2026.

## Context

The recovery score blends taste with closeness, with a stated weight of 0.75 on taste. Within one pool the Qloo affinities lie within about 0.1 of each other, while closeness spans 0 to 1. The stated weight therefore did not hold: distance decided the order whatever Qloo said.

## Decision

Affinity is rescaled across the places that passed the gate before it is blended. The lowest scored place becomes 0 and the highest 1, and identical affinities become a neutral 0.5. The weights are unchanged.

## Consequences

- The stated weights describe what the ranking does.
- A small difference in affinity is magnified within a pool, so the top choice can rest on a small difference in what Qloo returned. The raw affinity is still shown on each option.
- On the development scenarios the top choice was the taste only top choice in all 20 scenarios, and the top three was on average 0.30 km closer than the taste only top three. The held out test scenarios repeat this as predictions B9, B12 and B14.
