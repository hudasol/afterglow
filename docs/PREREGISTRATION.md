# Preregistration of the live evaluation

This document was written and committed before the live evaluation was run. The commit that adds it also freezes `evaluation/live-scenarios.json`. The results are written by `npm run eval:live` to `results/live-qloo.json` and rendered into [EVALUATION_LIVE.md](EVALUATION_LIVE.md). Nothing in the results is edited by hand.

Date of registration: 25 October 2026.

## What is being asked

AFTERGLOW recovers a plan that has fallen through. It asks Qloo for places, reads practical facts from Qloo, rejects any place that breaks a hard requirement, and orders what remains with Qloo taste data. The Devpost brief says that a submission which would work the same without Qloo is building the wrong thing. This evaluation asks five narrow questions about that, on real Qloo data.

1. **E1 Practical facts from Qloo.** Does Qloo state enough about opening hours, step free access and dietary options for the gate to use?
2. **E2 Signal specificity.** Does the ranking respond to the person's own taste signals, or would any signals give the same list?
3. **E3 The gate.** Does the gate keep places that break a requirement out of the lists, where an ungated list would show them, and does it still leave something usable?
4. **E4 Orderings.** Does Taste On choose differently from the two obvious alternatives, Taste Off and Popular?
5. **E5 Reliability and cost.** Do the scenarios complete, and how many requests do they cost?

## The world and who built it

The venues, the taste data and the practical facts are real Qloo responses on the day of the run. The scenarios are not: the team that built the method also chose the cities, the plans, the constraints and the taste signals. Method and world therefore share authors. The scenario file is frozen by this commit so that it cannot be adjusted to the results.

There are 20 scenarios: five cities (New York, London, Paris, Tokyo, Dubai) and four plans in each.

| Plan                  | Day and time    | Party | Requirements                                                     | Original venue as a signal |
| --------------------- | --------------- | ----- | ---------------------------------------------------------------- | -------------------------- |
| a, anniversary        | Friday 20:00    | 2     | step free, open at plan time, price level 3 or less, within 6 km | yes                        |
| b, vegetarian friends | Saturday 19:30  | 4     | vegetarian, open at plan time, within 8 km                       | yes                        |
| c, budget dinner      | Monday 19:00    | 3     | open at plan time, price level 2 or less, within 8 km            | no                         |
| d, group of eight     | Wednesday 19:30 | 8     | fits the party, open at plan time, within 10 km                  | no                         |

Every scenario is a dinner at a restaurant whose booking falls through. The plan dates are 2 to 7 November 2026 in the local time of each city.

## Baselines

- **Ungated list.** The three places Qloo ranks highest with no gate. It is the simple baseline and stands for a plain recommender.
- **Popular.** Gated places ordered by Qloo's general popularity. It is the obvious competitor: a list of well known places that uses none of the group's signals.
- **Taste Off.** Gated places ordered by distance to the original venue, then price, then name. It uses no taste data.
- **Swapped signals.** For E2 only: the same case run again with the taste entities and tags taken from another plan in the same city. Each plan names, in the scenario file, the plan of the same city whose signals it borrows. The plan, the requirements, the original venue and the pool are unchanged, so any difference comes from the signals.

## Seeds

Qloo is not random, so there are no seeds in the usual sense. The unit of replication is the scenario, and there are 20 of them. The only random number generator is the bootstrap for intervals, fixed at seed 20261025 with 10,000 resamples. Qloo's data can change from day to day, so a run on another day can differ. This run is a single run on one day. It was not repeated.

## Predictions

Each prediction was written before any scenario was ranked. A prediction is a threshold on the observed value. The 95 percent interval is reported next to each, and the verdict compares the observed value, not the interval, with the threshold.

| Id  | Experiment | Measure                                                                                 | Predicted     |
| --- | ---------- | --------------------------------------------------------------------------------------- | ------------- |
| P1  | E1         | Mean share of the pool with known opening hours                                         | at least 0.50 |
| P2  | E1         | Mean share of the pool with known step free access                                      | at least 0.60 |
| P3  | E1         | Mean share of the pool with a known dietary fact, in scenarios that need one            | at least 0.40 |
| P4  | E2         | Mean overlap at three of the Taste On top three, own signals against swapped signals    | at most 0.50  |
| P5  | E2         | Share of scenarios whose Taste On top choice changes when the signals are swapped       | at least 0.60 |
| P6  | E3         | Share of scenarios where the ungated top three holds a place that breaks a requirement  | at least 0.60 |
| P7  | E3         | Places breaking a requirement, judged by the independent oracle, in any gated top three | exactly 0     |
| P8  | E3         | Share of scenarios with at least one fully verified place in the Taste On top three     | at least 0.50 |
| P9  | E4         | Share of scenarios where the Taste On top choice differs from Taste Off                 | at least 0.70 |
| P10 | E4         | Share of scenarios where the Taste On top choice differs from Popular                   | at least 0.50 |
| P11 | E5         | Scenarios that complete without an error                                                | at least 18   |
| P12 | E5         | Median number of requests that reached Qloo per scenario, swapped signals run excluded  | at most 15    |

