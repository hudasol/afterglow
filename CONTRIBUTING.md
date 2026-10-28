# Contributing

AFTERGLOW is a TypeScript application: an Express API, a React interface, a SQLite store and two taste providers. This page covers what you need to change it and what a change has to satisfy.

## Set up

Requirements: Node.js 22.13 or newer. No other service is needed.

```sh
npm ci
npm run dev        # API on 8788 and the interface on 5173, with reload
```

With no `QLOO_API_KEY` the application runs in demo mode on the labelled simulated catalogue. A live key is personal. Put it in `.env`, which Git ignores, and never in a commit, an issue, a log or the browser bundle.

## Before you push

```sh
npm run check      # type check, lint, formatting and the unit and integration tests
npm run build
npm run test:e2e   # browser tests with accessibility checks; needs a Playwright Chromium
```

Continuous integration runs the same three steps on every push and pull request.

## Layout and the rules it follows

The layers are described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Four rules matter for most changes.

- **The domain is pure.** Nothing under `src/domain` may import an outer layer, a framework or a module that does input or output. ESLint enforces this.
- **Every fact says where it came from.** A value is a `Fact<T>`, either known with a provenance or unknown with a reason. Do not hold a bare value that a person might read as verified.
- **Unknown never passes.** The gate returns pass, fail or unknown for each requirement. A place is ruled out only on a known fact that is against it, and it is shown as ready only when every requirement passes on a known fact. Only the person's own word settles a fact that the data leaves unknown.
- **Nothing is simulated without a label.** Demo data is invented, says so on every screen, and is never presented as Qloo data. Do not add a code path that makes a result look live.

## Tests

Tests live under `tests/`, mirroring `src/`. A test for behaviour sits next to the layer it exercises. Taste provider tests use recorded or hand written response shapes in `tests/helpers` and never call the network. Do not skip or weaken a test to make a change pass. If a test is wrong, change it in its own commit and say why.

## Evaluation

The evaluation is held to a stricter rule than the rest of the code, because its numbers are quoted.

- Results files under `results/` and the reports in `docs/EVALUATION_*.md` are written by commands. Do not edit them by hand. A test fails if a report differs from its results file.
- A new comparison is registered before it is run: write the questions, the baselines, the statistics and numeric predictions in a preregistration, commit it, and only then run. See [docs/PREREGISTRATION_V2.md](docs/PREREGISTRATION_V2.md).
- After results exist, a change to the design is a dated amendment that keeps the original text. Do not tune on the scenarios that a prediction is judged on.
- Keep the misses. Explain them without excusing them.

## Commits and pull requests

- One logical change per commit, with a subject in the imperative and a body that says why.
- Do not rewrite history on `main`. Correct a mistake with a new commit.
- A pull request describes what changed, why, and how it was checked. It states any change to what the application sends to Qloo or to another service.

## Writing

Documentation and interface text are formal, specific and plain. State what was measured and what was not. Do not use em dashes or emojis.
