# Preregistration of the baseline comparison on held out scenarios

This document was written and committed before any of the 20 test scenarios was ranked. The commit that adds it also freezes `evaluation/test-scenarios.json` by hash, and a test fails if the file changes. The results are written by `npm run eval:baselines -- --run test` to `results/baselines-test.json` and rendered into [EVALUATION_BASELINES_TEST.md](EVALUATION_BASELINES_TEST.md). Nothing in the results is edited by hand.

Date of registration: 28 October 2026. It follows [PREREGISTRATION.md](PREREGISTRATION.md), which covered the first 20 scenarios, and does not replace it.

## What is being asked

The first evaluation asked whether the pieces of the pipeline work on real Qloo data. It did not compare AFTERGLOW with simpler ways of choosing a replacement. This evaluation does. For each plan that has fallen through, every approach below picks a top three from the same pool of places that Qloo returned, and each list is judged by the same independent oracle.

1. **The gate.** Do plain recommenders that use no gate put a place in their top three that breaks a hard requirement, judged on facts that are known? Does AFTERGLOW avoid that?
2. **The Qloo signal.** Is the Qloo ranking used, and does it change the answer compared with nearest first and with general popularity?
3. **The blend.** Does blending taste with closeness change the top choice compared with Qloo affinity alone?
4. **Vibes.** Does sending a vibe to Qloo as example places give Qloo more to rank than sending it as a tag?
5. **Reliability.** Do the scenarios complete?

## What this cannot show

No person judged any list. The measures are requirement violations, distance, Qloo affinity and tag overlap. They show whether the parts of the method do what they are meant to do. They do not show that people would prefer the result, or that AFTERGLOW outperforms a language model with no Qloo data, which is not among the baselines here (see the last section).

The affinity lift is the quantity that AFTERGLOW and the taste only list rank by, so a positive lift shows that the Qloo signal is being used and is true in part by construction. B5, B8 and B9 are checks of that kind. The claims that carry weight are B1 to B4, which are about hard requirements, and B6, B7 and B14, which are about whether the answer changes.

## The world and who built it

The venues, the taste data and the practical facts are real Qloo responses on the day of the run. The scenarios are not. The team that built the method also chose the cities, the plans, the constraints and the taste signals, and chose them after the development results were known. Method and world therefore share authors. The scenarios were designed to differ from the development scenarios in city, category and kind of disruption, and not to favour or disfavour any approach.

The development scenarios are the 20 in `evaluation/live-scenarios.json`: New York, London, Paris, Tokyo and Dubai, with four plans each, all dinners. The product was developed against them and its decisions were made after reading their results. The test scenarios are the 20 in `evaluation/test-scenarios.json`: Chicago, Los Angeles, Berlin, Sydney and Toronto, with four plans in each. None of the five cities appears in the development set. The plan dates are 3 to 7 November 2026 in the local time of each city. The SHA-256 of the test scenario file at registration is:

```
8613305fe1a3d95d0274210c0c29ab808ba0531b1a8065862ce49c3b99c08418
```

The four test plans are the same in every city:

| Plan                  | Day and time              | Party     | Category         | Requirements                                                     | What changes                    | Original venue as a signal |
| --------------------- | ------------------------- | --------- | ---------------- | ---------------------------------------------------------------- | ------------------------------- | -------------------------- |
| rain, birthday bar    | Saturday 7 November 20:30 | 6         | bar              | covered, open at plan time, fits the party, within 5 km          | rain                            | yes                        |
| quiet cafe, late      | Tuesday 3 November 15:00  | 2         | cafe             | step free, open at plan time, price level 2 or less, within 3 km | one person runs 40 minutes late | yes                        |
| family, halal, budget | Thursday 5 November 18:30 | 5         | restaurant       | halal, open at plan time, price level 3 or less, within 8 km     | the budget falls to level 2     | no                         |
| jazz, party grows     | Friday 6 November 21:00   | 4, then 7 | live music venue | fits the party, open at plan time, within 8 km                   | the party grows to seven        | yes                        |

