# AFTERGLOW

[![CI](https://github.com/hudasol/afterglow/actions/workflows/ci.yml/badge.svg)](https://github.com/hudasol/afterglow/actions/workflows/ci.yml)

**Save the experience, not just the plan.**

When a booking falls through, a venue closes or the weather turns, AFTERGLOW keeps what the plan was for, uses [Qloo](https://qloo.com) taste data to find alternatives, rules out any place that breaks a hard requirement, and shows the evidence behind every suggestion. It never books anything. A recovery is confirmed only when the person says so.

Hosted demo: https://afterglow-gsc4.onrender.com (free plan; the first request after a pause can take about half a minute).
Built by Team Kanban (Huda Mueen Qureshi, Awaiz Ahmed) for the Qloo Agentic Hackathon.

![The landing page with a recorded example and the held out results from live Qloo data](docs/screenshots/01-landing.png)

## Why it exists

A plan that falls apart usually ends in a scramble: a list of nearby places ranked by popularity, some of which cannot work at all because they are closed, too far, too expensive or too small for the group. Recommenders rank by taste or popularity and treat practical needs as an afterthought. AFTERGLOW checks the requirements first, ranks what is left with Qloo, and says plainly when a fact is unknown.

## What the evidence shows

AFTERGLOW makes two claims, and the evidence for them has different strength.

**The gate.** It rules out a place when a known fact is against it and asks the person to check the rest. This is the claim that is well supported, and it does not depend on Qloo: any source of prices, opening hours and coordinates would give the same result. On Qloo data the gate can fail a place only on opening hours, price and distance, because Qloo states step free access and diet only as tags that are present and does not state group capacity or covered seating at all. Those requirements become questions for the person.

**The Qloo order.** Qloo supplies the pool of places, the match of names to entities, the facts the gate reads and the order of what the gate leaves. The support for that order is weak, and the table says where.

The comparison was registered before it was run. It was judged by an oracle that is written separately from the gate but shares its distance and time helpers and reads the same facts, so it can find a disagreement in the rules and not a wrong fact. On 20 scenarios in five cities that the product was not developed on (Chicago, Los Angeles, Berlin, Sydney, Toronto), all ranked from the same Qloo pools in one run on 28 October 2026:

| Question                                                        | Result                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does a plain list put a place that breaks a requirement on top? | Without the gate, the top three held one in 18 of 20 scenarios for Qloo taste alone, 20 of 20 for popularity, 10 of 20 for nearest first and 18 of 20 for random. With distance set aside the figures are 16, 14, 10 and 14 of 20. AFTERGLOW offered none in the 19 scenarios where it had a place to offer. This is the gate, not Qloo.                                        |
| Does the Qloo signal change the answer?                         | The top choice differs from nearest first in 14 of 19 scenarios and from popularity in 15 of 19. Any two different orders often differ, so this shows only that the order is not the same. The Qloo affinity of the top three is 0.74 standard deviations above nearest first (0.51 to 0.97), which is positive by construction, because the lists are sorted by that affinity. |
| Does the order surface the requested vibe?                      | No clear gain. The requested vibe is in the top three about as often as in a nearest first list (0.11 against 0.08).                                                                                                                                                                                                                                                            |
| Does the group's own taste decide the order?                    | Not shown. In the earlier live evaluation, ranking with another group's signals left 0.70 of the top three unchanged, and the predictions about it missed in both runs. The swap has not been repeated since example places were introduced, nor on the held out scenarios.                                                                                                     |
| Does blending closeness change what Qloo alone would choose?    | In 6 of 19 scenarios the first place differs. **This missed its prediction** of at most 20 percent. The cost in affinity is small and the list is 0.43 km closer on average.                                                                                                                                                                                                    |
| Were the predictions met?                                       | 13 of 14 thresholds, one missed, all reported in [docs/EVALUATION_BASELINES_TEST.md](docs/EVALUATION_BASELINES_TEST.md). The thresholds came from the development scenarios, so this shows that the result repeated in five other cities. It does not show that the product is good.                                                                                            |

What this does not show, and the notes say so at length in [docs/EVALUATION_BASELINES_NOTES.md](docs/EVALUATION_BASELINES_NOTES.md):

- No person judged any list, so nothing here says that a group would enjoy a place more because AFTERGLOW offered it.
- A language model with no Qloo data is not among the baselines, so it is not known whether AFTERGLOW outperforms one.
- The same team wrote the method and chose the scenarios.
- Most offered places still need the person's check. In 11 of the 19 scenarios with a gated list none of the three places was fully verified, because Qloo states opening hours, step free access and dietary options for only part of its places.
- In one Los Angeles scenario all 40 places failed a requirement, so the gate left nothing to offer. The pool is every place Qloo returns for the category in the city, not the neighbourhood of the venue.

The earlier evaluation of the pipeline on real Qloo data, in which three of twelve predictions were missed in both runs (that the group's signals decide the first place, that they change the top three, and that Taste On and Taste Off choose different first places), is in [docs/EVALUATION_LIVE.md](docs/EVALUATION_LIVE.md).

## How it works

1. **Intent anchor.** The person describes the plan once: the occasion, the party, the time, what must survive, what the group likes and the hard requirements. It is recorded and never edited. Disruptions and decisions are layered on top.
2. **Taste signals.** Names and vibes the group likes are matched to Qloo entities and tags. An exact match resolves. Anything else is shown to the person to choose from, and an uncertain match is never passed on.
3. **Feasibility gate.** Every candidate is checked against every hard requirement and gets pass, fail or unknown. A fail rules the place out. An unknown never passes: it becomes a question for the person.
4. **Orderings.** The eligible places are shown in three orders: nearest first, most popular first, and Taste On, which blends Qloo affinity with closeness. The pool and the gate are the same for all three.
5. **Recovery.** Disruptions, the person's own checks, declined options and relaxations are recorded as events on the case. When no place meets every requirement, AFTERGLOW offers the smallest sets of requirements the person could give up and waits for agreement.
6. **Agent trace.** Every search cycle is shown as what the agent observed, planned, did and decided, and where it handed the decision back. It is rebuilt from the recorded events. AFTERGLOW follows a fixed procedure and is not a chat model.

Each fact in the interface carries a source tag: Qloo, OpenStreetMap, Simulated, You said, You checked or Calculated here. Demo mode uses an invented city and says so on every screen.

| Recovery                                                                        | A place ruled out, with the reason                                                           |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ![A shortlist of places that passed the gate](docs/screenshots/03-recovery.png) | ![A place ruled out with the exact requirement it failed](docs/screenshots/04-ruled-out.png) |

## Where Qloo is used

- `/search` resolves names the group likes, and the venue that fell through, which can serve as a taste signal so the search looks for places that share its audience.
- `/v2/tags` resolves vibes and genres and the venue category tag.
- `/v2/insights` returns the candidate places for a city, with the facts Qloo states for each, and ranks a fixed list of places by affinity to the group's signals. Each vibe is sent as up to three example places that carry it, because a bare tag gave every place the same score.

Qloo describes what groups of people tend to like. AFTERGLOW presents affinities that way and never as a prediction about a person. Workflow, parameters and data handling: [docs/QLOO_INTEGRATION.md](docs/QLOO_INTEGRATION.md). OpenStreetMap can fill facts that Qloo leaves unknown for live cases. That lookup is implemented and tested with invented responses and has not yet run successfully against real data: [docs/OPENSTREETMAP.md](docs/OPENSTREETMAP.md).

## Use it from an MCP client

The same workflow is available as MCP tools over stdio, so a model can open a case, ask the person the questions the gate raises and record their answers. The application enforces two rules whatever the model does: an unknown never passes, and a requirement can be given up only when no option is left and that exact change was offered. A third rule, that only the person's own word settles a fact, is requested of the model and cannot be enforced by a server that does not see who typed the answer. Nothing is booked. See [docs/MCP.md](docs/MCP.md).

## Run it

Requirements: Node.js 22.13 or newer. No other service is needed.

```sh
git clone https://github.com/hudasol/afterglow.git
cd afterglow
npm ci
npm run build
npm start
```

Open http://127.0.0.1:8788. With no Qloo key the application runs in demo mode on the simulated catalogue. For development with reload run `npm run dev` and open http://127.0.0.1:5173.

To use live Qloo, request a hackathon key, copy `.env.example` to `.env` and set `QLOO_API_KEY`. Keys are personal: never commit or share one. The key is read only by the server and is never sent to the browser or written to a log or report. `npm run qloo:smoke` checks that it works.

### Configuration

| Variable                          | Default                          | Purpose                                                                                |
| --------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| `PORT`                            | `8788`                           | Port to listen on                                                                      |
| `HOST`                            | `127.0.0.1`                      | Address to bind. A non loopback address needs a token or public demo mode              |
| `DATABASE_PATH`                   | `var/afterglow.db`               | SQLite file for cases                                                                  |
| `QLOO_API_KEY`                    | empty                            | Personal Qloo key. Leave empty for demo mode only                                      |
| `QLOO_API_URL`                    | `https://hackathon.api.qloo.com` | Qloo API host                                                                          |
| `QLOO_TIMEOUT_MS`                 | `15000`                          | Per request timeout                                                                    |
| `QLOO_DAILY_CALL_CAP`             | `2000`                           | Protective cap on Qloo calls per UTC day. `0` turns it off                             |
| `AFTERGLOW_PUBLIC_DEMO`           | `false`                          | Allow a non loopback bind without a token, for the hosted demo                         |
| `AFTERGLOW_ACCESS_TOKEN`          | empty                            | Optional bearer token that protects `/api` (16 or more characters)                     |
| `AFTERGLOW_ALLOWED_ORIGINS`       | empty                            | Extra browser origins allowed to make write requests                                   |
| `AFTERGLOW_RATE_LIMIT_PER_MINUTE` | `120`                            | Requests per minute per client. `0` turns it off                                       |
| `AFTERGLOW_LIVE_ACTIONS_PER_HOUR` | `12`                             | Live case actions per client per hour, to protect the Qloo allowance. `0` turns it off |
| `AFTERGLOW_TRUST_PROXY`           | `false`                          | Trust the first proxy for client addresses                                             |
| `AFTERGLOW_CASE_TTL_HOURS`        | `48`                             | How long idle cases are kept                                                           |
| `SERVE_WEB`                       | `true`                           | Serve the built interface from the API server                                          |

OpenStreetMap variables are listed in `.env.example`.

### Commands

| Command                                | What it does                                                    |
| -------------------------------------- | --------------------------------------------------------------- |
| `npm run dev`                          | API server and web dev server with reload                       |
| `npm run check`                        | Type check, lint, formatting check and tests                    |
| `npm run test:e2e`                     | Browser tests, including accessibility checks                   |
| `npm run mcp`                          | MCP server over stdio                                           |
| `npm run eval`                         | Offline evaluation on the simulated catalogue                   |
| `npm run eval:baselines -- --run test` | Baseline comparison on the test scenarios. Needs `QLOO_API_KEY` |
| `npm run qloo:smoke`                   | Live Qloo experiment. Needs `QLOO_API_KEY`                      |

Browser tests need a Playwright Chromium. If yours is installed elsewhere, set `PLAYWRIGHT_CHROMIUM_PATH` to its executable.

## Project layout

```
src/domain          Pure rules: intent, gate, scoring, case events and views
src/application     Use cases and the taste provider port
src/infrastructure  Configuration, SQLite and repositories
src/qloo            Qloo client, matching, normalisation and the live provider
src/simulation      The labelled simulated catalogue, provider and scenarios
src/evaluation      Oracle, evaluation runners, baselines and reports
src/interfaces      The Express API and the MCP server
web                 React interface
e2e                 Browser tests
evaluation          Frozen scenario files
results             Recorded results, written by commands and never edited by hand
docs                Integration, architecture, evaluation, decisions and limits
```

The domain layer imports nothing from the outer layers and performs no input or output, and ESLint enforces it. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the [decision records](docs/adr/README.md).

## Documentation

| Topic                                             | Where                                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Baseline comparison: registration, results, notes | [PREREGISTRATION_V2](docs/PREREGISTRATION_V2.md), [results](docs/EVALUATION_BASELINES_TEST.md), [notes](docs/EVALUATION_BASELINES_NOTES.md), [development set](docs/EVALUATION_BASELINES_DEV.md) |
| Earlier live evaluation of the pipeline           | [PREREGISTRATION](docs/PREREGISTRATION.md), [first run](docs/EVALUATION_LIVE.md), [second run](docs/EVALUATION_LIVE_SECOND_RUN.md), [notes](docs/EVALUATION_LIVE_NOTES.md)                       |
| Method of the offline evaluation                  | [docs/EVALUATION.md](docs/EVALUATION.md)                                                                                                                                                         |
| Limits of what is established                     | [docs/LIMITATIONS.md](docs/LIMITATIONS.md)                                                                                                                                                       |
| HTTP API reference                                | [docs/API.md](docs/API.md)                                                                                                                                                                       |
| Deployment on Render                              | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)                                                                                                                                                         |
| Responsible use and data handling                 | [docs/RESPONSIBLE_USE.md](docs/RESPONSIBLE_USE.md)                                                                                                                                               |
| Hackathon submission text                         | [docs/SUBMISSION.md](docs/SUBMISSION.md)                                                                                                                                                         |
| Contributing, changes and security                | [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), [SECURITY.md](SECURITY.md)                                                                                                     |

## Known limitations

The full list is in [docs/LIMITATIONS.md](docs/LIMITATIONS.md). The most important points:

- Facts that Qloo does not state stay unknown until the person checks them. Group capacity and covered seating are never stated.
- The candidate pool comes from a search over the whole city, so a tight distance limit can leave few places or none.
- Nothing measures whether Qloo affinity predicts what a person will enjoy, and no person took part in any evaluation.
- Cases are tied to a browser by a random identifier. There are no accounts, and the hosted demo keeps cases only temporarily.
- AFTERGLOW does not book, call or message anyone. Confirmed means the person said so.

## Responsible use

Only the city, the venue category, public taste names and phrases, and the original venue name, when it is used as a taste signal or a distance limit needs it, are sent to Qloo. Titles, party sizes, notes and times stay on the server. See [docs/RESPONSIBLE_USE.md](docs/RESPONSIBLE_USE.md).

## License

MIT. See [LICENSE](LICENSE).
