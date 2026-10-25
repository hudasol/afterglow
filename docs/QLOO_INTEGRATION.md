# Qloo integration

This document describes exactly how AFTERGLOW uses the Qloo API, what it sends, what it keeps local, and what has and has not been verified.

## Status

The client, matching rules, provider and smoke experiment are implemented and tested against a synthetic stand in server that is labelled as such in the test fixtures. They have **not yet been run against the real Qloo API** because the personal key requested for this project has not arrived. The result of the first live run will be recorded in `data/evaluation/smoke-<date>.json` and summarised here.

| Check                                    | Result          |
| ---------------------------------------- | --------------- |
| Authenticated request accepted           | Not yet run     |
| Entity matching returns usable results   | Not yet run     |
| Category and vibe tag matching           | Not yet run     |
| Place pool for a city                    | Not yet run     |
| Ranking responds to different signals    | Not yet run     |
| Entity and tag signals accepted together | Not yet run     |
| A place accepted as a taste signal       | Not yet run     |
| Go, conditional or no go verdict         | Not yet decided |

## Getting a key

Qloo issues hackathon keys through a request form linked from the hackathon page. A key is personal to the requester and arrives by email. It must not be committed, shared, pasted into chat, or placed in a browser bundle. Put it only in a server environment variable named `QLOO_API_KEY`.

## Host and authentication

- Host: `https://hackathon.api.qloo.com`
- Authentication: the key in an `X-Api-Key` request header
- Method: `GET` only. Array values are joined with commas.
- Transport: HTTPS only. Plain HTTP is accepted only for a loopback address, so tests can run a local stand in.

## Endpoints and parameters

### Matching a name the group likes

`GET /search` with `query` (the name), `take=5`, and for the original venue `types=urn:entity:place`. The original venue is looked up when it is used as a taste signal, which is the default, or when a distance limit needs its location.

Policy: if exactly one returned entity has the same normalised name as the input, it resolves. Otherwise the match is ambiguous and up to five candidates are shown to the person, who chooses or skips the signal. A fuzzy match is never passed on silently. For the original venue, candidates that carry the same name are narrowed by the city only when exactly one mentions the city.

### Matching a vibe, genre or category

`GET /v2/tags` with `filter.query` (the phrase), `feature.semantic_search=true` and `take=20`.

Policy: an exact normalised name match resolves. Otherwise the person chooses. The category tag (for example the phrase for a restaurant) is scoped to the parent type `urn:entity:place`, so a tag with the same name in another domain is not chosen. Qloo does not return a calibrated relevance score for semantic tag search, so AFTERGLOW never treats rank order alone as a match.

### Candidate places for a city

`GET /v2/insights` with `filter.type=urn:entity:place`, `filter.location.query` (the city), `filter.tags` (the resolved category tag) and `take`.

### Ranking a fixed list by taste

`GET /v2/insights` with `filter.type=urn:entity:place`, `filter.results.entities` (the candidate ids), `signal.interests.entities` (the resolved names the group likes, and the resolved venue that fell through) and `signal.interests.tags` (the resolved vibes), `feature.explainability=true` and `take`.

Ranking a fixed list, rather than asking Qloo for its own top places, means the Taste On and Taste Off orderings are built from the identical pool.

If Qloo rejects the full request, the client retries in this order and tells the person which reduction applied: first without the tag signals when entity signals are present, then without explainability. A failed ranking falls back to Taste Off with a visible note. A failed pool request is recorded on the case and can be retried.

## What is read from responses

AFTERGLOW reads names, ids, types, descriptions, image links, tags, popularity, an affinity value, an explanation, an address when one is present, a price level when it is an integer from 1 to 4, and a location only from an object with explicit latitude and longitude keys. A bare coordinate array is ignored.

AFTERGLOW does **not** read opening hours, dietary options, accessibility, group capacity or covered seating from Qloo responses, because their shapes have not been verified. Those facts stay unknown until the person attests them, and the gate treats unknown as not passing.

## What is sent and what is kept

Sent to Qloo, and nothing else:

- the city, as typed
- the venue category phrase
- the public names and vibe phrases the group likes
- the original venue name, when it is used as a taste signal (the default, which the person can turn off) or when a distance limit needs its location

Kept on the server only: the plan title, party size, notes about what must survive, times, requirements, decisions, and the case history.

Do not enter names of people you know as taste names. Qloo describes what groups of people tend to like. AFTERGLOW does not use results to infer anything about an individual.

## Client behaviour

- Up to three attempts with exponential backoff and jitter on rate limits, server errors and timeouts. A `Retry-After` header is honoured up to five seconds.
- Response bodies larger than 2 MB are refused.
- A time limited cache avoids repeating identical calls. The connection probe bypasses it.
- A daily call cap, counted by UTC day, protects the quota.
- Every call produces a redacted trace of the endpoint, parameters, status, attempts, duration, cache state and result count. Traces never include the key.
- Errors are structured with codes for authentication, rate limiting, timeouts, bad requests and malformed responses.

## Request to result for one case

Each case has an Evidence tab, available at `GET /api/cases/:id/provenance`, that lists:

1. what was sent to the provider
2. what was kept local
3. each name and phrase, how it was matched, the selected entry, and the alternatives that were considered
4. the redacted requests for matching and for the latest search
5. the shortlist with the provider rank, the provider affinity and the gate outcome

The shape of a ranking request, with identifiers replaced by placeholders, is:

```
GET /v2/insights
  filter.type=urn:entity:place
  filter.results.entities=<place id>,<place id>,<place id>
  signal.interests.entities=<entity id for a name the group likes>,<entity id for the venue that fell through>
  signal.interests.tags=<tag id for a vibe the group likes>
  feature.explainability=true
  take=<number of places>
```

A real redacted example from a live run will replace this shape once the key has arrived and the smoke test has run.

## Running the experiment

```sh
npm run qloo:smoke -- --city "New York" --seed-a "Miles Davis" --seed-b "Metallica"
```

Without a key the command reports that credentials are missing, makes no request and writes nothing. With a key it runs the checks in the table above and prints a verdict:

- **go**: every check passed
- **conditional**: the integration works, with limits that are listed
- **no go**: the integration cannot support the product as designed

The report records counts, key names and rankings of the public cultural entities used as probes. It stores no venue data.

### From GitHub Actions

The same experiment can run from the **Qloo smoke test** workflow, which is started by hand from the Actions tab. It reads the key from a repository secret named `QLOO_API_KEY`, so the key stays inside GitHub and is never pasted anywhere else. Add the secret under Settings, Secrets and variables, Actions. The workflow fails at once, without any request, if the secret is missing. It prints the redacted report and keeps it as a downloadable artifact. Because the log of a public repository is public, the report holds only counts, key names and rankings of public probes, as described above.

## Troubleshooting

If a request fails with an authentication error, the key was rejected. Ask Qloo support for a replacement and include the error category and time, never the key. If matching is ambiguous or unexpected, refine the phrase rather than forcing a fuzzy match, and describe the assumption in any write up.