## Baselines

Every approach ranks the same pool for the same plan. Each is built twice.

- **Gated.** Places that fail a requirement on a known fact are removed first, and the approach orders what remains. The gate lists places whose facts are all confirmed before places that need a check, whatever the approach.
- **Ungated.** Nothing is removed except the venue that fell through, which any sensible recommender would leave out. This stands for how a replacement is usually chosen today.

The approaches are:

- **Random.** A seeded random order. It is the simple baseline.
- **Nearest first.** Closest to the venue that fell through, with no taste data. It is the obvious competitor for a person looking for something nearby.
- **Popular.** Qloo's general popularity, with none of the group's signals. It is the obvious competitor for a list of well known places.
- **Taste only.** Qloo affinity alone, with no distance. It isolates what the blend with closeness adds to Qloo.
- **AFTERGLOW.** The gate, then the rescaled affinity blended with closeness. This is what the product shows.

The independent oracle is a separate implementation of the rules that reads the raw facts and does not share code with the gate. A place counts as breaking a requirement only when a known fact is against it. A fact that is unknown is never counted against a place, so every violation count is a lower bound. For nearest first, a plan whose venue Qloo does not locate has no distances, so that plan is left out of the nearest first arms and the comparisons that need them.

## Seeds and statistics

Qloo is not random, so the unit of replication is the scenario and there are 20 of them. The only random number generator is the bootstrap and the random baseline, with seed 20261028 and 10,000 resamples. Qloo's data can change from day to day. The test run is a single run on one day and will not be repeated.

- Means over scenarios use a 95 percent percentile bootstrap.
- Differences between approaches are taken within a scenario, and whole scenarios are resampled.
- Shares use the 95 percent Wilson score interval.
- A scenario that does not complete is counted in B13 and left out of the others. It is not replaced.
- A measure with nothing to measure is reported as not evaluated. It is neither a hit nor a miss.
- The verdict compares the observed value, not the interval, with the threshold. The interval is reported next to it.

## Where the thresholds come from

The product was developed on the development scenarios, which were ranked against the same baselines on 28 October 2026 (see [EVALUATION_BASELINES_DEV.md](EVALUATION_BASELINES_DEV.md)). Each threshold below is set by one rule, fixed before any test scenario was ranked: for a prediction of at least, the lower end of the development 95 percent interval rounded down to the next 0.05, and for a prediction of at most, the upper end rounded up to the next 0.05. B1 and B13 are the exceptions and are explained below. A test checks the thresholds in the code against this rule.

The predictions therefore ask whether the development findings hold in cities and plans that the product was not built around. They are a replication bar, not a claim that the product is good. A hit means the finding held. A miss means that it did not, and a miss will be reported and explained, not excused.

## Predictions

| Id  | Group       | Measure                                                                                                                       | Predicted      |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------- |
| B1  | The gate    | Places breaking a requirement, judged by the independent oracle, in any AFTERGLOW top three                                   | exactly 0      |
| B2  | The gate    | Share of scenarios where the top three of the nearest first list without the gate holds a place that breaks a requirement     | at least 0.45  |
| B3  | The gate    | Share of scenarios where the top three of the popular list without the gate holds a place that breaks a requirement           | at least 0.50  |
| B4  | The gate    | Share of scenarios where the top three of the taste only list without the gate holds a place that breaks a requirement        | at least 0.65  |
| B5  | Qloo signal | Share of the pool that Qloo scored, mean over scenarios                                                                       | at least 0.95  |
| B6  | Qloo signal | Share of scenarios where the AFTERGLOW top choice differs from the nearest first top choice                                   | at least 0.40  |
| B7  | Qloo signal | Share of scenarios where the AFTERGLOW top choice differs from the popular top choice                                         | at least 0.35  |
| B8  | Qloo signal | Affinity lift of the AFTERGLOW top three minus the nearest first top three, in standard deviations of the pool                | at least 0.50  |
| B9  | Qloo signal | Affinity lift of the AFTERGLOW top three minus the taste only top three, in standard deviations of the pool                   | at least -0.05 |
| B10 | Qloo signal | Share of the AFTERGLOW top three that carries a requested vibe, minus the same for the nearest first top three                | at least -0.05 |
| B11 | Qloo signal | Share of the pool that Qloo scored with vibes sent as example places, minus the same with vibes sent as tags                  | at least 0.10  |
| B12 | Closeness   | Share of scenarios where the AFTERGLOW top three is no further from the venue that fell through than the taste only top three | at least 0.80  |
| B13 | Reliability | Scenarios that complete without an error                                                                                      | at least 18    |
| B14 | Qloo signal | Share of scenarios where the AFTERGLOW top choice differs from the taste only top choice                                      | at most 0.20   |

