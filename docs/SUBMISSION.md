# Submission: AFTERGLOW

**Save the experience, not just the plan.**

Team Kanban: Huda Mueen Qureshi, Awaiz Ahmed.
Source code: https://github.com/hudasol/afterglow (MIT License, shown in the repository About panel).

| Item                                   | Status                                                   |
| -------------------------------------- | -------------------------------------------------------- |
| Public repository with visible license | Published, MIT                                           |
| Hosted demo                            | Not yet deployed. The link is added here once it is live |
| Demo video                             | Not made. Screenshots are provided instead               |
| Live Qloo verification                 | Not yet run. See the honest status in the sections below |

## 1. Product problem statement

When a plan falls apart, people are given a list of nearby places ranked by popularity. Some of those places cannot work at all: they are closed at the planned time, too expensive, too far, unable to seat the group, or unable to meet a dietary or access need. The ones that can work rarely feel like the evening that was planned, because the list knows nothing about why the plan mattered.

AFTERGLOW recovers the experience, not only the booking. The person describes the plan once. AFTERGLOW keeps what must survive, finds alternatives that fit the group's cultural taste using Qloo, rules out every place that breaks a hard requirement, and shows the evidence for each suggestion. It never books anything and it never assumes a fact it does not have.

## 2. Qloo workflow and why it fits

| Step                                 | Qloo endpoint                                    | Why                                                                                    |
| ------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Match names the group likes          | `/search`                                        | Turns a public name into a Qloo entity so it can act as a taste signal                 |
| Match vibes, genres and the category | `/v2/tags` with semantic search                  | Turns a phrase into a tag, scoped to places for the category                           |
| Candidate places for a city          | `/v2/insights` with a place type and city filter | Provides a pool of real places to evaluate                                             |
| Rank a fixed list by taste           | `/v2/insights` with `filter.results.entities`    | Ranks the same pool the gate evaluated, so Taste On and Taste Off differ only in order |

Qloo fits because the product question is not which place is popular but which place carries the same cultural signal as the plan that was lost. Entities and tags express that signal, and ranking a fixed list lets the comparison with a taste free ordering be fair.

Qloo results are used as evidence inside a product flow. They never override a hard requirement: a place that fails a requirement is ruled out however well it matches taste. Full detail is in [QLOO_INTEGRATION.md](QLOO_INTEGRATION.md).

**Honest status.** The live Qloo path is implemented and tested against a synthetic stand in. It has not yet been run against the real API because the personal key has not arrived. The command `npm run qloo:smoke` runs the first live experiment and records a go, conditional or no go verdict. Nothing in this submission claims that verdict has been reached.

## 3. Redacted request to result explanation

Every case has an Evidence tab that lists, for that case:

- what was sent to the taste provider: the city, the category phrase, the names and vibe phrases, and the original venue name only when a distance limit applied
- what was kept local
- how each name or phrase was matched, the entry that was selected, how it was selected, and the alternatives that were considered
- the redacted requests, with endpoint, parameters, status, attempts, duration, cache state and result count, and no credential
- the shortlist with provider rank, provider affinity and the gate outcome

**Entity and tag choices.** A name that matches exactly one entry by normalised name resolves. Anything else is ambiguous, and the person chooses among up to five candidates or skips the signal. A fuzzy match is never used downstream. The simulated scenario "Jazz night, one signal needs a choice" demonstrates this: the word jazz matches two simulated tags, the search does not run, and the person is asked which one is meant.

The shape of the ranking request is documented in [QLOO_INTEGRATION.md](QLOO_INTEGRATION.md). A real redacted request and response pair from a live run will be added once the key arrives.

## 4. Demo and screenshots

The screenshots are from demo mode. The city, the venues and the taste scores are simulated, and every screen says so. None contains a credential or personal data. They can be regenerated with `node scripts/screenshots.mjs` against a running server.

| Screenshot                                  | What it shows                                                        |
| ------------------------------------------- | -------------------------------------------------------------------- |
| [Landing](screenshots/01-landing.png)       | The product and a real gate result from the simulated catalogue      |
| [Intake](screenshots/02-intake.png)         | The intent anchor: plan, what must survive, taste, hard requirements |
| [Recovery](screenshots/03-recovery.png)     | A shortlist of places that passed the gate, with source tags         |
| [Ruled out](screenshots/04-ruled-out.png)   | A place ruled out, with the exact requirement it failed              |
| [Comparison](screenshots/05-comparison.png) | Taste On against Taste Off over the same eligible places             |
| [Evidence](screenshots/06-evidence.png)     | The integration status and what has and has not been verified        |

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

To use live Qloo, copy `.env.example` to `.env`, set `QLOO_API_KEY`, run `npm run qloo:smoke`, then restart the server. To reproduce the offline evaluation run `npm run eval`. To run the browser tests run `npm run test:e2e`.

## 6. Known limitations and what the results do not establish

- The live Qloo path has not yet been verified with a real key.
- In live mode Qloo is not read for opening hours, dietary options, accessibility, capacity or covered seating, so those requirements stay unknown until the person checks them, and the gate treats unknown as not passing.
- The offline evaluation uses an invented, hand authored catalogue. In it, a plain top three broke at least one requirement in 12 of 17 scenarios, and the gated shortlists broke none as judged by an independent oracle. These figures show how the pipeline behaves on that catalogue. They are not a rate in the real world and they say nothing about how well Qloo predicts what people enjoy.
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

TypeScript with a layered design: a pure domain layer, an application layer behind a taste provider port, SQLite for an event sourced case history, an Express API and a React interface. A labelled simulated provider makes the product demonstrable and testable without a key. An independent oracle re-implements the constraint rules so the gate can be checked against something other than itself.

### Challenges

Designing for unknown facts. Qloo gives rich taste data but not opening hours or accessibility, so the gate has three outcomes, and unknown never passes. Building a fair Taste On against Taste Off comparison, where only the ordering rule differs. Staying honest in a demo, where invented data must never look like live data.

### Accomplishments

A gate that is checked by an independent implementation. Provenance on every fact. A flow that asks the person rather than guessing when a match is ambiguous. A browser test suite with accessibility checks, and a documented, reproducible evaluation with its limits stated.

### What we learned

That the most useful behaviour is often refusal: refusing to rank a place that cannot work, refusing to guess a match, and refusing to call an unverified fact verified.

### What is next

Run the live smoke test and evaluation, add sources for opening hours and accessibility that can be read and cited, and test the recovery flow with real people.

### Built with

TypeScript, Node.js, Express, SQLite, React, Vite, Zod, Vitest, Playwright, and the Qloo API.
