# Notes on the live evaluation

This file is written by hand. The numbers are in [EVALUATION_LIVE.md](EVALUATION_LIVE.md), which is generated from `results/live-qloo.json`, and the predictions are in [PREREGISTRATION.md](PREREGISTRATION.md). Nothing here changes a number, a threshold or a verdict. The misses are kept as they were.

## The first run

The first run took place on 25 October 2026 from GitHub Actions, on the commit that holds the preregistration. All 20 scenarios completed. Nine predictions were met and three were missed.

| Id  | Predicted                                          | Observed | Verdict |
| --- | -------------------------------------------------- | -------- | ------- |
| P4  | overlap at most 0.50                               | 0.75     | MISS    |
| P5  | top choice changes in at least 0.60                | 0.42     | MISS    |
| P9  | top choice differs from Taste Off in at least 0.70 | 0.35     | MISS    |

The nine met predictions were P1 to P3 (Qloo states hours for 70 percent of a pool, step free access for 74 percent and a dietary fact for 63 percent where one is needed), P6 (an ungated top three held a place that breaks a requirement in 17 of 20 scenarios), P7 (no gated top three held one), P8, P10, P11 and P12.

## Two defects that the first run exposed

Before explaining the misses, the scenario level results showed that two defects in the product, not in the method of measurement, had changed what was measured. They were found by reading the scenario rows and then by two read only tools added afterwards, `diagnose` and `timing` in the **Live evaluation** workflow. Neither tool writes results.

**The original venue was taken from the wrong country.** The name search is not limited to a city, and when it returned a single entry with the right name, that entry was used without checking where it was. In Dubai, "Zuma" resolved to a lounge in Arizona, "Al Fanar Restaurant" to a restaurant in Bahrain and "Arabian Tea House" to a place in Iran. Distances were then measured from those positions, every place in the pool was more than 200 km away, and the gate ruled out all 40 places in three of the four Dubai scenarios. It also used the foreign entry as a taste signal. The gate did what it was built to do with the position it was given; the position was wrong.

**Qloo is slow with many tag signals.** For three scenarios the taste ranking was unavailable because the request timed out three times at 15 seconds. The same request with the same pool took between 0.2 and 13 seconds with up to four tag signals and 30 to 60 seconds with five or more. The cause was a design choice of ours: a phrase such as "live music" matches five Qloo tags with the same name, and all five were sent. The measurements are in the log of the timing runs, summarised here.

| Scenario                     | Tag signals sent | Time for one ranking request |
| ---------------------------- | ---------------- | ---------------------------- |
| New York, vegetarian friends | 1 to 4           | 0.65 seconds each            |
| New York, vegetarian friends | 5 to 8           | 32 to 44 seconds each        |
| New York, group of eight     | 1                | 0.18 seconds                 |
| New York, group of eight     | 2 to 4           | 13 seconds each              |
| New York, group of eight     | 5                | 58 seconds                   |

These two defects affected eight of the 20 scenarios: the three that had no taste ranking, the three Dubai scenarios with no eligible place, and two anniversary scenarios (New York and London) whose swapped signals borrowed the tags of a plan whose ranking timed out. They are the reason that P4 and P5 rest on 12 scenarios and not 20.

## The three misses

**P4 and P5, signal specificity.** In the 12 scenarios where both rankings exist, the top three was identical or nearly identical for own signals and swapped signals in most cases: overlap values were 1.00 in seven scenarios, 0.67 in three and 0.00 in two. The top choice changed in five of 12. The prediction expected the signals to matter more than that.

What the data supports: Qloo ranks the same pool differently for different signals when the pool is the whole city (the smoke test gave an overlap of 0 percent for two probes), but after the gate the pool for a scenario is small, often 10 to 25 eligible places, and the top three of a small pool overlaps by chance more than the top three of 40. The recovery score also gives a quarter of its weight to closeness, which is the same under both sets of signals. Both effects work against a large change. What the data does not support is a statement of how much each contributes, because the evaluation did not separate them. It also does not support the claim that the signals do not matter: in five of 12 scenarios the best choice changed.

