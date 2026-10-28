# 0005. Compare against simple baselines on scenarios fixed in advance

Status: accepted, 28 October 2026.

## Context

The first live evaluation asked whether the parts of the pipeline work on real Qloo data. It did not compare the product with simpler ways of choosing a replacement, and its 20 scenarios were then used to develop the product, so they could not serve as unseen evidence.

## Decision

Compare AFTERGLOW with random, nearest first, popular and taste only lists, each with and without the gate, built from the same pool and judged by the same independent oracle. Use the existing 20 scenarios as the development set and 20 new ones in five other cities as the test set. Register the questions, the statistics and numeric predictions before the test set is ranked, set every threshold by one rule from the development results, freeze the test scenario file by hash, and rank it once. Report misses.

## Consequences

- The result says how the pipeline behaves on plans it was not built around, with the limits stated in the report: the same team chose the scenarios, and no person judged any list.
- A language model with no taste data is not among the baselines. Adding it needs a model endpoint and a dated amendment written before its lists exist.
- The measures that depend on Qloo affinity are partly true by construction. The report says which predictions are of that kind.
