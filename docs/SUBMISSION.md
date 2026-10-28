# Submission: AFTERGLOW

**Save the experience, not just the plan.**

Team Kanban: Huda Mueen Qureshi, Awaiz Ahmed.
Source code: https://github.com/hudasol/afterglow (MIT License, shown in the repository About panel).

| Item                                   | Status                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public repository with visible license | Published, MIT                                                                                                                                                        |
| Hosted demo                            | https://afterglow-gsc4.onrender.com, with demo mode and live Qloo. The free plan sleeps when idle, so the first request can take about half a minute                  |
| Demo video                             | Not made. Screenshots are provided instead                                                                                                                            |
| Live Qloo verification                 | A smoke test (verdict go), a preregistered pipeline evaluation run twice, and a preregistered baseline comparison on 20 held out scenarios, on 25 and 28 October 2026 |

## 1. Product problem statement

When a plan falls apart, people are given a list of nearby places ranked by popularity. Some of those places cannot work at all: they are closed at the planned time, too expensive, too far, unable to seat the group, or unable to meet a dietary or access need. The ones that can work rarely feel like the evening that was planned, because the list knows nothing about why the plan mattered.

AFTERGLOW recovers the experience, not only the booking. The person describes the plan once. AFTERGLOW keeps what must survive, finds alternatives that fit the group's cultural taste using Qloo, rules out every place that breaks a hard requirement, and shows the evidence for each suggestion. It never books anything and it never assumes a fact it does not have.

## 2. Qloo workflow and why it fits

| Step                                            | Qloo endpoint                                    | Why                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match names the group likes, and the lost venue | `/search`                                        | Turns a public name into a Qloo entity so it can act as a taste signal. The venue that fell through is a signal too, so the search looks for places that share its audience |
| Match vibes, genres and the category            | `/v2/tags` with semantic search                  | Turns a phrase into a tag, scoped to places for the category                                                                                                                |
| Candidate places for a city                     | `/v2/insights` with a place type and city filter | Provides a pool of real places to evaluate                                                                                                                                  |
| Rank a fixed list by taste                      | `/v2/insights` with `filter.results.entities`    | Ranks the same pool the gate evaluated, so Taste On and Taste Off differ only in order                                                                                      |

Qloo fits because the product question is not which place is popular but which place carries the same cultural signal as the plan that was lost. Entities and tags express that signal, the venue that fell through is the strongest example of it, and ranking a fixed list lets the comparison with taste free orderings (nearest first and most popular first) be fair.

Qloo results are used as evidence inside a product flow. They never override a hard requirement: a place that fails a requirement is ruled out however well it matches taste. Full detail is in [QLOO_INTEGRATION.md](QLOO_INTEGRATION.md).

**Honest status.** The live Qloo path was run against the real API on 25 October 2026. A smoke test of 16 requests gave the verdict go ([report](../data/evaluation/smoke-2026-10-25.json)). A preregistered evaluation over 20 scenarios in five cities then met 9 of its 12 predictions and missed 3 ([registered result](EVALUATION_LIVE.md)). The first run exposed two defects in the product, which were fixed and recorded as a dated amendment, and a second run on the same scenarios gave the same 9 and 3 ([second run](EVALUATION_LIVE_SECOND_RUN.md), [notes on the misses](EVALUATION_LIVE_NOTES.md)).

On 28 October 2026 the product was compared with simpler ways of choosing a replacement: random, nearest first, popular and Qloo taste alone, each with and without the gate, judged by a separately written oracle. The questions, the statistics and 14 numeric predictions were registered before the 20 test scenarios in five other cities were ranked ([registration](PREREGISTRATION_V2.md)), and the test run was made once. All 20 scenarios completed, 13 predictions were met and 1 was missed ([results](EVALUATION_BASELINES_TEST.md), [notes](EVALUATION_BASELINES_NOTES.md)).