The reasoning behind the numbers, so that a miss can be read against it:

- P1 to P3 extrapolate from a smoke test on one city. On 25 October 2026 a New York restaurant pool of 40 places had readable opening hours for 26, step free access for 31 and vegetarian food for 25. Other cities may differ. These three predictions are therefore not blind.
- P4 and P5 come from the same smoke test, where two different signals gave a top three overlap of 0 percent and a rank correlation of 0.41. The original venue is a signal in plans a and b and is the same in both runs, which pushes the overlap up and makes the test harder to pass.
- P6 expects that a city wide pool contains many places beyond the distance limit or closed on the plan day, so a taste only list will often include one.
- P7 is a correctness claim. The oracle is a separate implementation of the rules that reads raw facts. Any violation is a bug.
- P8 is capped by design. Plan d requires a party size that Qloo never states, so no place in it can be fully verified. At most 15 of the 20 scenarios can pass.
- P9 and P10 are the weakest claims. Any two different ordering rules will often choose different first places. They are reported because they are the comparison the product shows, and they are not offered as evidence of quality.
- P12 counts only requests that reached Qloo, not answers served from the cache.

## Analysis

- Means over scenarios use a 95 percent percentile bootstrap. Shares use the 95 percent Wilson score interval.
- A scenario that does not complete is counted in P11 and left out of the others. It is not replaced.
- A measure with nothing to measure is reported as not evaluated. It is neither a hit nor a miss For P7 this includes the case in which no scenario completed, because a count of zero would then say nothing.
- No interval for a prediction about the future is claimed, so interval coverage is not reported.

## What was done before registration, and what was not

- Before registration the scenario inputs were checked for resolvability with `npm run eval:preflight`. That run resolves every taste name, tag, category and original venue in the scenarios and ranks nothing. No ranking output, fact coverage or gate result was looked at.
- The first preflight found 13 original venue names that Qloo lists more than once. They were replaced by other well known restaurants in the same city. The second preflight found four of those replacements to be listed more than once as well, and they were replaced again. Thirteen scenarios therefore have a different original venue from the one first committed, after 17 replacements in two rounds. The third preflight resolved every input.
- The first preflight also found that the phrase "lively" matched four differently named Qloo tags, so the five group plans now use the exact name "lively vibe". Tags that share an exact name across Qloo categories, such as "romantic", "cozy" and "rooftop", are now used together by the product instead of asking the person to choose between them. This was a change to the product made before registration, and it applies to every scenario equally.
- The method was developed against the smoke test in New York. New York is also one of the five cities here. The other four cities have not been seen.
- No scenario was ranked, and no prediction was checked, before this document was committed.

## Amendments

Any change to the design after seeing results will be added here as a dated amendment that keeps the original text. There are none at the time of registration.

### Amendment 1, 25 October 2026, written after the first run and before the second

The first run completed 20 of 20 scenarios and met nine of the twelve predictions. Its results are recorded in [EVALUATION_LIVE.md](EVALUATION_LIVE.md) and explained in [EVALUATION_LIVE_NOTES.md](EVALUATION_LIVE_NOTES.md). They stay as the registered result.

Reading the scenario rows showed two defects in the product that had changed what was measured. In three Dubai scenarios the original venue had been matched to a place of the same name in another country, so the gate ruled out every place. In three scenarios Qloo timed out when five or more tag signals were sent, so no taste ranking existed. Two read only tools, `diagnose` and `timing`, were added to the **Live evaluation** workflow to see why. They write no results.

Both defects were fixed in the product, and a related rule was added: a place in the results named after the original venue and its city, such as "Zuma Dubai" for "Zuma", is treated as the venue that fell through and is not offered back. The fixes are in the commits that follow the one that records the first run.

The same 20 scenarios will now be run a second time with the same twelve predictions, thresholds, statistics, oracle and seed. The sentence in the section on seeds that says the run was not repeated described the plan at registration and is superseded by this amendment. The second run is reported in `results/live-qloo-second-run.json` and [EVALUATION_LIVE_SECOND_RUN.md](EVALUATION_LIVE_SECOND_RUN.md), next to the first and never in its place.

The second run is not independent evidence. The fixes were chosen after seeing which scenarios failed, so the second run measures whether those failures are gone and not how the product behaves on plans it has never been shown. Nothing about the recovery score, the weights, the ordering rules, the scenarios or the predictions was changed.

## Commands

```sh
npm run eval:preflight   # resolves the inputs of every scenario and ranks nothing
npm run eval:live        # the evaluation: writes results/live-qloo.json and docs/EVALUATION_LIVE.md
npm run eval:render      # rewrites docs/EVALUATION_LIVE.md from results/live-qloo.json
```

Both live commands read the key from `QLOO_API_KEY`. The same two steps can be run from the **Live evaluation** workflow in the Actions tab, which reads the key from the repository secret of the same name.