The reasoning behind the numbers, so that a miss can be read against it:

- B1 is a correctness claim. The oracle is a separate implementation of the rules. Any violation in an AFTERGLOW list is a bug in the gate and not a finding. It is not set by the rule above.
- B2 to B4 expect that a city wide pool contains many places that are closed on the plan day, too far away, too expensive or unable to take the party, so a plain list will often include one. On the development scenarios the shares were 0.72, 0.75 and 0.90.
- B5 expects that Qloo scores almost every place when vibes are sent as example places. On the development scenarios it scored 0.99 of the pool. Vibes sent as tags scored 0.70.
- B6 and B7 are weak claims. Any two different ordering rules will often choose different first places. They are reported because they are the comparison the product shows, and they are not offered as evidence of quality.
- B8 and B9 check that the Qloo signal is the thing the ranking follows. B9 is close to zero on the development scenarios (-0.01) because the blend with closeness changes little. It expresses that AFTERGLOW gives up almost nothing in affinity against Qloo alone.
- B10 is a neutral prediction. On the development scenarios no approach put a requested vibe in the top three much more often than random did, and the difference from nearest first was 0.04 with an interval that includes zero. A hit here is a statement that AFTERGLOW is no worse, not that it is better.
- B11 expects that sending vibes as example places gives Qloo more to rank. On the development scenarios the difference was 0.29.
- B12 expects that the blend does not move the list further away than taste alone. On the development scenarios the AFTERGLOW top three was no further in all 18 scenarios with a distance, and on average 0.30 km closer.
- B13 is carried over from the first evaluation and not set by the rule above. All 20 development scenarios completed.
- B14 records the most important development finding about the ranking: the AFTERGLOW top choice was the taste only top choice in all 20 scenarios. The blend with closeness changes the lower places on the list and not the first. The product does not claim otherwise.

## What was done before registration, and what was not

- The development scenarios were ranked against the baselines twice on 28 October 2026. The first run showed that two Dubai plans have a venue that Qloo does not locate, so the gated nearest first list for them was in an arbitrary order. The code was changed so that places without a distance are left out of that list, and the development scenarios were ranked again. Both runs completed 20 of 20 scenarios. The second run is the one recorded.
- Before that, in the development of the product, the following changes were made while looking at the development scenarios: the vibes of a plan are sent to Qloo as up to three example places each, found with `/v2/insights` and `filter.tags` and left out when they belong to the pool being ranked, with tags as a fallback, because vibe tags sent alone gave every place the same score in the first live evaluation; the affinity is rescaled across the places that pass the gate, because the affinities within one pool differ by little; and the category phrases for live music and dessert were changed to ones that resolve to a single place genre on Qloo. A read only experiment compared the forms of signal on the development scenarios and is described in [QLOO_INTEGRATION.md](QLOO_INTEGRATION.md). None of these changes used a test scenario.
- The test scenarios were written after the development results were known. Their inputs were checked for resolvability with `npm run eval -- --preflight evaluation/test-scenarios.json`, which resolves every taste name, tag, category and original venue and ranks nothing. The first preflight found eleven original venues that Qloo lists more than once or not at all, and they were replaced by other well known venues in the same city. A second preflight found five of the replacements to be listed more than once, and they were replaced again. A third found that one venue in Toronto, Bellwoods Brewery, is listed twice, so that scenario names the Qloo entity for the Ossington brewhouse by its identifier. Preflights were repeated after each change until one resolved all 85 inputs of the 20 scenarios. The scenario file was changed only to resolve these inputs. No ranking output, fact coverage or gate result was looked at.
- A category check sent a category tag to Qloo for Chicago, Berlin and Dubai and counted the places that came back. It looked at no ranking and no scenario, and it led to the change of the two category phrases above.
- No test scenario has been ranked, and no prediction has been checked against a test scenario, before this document was committed.

