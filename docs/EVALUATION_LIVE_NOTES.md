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

**P9, Taste On against Taste Off.** The Taste On top choice differed from the nearest place in six of 17 comparable scenarios. Three of those 17 were the Dubai scenarios with no eligible place, where an empty list cannot differ from an empty list. Without them it is six of 14, which is still below the prediction. The prediction was labelled the weakest in the preregistration and it missed. The recovery score is 0.75 times Qloo affinity plus 0.25 times closeness, closeness runs from 0 to 1 over 10 km, and affinity is used as Qloo returns it. When affinity values lie close together, differences in distance decide the order. Whether they do lie close together in these pools was not recorded in the first run, so this is an explanation that fits the result and not a finding.

For comparison, the Taste On top choice differed from the Popular ordering in 10 of 14 comparable scenarios, which is the comparison that stands for a plain list of well known places.

## What the hits do and do not show

P7 was met with no violations in any gated top three. The independent oracle takes the position of the original venue from the pool by exact name. That works when the original venue is itself one of the places returned, which it often is for well known restaurants, and it cannot check the distance requirement when it is not. The count is therefore a lower bound for distance. For opening hours, price and step free access the oracle reads the raw facts directly.

P8 was met at 0.71. The four group dinner scenarios that had a ranked list could not reach it by design, because Qloo does not state group capacity, so a table for eight is always a question for the person.

P12 reports a median of two requests per scenario. The 48 requests in total are low because answers are cached inside one run: a city, a category or a phrase is asked of Qloo once. A cold start for one new visitor costs more.

## What came next

The two defects were fixed in the product and the same scenarios were run a second time with the same predictions. The first run is the registered result. The second run is not independent of it, because the fixes were chosen after seeing which scenarios failed. Both are reported, and the design change is recorded as a dated amendment in the preregistration.
