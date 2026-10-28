# Evaluation results: offline, simulated catalogue

Generated: 2026-10-28T15:33:23.794Z
Source: Simulated demo catalogue (not Qloo data, not real venues)
Scenarios: 17 completed of 17

> This report uses an invented catalogue and an invented affinity. It checks the behaviour of the pipeline. It is not evidence about the quality of Qloo recommendations.

## Summary

| Measure | Result |
| --- | --- |
| Scenarios where an ungated top three contained a venue that breaks a hard constraint | 12 of 17 |
| Ungated top three slots that break a hard constraint | 18 of 49 |
| Violations in the gated top three, Taste On / Taste Off | 0 / 0 |
| Both arms offered the identical eligible set in every scenario | yes |
| Top choice differs between Taste On and Taste Off | 9 of 17 |
| Top choice differs between Taste On and Popular | 8 of 16 |
| Mean overlap of the top three, Taste On against Taste Off | 92% |
| Mean overlap of the top three, Taste On against Popular | 75% |
| Mean Kendall tau between the two orderings | 0.35 |
| Mean provider affinity of the top three, Taste On / Taste Off / Popular | 0.45 / 0.42 / 0.36 |
| Scenarios with no eligible option that offered a way forward | 1 of 1 |

## Scenarios

| Scenario | Pool | Rejected / feasible / needs check | Ungated violations in top three | Gated violations On / Off | Top choice changed | Overlap at 3 |
| --- | --- | --- | --- | --- | --- | --- |
| s01-anniversary-venue-closed | 10 | 4 / 6 / 0 | 0 of 3 | 0 / 0 | yes | 67% |
| s00-jazz-needs-a-choice | 5 | 1 / 4 / 0 | 0 of 3 | 0 / 0 | yes | 100% |
| s02-vegan-date-budget | 10 | 6 / 4 / 0 | 2 of 3 | 0 / 0 | no | 67% |
| s03-rain-birthday-bar | 6 | 2 / 4 / 0 | 1 of 3 | 0 / 0 | yes | 100% |
| s04-late-arrival-live-music | 5 | 3 / 2 / 0 | 1 of 3 | 0 / 0 | yes | 100% |
| s05-family-lunch-halal | 10 | 8 / 2 / 0 | 1 of 3 | 0 / 0 | no | 100% |
| s06-quiet-cafe-gluten-free | 5 | 4 / 1 / 0 | 2 of 3 | 0 / 0 | no | 100% |
| s07-dessert-after-the-show | 3 | 2 / 1 / 0 | 1 of 2 | 0 / 0 | no | 100% |
| s08-gallery-afternoon | 3 | 2 / 1 / 0 | 1 of 2 | 0 / 0 | no | 100% |
| s09-celebration-budget-cut | 10 | 5 / 5 / 0 | 1 of 3 | 0 / 0 | yes | 67% |
| s10-no-feasible-option | 10 | 10 / 0 / 0 | 3 of 3 | 0 / 0 | no | not available |
| s11-outdoor-gig-rain | 5 | 2 / 3 / 0 | 1 of 3 | 0 / 0 | yes | 100% |
| s12-tasting-menu-no-stairs | 10 | 1 / 9 / 0 | 0 of 3 | 0 / 0 | yes | 67% |
| s13-late-bar-record-fans | 6 | 5 / 1 / 0 | 2 of 3 | 0 / 0 | no | 100% |
| s14-party-grows-to-fourteen | 10 | 1 / 9 / 0 | 0 of 3 | 0 / 0 | yes | 100% |
| s15-nut-allergy-brunch | 5 | 4 / 1 / 0 | 2 of 3 | 0 / 0 | no | 100% |
| s16-original-not-located | 10 | 0 / 0 / 10 | 0 of 3 | 0 / 0 | yes | 100% |

## Method

- Each scenario opens a case, records one disruption and runs one search.
- Both arms use the identical candidate pool, the identical feasibility gate and the identical exclusions. Only the ordering rule differs.
- Taste Off orders by distance to the original venue, then price level, then name. It uses no taste data.
- Popular orders by the provider general popularity, most popular first, with distance and price as tie breakers. It uses none of the group signals.
- Taste On orders by the app recovery score, which combines the provider affinity with closeness. Affinity is reported separately.
- The ungated list is the top three places by provider rank with no feasibility gate. It stands for a plain recommender.
- Violations are judged by a separately written statement of the constraint rules that reads raw venue facts. It shares the distance, time and name helpers with the gate.

## Limits

- The catalogue, the venues and the affinity are invented and hand authored for this project.
- These results show how the pipeline behaves. They do not measure how well Qloo predicts what real people enjoy.
- The mean affinity difference is not independent evidence of better taste, because the simulated affinity defines taste in this catalogue.
- How often an ungated list breaks a constraint depends on how the catalogue and scenarios were authored. It must not be read as a rate in the real world.
- No people were involved in this evaluation.