## Amendments

Any change to the design after seeing results will be added here as a dated amendment that keeps the original text. There were none at the time of registration.

### Amendment 1, 28 October 2026, written after the test run

This amendment changes no prediction, threshold, scenario, seed or metric. It corrects one description and discloses three facts that the section above leaves out. The text above is unchanged.

1. **The oracle is not independent in the full sense.** The text above calls the oracle independent and says it shares no code with the gate. That is too strong. `src/evaluation/oracle.ts` states the rules separately and reads the raw facts, but it uses the same three helper functions as the gate for distance, local time and name matching (`distanceKm`, `localMinuteOfDay`, `normaliseName`). The word independent in the description of the oracle and in the claim of B1 should be read as "a separately written statement of the rules over the same helpers". Because it reads the same facts as the gate, the oracle can find a disagreement in the rules but cannot find a fact that is wrong. A test now compares the oracle with the gate on generated facts, and the helpers are checked against known distances and times.
2. **A language model probe was run before registration.** On 28 October 2026 a workflow that asked a hosted model service to name two restaurants in Dubai was added, edited twice and later removed (commits aee130e, c407036, 277b972, removed in 9f523e3). Its purpose was to find out whether a language model baseline could be run from the Actions runner without a paid key. It used no scenario, no Qloo output and no ranking, and it informed no threshold. No usable answer came back, and no language model baseline was added.
3. **Two thresholds were changed in the registration commit.** Before commit 8a67152 the code had B4 at 0.70 and B11 at 0.15. The registration commit changed them to 0.65 and 0.10, because applying the stated rule to the unrounded development bounds gave those values. This happened before any test scenario was ranked.
4. **What ran when.** The test run is the workflow run [40707580529](https://github.com/hudasol/afterglow/actions/runs/40707580529). It ran on commit 8a67152, the registration commit, and was started at 14:36:17 UTC, eight seconds after that commit was made at 14:36:09 UTC. It finished at 14:38:05 UTC. Results files made from now on record the commit and the run that produced them. The results files already recorded do not, and are not edited. The registration commits are 498f4cf for the first evaluation and 8a67152 for this one.

## A language model without Qloo data

A language model with no taste data is not part of this registration, so the claim that AFTERGLOW outperforms a language model alone is untested here. If one is added it will be through a dated amendment that comes first and names the model, the prompts, the arms and the predictions before any list is generated. The lists would be judged by the same oracle, with two arms: one given only the plan, and one given the plan and the practical facts that Qloo states for each place but no taste data. If no such amendment is committed before the test run, the test run is reported without it and says so.

## Commands

```sh
npm run eval -- --preflight evaluation/test-scenarios.json   # resolves the inputs and ranks nothing
npm run eval:baselines -- --run test                         # the evaluation: writes results/baselines-test.json and the report
npm run eval:baselines -- --render test                      # rewrites the report from the results file
```

The run needs `QLOO_API_KEY`. The same steps can be run from the **Live evaluation** workflow in the Actions tab, whose `baselines-test` mode reads the key from the repository secret of the same name.