- Without the gate, the top three held a place that breaks a requirement in 18 of 20 scenarios for Qloo taste alone, 20 of 20 for popularity and 10 of 20 for nearest first. AFTERGLOW offered none in the 19 scenarios where it had a place to offer.
- The Qloo ranking changes the answer: the top choice differs from nearest first in 14 of 19 scenarios and from popularity in 15 of 19.
- The missed prediction (B14) was that blending closeness into the ranking would rarely change the first place that Qloo alone would choose. It changed in 6 of 19 scenarios.
- No person judged any list, a language model without Qloo data was not among the baselines, and the scenarios were chosen by the team that built the method.

## 3. Redacted request to result explanation

Every case has an Evidence tab that lists, for that case:

- what was sent to the taste provider: the city, the category phrase, the names and vibe phrases, and the original venue name when it was used as a taste signal or a distance limit applied
- what was kept local
- how each name or phrase was matched, the entry that was selected, how it was selected, and the alternatives that were considered
- the redacted requests, with endpoint, parameters, status, attempts, duration, cache state and result count, and no credential
- the shortlist with provider rank, provider affinity and the gate outcome

**Entity and tag choices.** A name that matches exactly one entry by normalised name resolves. Anything else is ambiguous, and the person chooses among up to five candidates or skips the signal. A fuzzy match is never used downstream. The simulated scenario "Jazz night, one signal needs a choice" demonstrates this: the word jazz matches two simulated tags, the search does not run, and the person is asked which one is meant.

The shape of the ranking request is documented in [QLOO_INTEGRATION.md](QLOO_INTEGRATION.md). The Evidence tab of any live case lists that case's own redacted requests, and the redacted report of the live smoke test is committed at [data/evaluation/smoke-2026-10-25.json](../data/evaluation/smoke-2026-10-25.json).

## 4. Demo and screenshots

The hosted demo has a demo mode on an invented city and a live mode on real Qloo data, with one ready made plan per city on the front page. The case screenshots are from demo mode: the city, the venues and the taste scores are simulated, and every screen says so. The landing page and the evaluation screenshots show recorded results from live Qloo runs, which name public venues. None contains a credential or personal data. They can be regenerated with `node scripts/screenshots.mjs` against a running server.

| Screenshot                                            | What it shows                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Landing](screenshots/01-landing.png)                 | The product and a recorded gate result from live Qloo data, chosen by a stated rule      |
| [Intake](screenshots/02-intake.png)                   | The intent anchor: plan, what must survive, taste, hard requirements                     |
| [Recovery](screenshots/03-recovery.png)               | A shortlist of places that passed the gate, with source tags                             |
| [Ruled out](screenshots/04-ruled-out.png)             | A place ruled out, with the exact requirement it failed                                  |
| [Comparison](screenshots/05-comparison.png)           | Taste On against Taste Off over the same eligible places                                 |
| [Evidence](screenshots/06-evidence.png)               | The integration status and what has and has not been verified                            |
| [Agent trace](screenshots/07-agent-trace.png)         | What the agent observed, planned, did and decided, and where it handed the decision back |
| [Live evaluation](screenshots/08-live-evaluation.png) | The twelve preregistered predictions and the results of both live runs, misses included  |
| [Baselines](screenshots/09-baselines.png)             | The approaches compared on the held out scenarios, with and without the gate             |

## 5. Setup from a clean environment

Requirements: Node.js 22.13 or newer.

```sh
git clone https://github.com/hudasol/afterglow.git
cd afterglow
npm ci
npm run check
npm run build
npm start
```

Open http://127.0.0.1:8788. With no key the application runs in demo mode only.

To use live Qloo, copy `.env.example` to `.env`, set `QLOO_API_KEY`, run `npm run qloo:smoke`, then restart the server. To reproduce the offline evaluation run `npm run eval`. To repeat the live evaluation run `npm run eval:live`, and to repeat the baseline comparison run `npm run eval:baselines -- --run test`. Both need a key and send real requests. To run the browser tests run `npm run test:e2e`.

## 6. Known limitations and what the results do not establish