**P9, Taste On against Taste Off.** The Taste On top choice differed from the nearest place in six of 17 comparable scenarios. Three of those 17 were the Dubai scenarios with no eligible place, where an empty list cannot differ from an empty list. Without them it is six of 14, which is still below the prediction. The prediction was labelled the weakest in the preregistration and it missed. The recovery score is 0.75 times Qloo affinity plus 0.25 times closeness, closeness runs from 0 to 1 over 10 km, and affinity is used as Qloo returns it. When affinity values lie close together, differences in distance decide the order. Whether they do lie close together in these pools was not recorded in the first run, so this was an explanation that fit the result and not a finding. The section on the second run records the spread.

For comparison, the Taste On top choice differed from the Popular ordering in 10 of 14 comparable scenarios, which is the comparison that stands for a plain list of well known places.

## What the hits do and do not show

P7 was met with no violations in any gated top three. The independent oracle takes the position of the original venue from the pool by exact name. That works when the original venue is itself one of the places returned, which it often is for well known restaurants, and it cannot check the distance requirement when it is not. The count is therefore a lower bound for distance. For opening hours, price and step free access the oracle reads the raw facts directly.

P8 was met at 0.71. The four group dinner scenarios that had a ranked list could not reach it by design, because Qloo does not state group capacity, so a table for eight is always a question for the person.

P12 reports a median of two requests per scenario. The 48 requests in total are low because answers are cached inside one run: a city, a category or a phrase is asked of Qloo once. A cold start for one new visitor costs more.

## The second run

The two defects were fixed in the product and the same 20 scenarios were run again on 25 October 2026, with the same predictions, thresholds, oracle and seed. The first run is the registered result. The second run is not independent of it, because the fixes were chosen after seeing which scenarios failed. The dated amendment in the preregistration says so. The numbers are in [EVALUATION_LIVE_SECOND_RUN.md](EVALUATION_LIVE_SECOND_RUN.md), which is generated from `results/live-qloo-second-run.json`.

All 20 scenarios completed. Nine predictions were met and the same three were missed.

| Id  | Predicted     | First run | Second run | Verdict in both |
| --- | ------------- | --------- | ---------- | --------------- |
| P4  | at most 0.50  | 0.75      | 0.70       | MISS            |
| P5  | at least 0.60 | 0.42      | 0.45       | MISS            |
| P9  | at least 0.70 | 0.35      | 0.40       | MISS            |
| P6  | at least 0.60 | 0.85      | 1.00       | HIT             |
| P8  | at least 0.50 | 0.71      | 0.70       | HIT             |
| P10 | at least 0.50 | 0.71      | 0.75       | HIT             |

P1 to P3, P7, P11 and P12 did not change.

**What the fixes changed.** Eight of the 20 scenarios came out differently. Three had no taste ranking in the first run and now have one (New York, London and Dubai, Saturday vegetarian plans). Two anniversary plans (New York and London) now have a swapped signals run. In Dubai the gate no longer rules out all 40 places, and the three Dubai plans that had no eligible place now have between 10 and 33 eligible places, three of them fully verified in the anniversary plan. The four Dubai original venues came out in three different ways. Pierchic resolved to a place in Dubai. For Zuma, the entry Qloo holds under that name is in Arizona, so the product used the place called Zuma Dubai that Qloo returned in the results, and said so. For Al Fanar Restaurant and Arabian Tea House, the only entry Qloo holds is in Bahrain and in Iran, so the product did not use it as a taste signal or to measure distance, said so, and treated the distance to the original venue as unknown. Those two plans therefore list their places as needing a check and do not claim that any of them is near the venue. The other 12 scenarios are identical to the first run in every recorded field, including the number of requests to Qloo. That is a small check that Qloo returned the same data on both runs, which were a few hours apart, for those plans. It is not a test of how stable Qloo is over longer periods.

