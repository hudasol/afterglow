# 0003. Send each vibe to Qloo as example places

Status: accepted, 28 October 2026.

## Context

A plan can ask for a vibe such as quiet or lively. The first version sent it to Qloo as a tag signal. In the first live evaluation Qloo then gave every place the same affinity in all five scenarios that sent only tags, so taste could not change the order. Names the group likes worked, but not every plan has them.

## Decision

Each vibe is sent as up to three example places that carry it, found with `/v2/insights` and `filter.tags` and left out when they belong to the pool being ranked, together with the names the group likes. If Qloo cannot answer that request the provider falls back to the tag ladder and says so beside the shortlist. The Evidence tab lists the places that stood in for each vibe.

## Evidence

On the 20 development scenarios, ranked a second time with tags for comparison, example places let Qloo score 0.99 of the pool where tags scored 0.70, and the spread of affinity across the pool was 0.13 against 0.06. See [EVALUATION_BASELINES_DEV.md](../EVALUATION_BASELINES_DEV.md). The held out test scenarios repeat the comparison as prediction B11 in [PREREGISTRATION_V2.md](../PREREGISTRATION_V2.md).

## Consequences

- Taste can change the order when a plan sends only vibes.
- The example places are chosen by Qloo and are usually in other cities. That is a reading of what the vibe means in Qloo's graph, not the group's choice, and the interface shows it.
- Whether the resulting order is better for a group is not established. No person judged any list.