- Three of the 12 preregistered predictions were missed in both live runs: how much the ranking changes when the signals are swapped (P4, P5) and how often the Taste On top choice differs from the nearest place (P9). A read only look at the pools showed why in part. When a plan sends only vibe tags, Qloo gave all 40 places the same taste score in all five such scenarios, so the order follows distance, and the application says so beside the shortlist. The registered result is not changed.
- Qloo states opening hours for about 70 percent of the places in the evaluation pools, step free access for about 74 percent and a dietary fact for about 63 percent where one was needed. It never states group capacity or covered seating. For facts that stay unknown AFTERGLOW can look at OpenStreetMap, which volunteers edit, and that lookup has not yet been run successfully against real data, because the public Overpass servers did not answer when it was tried. Whatever remains stays unknown until the person checks it, and the gate treats unknown as not passing.
- The live evaluation measures how the pipeline behaves on real Qloo data for plans the team chose. It does not measure whether Qloo affinity predicts what a person will enjoy, and the hours, access and dietary facts Qloo states were not checked against the venues.
- The offline evaluation uses an invented, hand authored catalogue. In it, a plain top three broke at least one requirement in 12 of 17 scenarios, and the gated shortlists broke none as judged by a separately written oracle. These figures show how the pipeline behaves on that catalogue. They are not a rate in the real world and they say nothing about how well Qloo predicts what people enjoy.
- The baseline comparison shows that the gate removes conflicts that plain lists contain and that the Qloo signal changes the answer. It does not show that people would prefer the result. Most offered places still need the person's check: in 11 of the 19 scenarios with a gated list none of the three places was fully verified, because Qloo states the facts for only part of its places. In one Los Angeles scenario all 40 places failed a requirement, because the candidate pool comes from a search over the whole city.
- No people took part in any evaluation.
- AFTERGLOW does not book, call or message anyone. Confirmed means the person said so.
- Cases are tied to a browser through a random identifier. There are no accounts.

The full list is in [LIMITATIONS.md](LIMITATIONS.md).

## Story

### Inspiration

A cancelled reservation rarely ruins an evening on its own. What ruins it is the scramble that follows, where the only thing a recommendation list knows is what is popular nearby. We wanted a tool that treats the lost plan as evidence about what the group wanted.

### What it does

It anchors the intent, matches the group's taste to Qloo entities and tags, evaluates every candidate against every hard requirement, rules out the ones that fail, ranks the rest, and keeps a case history. When nothing fits, it offers the smallest sets of requirements the person could give up and waits for agreement.

### How we built it

TypeScript with a layered design: a pure domain layer, an application layer behind a taste provider port, SQLite for an event sourced case history, an Express API and a React interface. A labelled simulated provider makes the product demonstrable and testable without a key. A separately written oracle restates the constraint rules so the gate can be checked against something other than itself. It shares the distance and time helpers with the gate, and a test compares the two on generated facts.

### Challenges

Designing for unknown facts. Qloo states opening hours, step free access and dietary options for only part of the places it returns, and never group capacity, so the gate has three outcomes, unknown never passes, and a second, labelled source fills in only what it can state clearly. Learning from the live data too: the first evaluation run showed that a venue name can match a place in another country and that Qloo slows sharply when five or more tag signals are sent, and both are now handled and recorded. Building a fair Taste On against Taste Off comparison, where only the ordering rule differs. Staying honest in a demo, where invented data must never look like live data.

### Accomplishments

A gate that is checked against a separately written statement of the rules. Provenance on every fact. A flow that asks the person rather than guessing when a match is ambiguous. A browser test suite with accessibility checks, and documented, reproducible evaluations that were registered before they were run, report their misses and state their limits. Tests fail when a figure in the documents stops matching the recorded results.

### What we learned

That the most useful behaviour is often refusal: refusing to rank a place that cannot work, refusing to guess a match, and refusing to call an unverified fact verified.

### What is next

Limit the candidate search to the neighbourhood of the original venue, which the Los Angeles scenario points to. Compare against a language model that has no taste data. Check the OpenStreetMap place facts against real data, check the facts Qloo states against the venues for a sample, and test the recovery flow with real people.

### Built with

TypeScript, Node.js, Express, SQLite, React, Vite, Zod, Vitest, Playwright, and the Qloo API.
