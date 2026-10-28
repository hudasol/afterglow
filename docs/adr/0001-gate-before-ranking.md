# 0001. Check hard requirements before ranking, and never treat unknown as a pass

Status: accepted, 25 October 2026.

## Context

A recommender orders places by taste or popularity. When a plan has to be rescued, some of those places cannot work: they are closed at the planned time, too far away, over the budget, or unable to seat the group. A person who has already lost a booking is the least able to find that out late.

The data is also incomplete. Qloo states opening hours, step free access and dietary options for only part of the places it returns, and never states group capacity or covered seating.

## Decision

Every candidate is checked against every hard requirement before any ordering happens. Each check returns pass, fail or unknown. A fail rules the place out. An unknown never passes: the place is shown as needing a check, and only the person's own word settles it. The same gate feeds every ordering, so the orderings differ only in how they rank the same places. An independent oracle, written separately and reading the raw facts, judges the lists in evaluation.

## Consequences

- A place that breaks a requirement on a known fact cannot be offered, whatever its taste score.
- A plan with many requirements that the data cannot answer can show few places as ready, or none. The interface says so and asks the person to check, and it can propose the smallest set of requirements to give up.
- Violation counts in the evaluation are lower bounds, because an unknown is never counted against a place.