**What the second run does not change.** The three misses remain, and the gap to the thresholds is large enough that the fixes were not what held them back. The Taste On top choice differs from the nearest place in 8 of 20 scenarios (prediction: 14 of 20). The best choice changes under swapped signals in 9 of 20 (prediction: 12 of 20). The mean overlap at three is 0.70 (prediction: at most 0.50). No change was made to the recovery score, its weights, the ordering rules, the scenarios or the predictions in order to move these numbers, and none will be.

## What a read only look at the pools found

After the second run the `diagnose` mode was run once more on the same code. It prints, for each scenario, how far apart Qloo's affinity values are across the pool, and it writes no evaluation results. The numbers are in [data/evaluation/affinity-spread-2026-10-25.json](../data/evaluation/affinity-spread-2026-10-25.json). Three patterns appear, and they depend on the kind of signal the plan sends.

| Signals sent                     | Scenarios | Places scored out of 40 | Spread of affinity (largest minus smallest)      |
| -------------------------------- | --------- | ----------------------- | ------------------------------------------------ |
| Names only (plan c)              | 5         | 40 in each              | 0.10 to 0.16                                     |
| Names and vibe tags (plans a, b) | 10        | 1 to 32                 | 0.00 to 0.13, and under 0.07 in eight of the ten |
| Vibe tags only (plan d)          | 5         | 40 in each              | 0.00, the same value for every place in all five |

In the five scenarios that send vibe tags only, Qloo returned an identical affinity of 0.7649962877984056 for every one of the 40 places, in five different cities and for three different sets of tags. The value is not produced by the product, which reads affinity as Qloo returns it. We do not know why Qloo does this. A reasonable reading is that a vibe tag on its own does not give Qloo a way to tell places apart, but that is a reading and not something we established. In those scenarios the Taste On order is the order of distance, so Taste On and Taste Off can differ only where two places lie almost the same distance away. When names are sent together with tags, Qloo returned a score for only part of the pool (one place in Paris, for example), and AFTERGLOW lists the places that Qloo did not score after those it did. Names alone gave a score for every place and a spread large enough to matter, since closeness is a quarter of the score and a spread of 0.13 in affinity is worth about 0.10 of the composite.

This changes how the three misses should be read, and it replaces the explanation given for the first run.

- **P9** missed in part because of the data that some plans got back. In the five plans that send vibe tags only, Qloo's scores cannot separate the places, so the Taste On order is the order of distance. Without those five, the Taste On top choice differs from the nearest place in 7 of 15 scenarios, which is 0.47 and still below 0.70. The prediction would have been missed without them as well, by a smaller margin. Among the five plans that send names only, where Qloo gives a real spread, the top choice differs in three of five.
- **P4 and P5** compare each plan with the signals of another plan in the same city. When one side of that comparison is a tag only plan, the swapped run differs from the own run because of how many places Qloo scored and not because of what the signals mean. For the five tag only plans the swapped top choice changed in four of five and the mean overlap was 0.33, which says almost nothing about specificity. For the other 15 plans the overlap was 0.82 and the top choice changed in 5 of 15. The method of comparison did not anticipate this. It is not changed after the fact, and the registered result stands.

**One change to the product followed from this.** The interface now says so when Qloo scored only part of the pool or gave every place the same taste score, in a plain note beside the shortlist, in the Evidence tab and in the agent trace. It does not change any score, weight or order. Without it, a person looking at a shortlist labelled as taste ranked could not tell that distance had decided it.

## What would be done with more time

These are not done and are not claimed.

- Ask Qloo whether vibe tags alone are expected to give every place the same affinity, and whether a tag signal in the same request as a name is meant to limit the places that come back.
- Add a preregistered comparison of Taste On against Taste Off that only uses plans where Qloo gave a spread, written before it is run, and run it on new scenarios. Changing P9 now would be tuning on the evaluation.
- Check the opening hours, step free access and dietary facts that Qloo states against the venues themselves for a small sample. Nothing in this repository measures how often those statements are right.
