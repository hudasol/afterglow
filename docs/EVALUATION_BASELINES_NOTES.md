# What the held out comparison showed

These notes explain [EVALUATION_BASELINES_TEST.md](EVALUATION_BASELINES_TEST.md), which is generated from `results/baselines-test.json`. The run was made once on 28 October 2026 on the 20 scenarios registered in [PREREGISTRATION_V2.md](PREREGISTRATION_V2.md). Every figure below is computed from the results file, and a test fails if a figure here stops matching it. Nothing was changed after the run.

## The result

All 20 scenarios completed. Thirteen of the 14 predictions were met and one was missed. The miss is B14.

## The miss: B14

B14 predicted that the AFTERGLOW top choice would differ from the taste only top choice in at most 0.20 of scenarios. It differed in 6 of 19 scenarios, 0.32 (0.15 to 0.54).

On the development scenarios the two top choices were the same in all 20, and the prediction was written from that. The development scenarios were all dinners, and they were too few and too alike to show how often the blend with closeness would change the first place.

In all six scenarios where the choices differ, the taste only top choice lies between 2.2 and 3.9 km further from the venue that fell through than the AFTERGLOW top choice, and its raw Qloo affinity is higher by at most 0.011. Within one pool the affinities lie close together, so a near tie in taste is common, and then closeness decides. That is how the recovery score is designed to behave, and it is why the blend moved the top choice more often here than on the development scenarios. It is not a defect, but the prediction was wrong, and the claim that AFTERGLOW and Qloo alone choose the same first place does not hold on this evidence. What does hold is that the cost in affinity is small: the lift of the AFTERGLOW top three is 0.03 standard deviations below the taste only top three (B9, met), and its top three is on average 0.43 km closer.

## What the numbers support

- **The gate removes real conflicts.** Judged by an independent oracle on facts that are known, 36 of the 60 places in the taste only lists without the gate break a requirement, 35 in the popular lists and 19 in the nearest first lists. At least one place breaks a requirement in the top three in 18 of 20 scenarios for taste only, 20 of 20 for popular and 10 of 20 for nearest first. In the 19 scenarios where the gate left a place, AFTERGLOW offered none that breaks a requirement. The reasons are mostly that a place is closed at the planned time (22 of the 60 taste only listings) or too far away (23). These are lower bounds, because an unknown fact is never counted against a place.
- **The Qloo signal changes the answer.** The AFTERGLOW top choice differs from the nearest first top choice in 14 of 19 scenarios and from the popular top choice in 15 of 19, and the lift in Qloo affinity over nearest first is 0.74 standard deviations (0.51 to 0.97). The affinity is what AFTERGLOW ranks by, so this shows that the signal is used. It does not show that people prefer the result.
- **Vibes as example places give Qloo more to rank.** Qloo scored 0.98 of the pool with example places and 0.85 with tags, a difference of 0.13 (0.03 to 0.25), and the spread of affinity across the pool was 0.11 against 0.07.

## What the numbers do not support

- **No evidence that taste ranking surfaces the requested vibe.** The share of the top three that carries a tag the person asked for is 0.11 for AFTERGLOW and 0.08 for nearest first, a difference of 0.04 (0.00 to 0.09), and 0.11 for taste only. B10 was met, but it only asks that AFTERGLOW be no worse. A person who asked for a lively bar should not read this as evidence that the ranking finds one.
- **Most offered places still need the person's check.** In 11 of the 19 scenarios with a gated list, none of the three places is fully verified, and the mean is 1.05 verified places of three. This is a limit of the data Qloo states, not of the gate: opening hours, step free access and dietary options are stated for only part of the places, and group capacity and covered seating are never stated. The development scenarios were less affected (6 of 20 lists with no verified place). The OpenStreetMap lookup could fill some gaps, but it has not run successfully against real data.
- **A wide city pool can leave nothing.** In `la-quiet-cafe-late` all 40 places failed at least one requirement on a known fact, so there was no gated list for any approach. The pool comes from a search over the whole city, and Los Angeles is large against a 3 km limit. The product then offers the smallest sets of requirements the person could give up, but a search limited to the neighbourhood of the venue would be expected to return candidates here. That was not tested, and it is the most useful change that this evidence points to.
- **The conflicts depend on the plans.** Without the gate, nearest first broke a requirement in 0.50 of scenarios (0.30 to 0.70), against 0.72 on the development scenarios, and popular in 1.00 against 0.75. The scenarios are our own and the pools differ by city, so the size of each rate is not a rate in the world.
- **No person judged any list.** Nothing here says that a group would enjoy a place more because AFTERGLOW offered it.
- **No language model baseline.** The comparison with a language model that has no taste data was not run, so it is not known whether AFTERGLOW outperforms one.

## What changes as a result

- The README, the limitations and the submission text state the miss and these limits next to the results.
- B14 is not rewritten. A later comparison would register a new prediction that the blend changes the top choice in about a third of scenarios.
- A search limited to the neighbourhood of the original venue, and a better source of opening hours and access, are the next improvements that the data supports. They were not made before submission, so that the shipped product is the one that was evaluated.
