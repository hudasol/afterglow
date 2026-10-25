# Qloo integration

This document describes exactly how AFTERGLOW uses the Qloo API, what it sends, what it keeps local, and what has and has not been verified.

## Status

The client, matching rules, provider and smoke experiment were run against the real Qloo API on 25 October 2026 from GitHub Actions, using the team's personal key held as a repository secret. The experiment used 16 requests. The redacted report is committed as [data/evaluation/smoke-2026-10-25.json](../data/evaluation/smoke-2026-10-25.json), and the verdict is **go**.

| Check                                    | Result                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Authenticated request accepted           | Passed                                                                                        |
| Entity matching returns usable results   | Passed. "Miles Davis" matches an artist and a person, so the person chooses                   |
| Category tag matching                    | Passed. "restaurant" resolves to the place genre tag                                          |
| Vibe tag matching                        | Passed. "jazz" resolves to one place tag                                                      |
| Category filter narrows the pool         | Passed. 40 of 40 places carry the category tag                                                |
| Practical facts read from the pool       | Passed. Opening hours for 26 of 40 places, step free access for 31 and vegetarian food for 25 |
| Place pool for a city                    | Passed. 40 places returned for New York                                                       |
| Ranking over a fixed pool                | Passed. 40 of 40 places received a score                                                      |
| Ranking responds to different signals    | Passed. Two different signals gave a Kendall tau of 0.41 and a top three overlap of 0 percent |
| A place accepted as a taste signal       | Passed. 39 of 40 places were scored when a place was the only signal                          |
| Entity and tag signals accepted together | Passed                                                                                        |
| Go, conditional or no go verdict         | **Go**                                                                                        |

What the run showed, in plain terms:

- Names are shared across types. A musician is listed as an artist and as a person, and sometimes as an album or an author. Tags are shared across categories: the vibe "romantic" exists as an ambience tag and as a setting tag. The first version of the matching treated this as ambiguity and stopped. The rules below are the ones written after seeing it.
- Place entities carry practical facts. Opening hours come as a week of slots, wheelchair access and dietary options come as tags. Group capacity and covered seating do not appear.
- Coverage is partial. Hours were present for about two thirds of the places in this pool and the access and diet tags for about three quarters and two thirds. A fact that is missing stays unknown and the gate does not pass it.
- The pool, the ranking and the signals behave as the product needs: the category filter was honoured, every place in the fixed pool was scored, and different signals gave different orderings.

The probes were public cultural names, so the report holds no venue data. The preregistered evaluation over 20 scenarios in five cities is described in [PREREGISTRATION.md](PREREGISTRATION.md). Its registered result is in [EVALUATION_LIVE.md](EVALUATION_LIVE.md), a second run after two product fixes is in [EVALUATION_LIVE_SECOND_RUN.md](EVALUATION_LIVE_SECOND_RUN.md), and [EVALUATION_LIVE_NOTES.md](EVALUATION_LIVE_NOTES.md) explains the misses and what the two runs showed about Qloo's behaviour.

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

Qloo can list one entity under two types with the same identifier, as it does for Fleetwood Mac as an artist and as a person. The choice screen shows these as one entry that names both types, because choosing either is the same choice, and keeps entries with different identifiers (the album of the same name, for example) separate.

The name search is not limited to a city. The first live evaluation showed it returning a restaurant in Arizona for "Zuma", one in Bahrain for "Al Fanar Restaurant" and one in Iran for "Arabian Tea House", all for plans in Dubai. A match with the right name in the wrong country is therefore checked against the places found in the city. An entry more than 150 km from the middle of the places found for the city (taken only when at least five of them have a known position) is not used as a taste signal or as the position of the venue. When the pool contains a place with a matching name (Zuma Dubai, for example), that place is used instead and the Evidence tab says so. Otherwise the distance to the original venue is unknown and the person is told.

### Matching a vibe, genre or category

`GET /v2/tags` with `filter.query` (the phrase), `feature.semantic_search=true` and `take=20`.

Policy: the request is limited to tags that apply to places with `filter.parents.types=urn:entity:place`, so a tag with the same name in another domain is never chosen. An exact normalised name match resolves. When several place tags have exactly the same name, as the live run showed for "romantic", "cozy" and "rooftop", all of them are used together as signals, the first is shown as the selection, and the Evidence tab says that the others were used as well. For the venue category, the place genre tag is preferred over tags of the same name in other taxonomies. Anything that is not an exact name match is shown to the person to choose. Qloo does not return a calibrated relevance score for semantic tag search, so AFTERGLOW never treats rank order alone as a match.

### Candidate places for a city

`GET /v2/insights` with `filter.type=urn:entity:place`, `filter.location.query` (the city), `filter.tags` (the resolved category tag) and `take`.

### Ranking a fixed list by taste

`GET /v2/insights` with `filter.type=urn:entity:place`, `filter.results.entities` (the candidate ids), `signal.interests.entities` (the resolved names the group likes, and the resolved venue that fell through) and `signal.interests.tags` (the resolved vibes), `feature.explainability=true` and `take`.

Ranking a fixed list, rather than asking Qloo for its own top places, means the Taste On and Taste Off orderings are built from the identical pool.

At most four tag signals are sent. Qloo answered in 0.2 to 13 seconds with up to four tag signals and in 30 to 60 seconds with five or more, which is what made three of the first 20 evaluation scenarios time out, so the cap is part of the design. The request waits up to 25 seconds. If Qloo cannot answer, the provider steps down and tells the person which reduction applied: first to the first two tag signals, then, when names are present, to the names alone. In each form it also retries without explainability if Qloo rejects that option. A failed ranking falls back to Taste Off with a visible note. A failed pool request is recorded on the case and can be retried.

Two things about the answers matter for how a ranking is read, and the application says so beside the shortlist when they happen.

- When a plan sends vibe tags and no names, Qloo returned the same affinity for every place. This happened in all five such scenarios of the live evaluation, in five cities, with an identical value of 0.7649962877984056. The order then follows distance.
- When names and vibe tags are sent together, Qloo returned a score for only part of the pool in the evaluation (from 1 to 32 places of 40). Places it did not score are listed after those it did, within the same group of places.

Names alone gave a score for every place, with a spread of 0.10 to 0.16 between the smallest and the largest. The numbers are in [data/evaluation/affinity-spread-2026-10-25.json](../data/evaluation/affinity-spread-2026-10-25.json). We do not know why Qloo behaves this way, and the product does not guess.

## What is read from responses

AFTERGLOW reads names, ids, types, descriptions, image links, tags, popularity, an affinity value, an explanation, an address when one is present, a price level when it is an integer from 1 to 4, and a location only from an object with explicit latitude and longitude keys. A bare coordinate array is ignored.

Since the live run of 25 October 2026 it also reads three practical facts from a place entity. Each is written against the shape that was recorded, and each is left unknown when the value is missing, partial or in a form that is not recognised.

- **Opening hours**, from `properties.hours`. The value is an object keyed by weekday name, and each day holds a list of slots with a `closed` flag and `opens` and `closes` clock times such as `T10:00:00`. The whole value is refused when any day is missing or any open slot has no readable times, because a week with one wrong day is worse than no week. A closing time at or before the opening time is read as running past midnight. The weekday and time of the plan are then checked against the week, and the evidence shown to the person reads, for example, "Listed for Friday: 10:00 to 23:00".
- **Step free access**, from the tag `urn:tag:accessibility:place:wheelchair_accessible_entrance`. A place without the tag is not known to be inaccessible, so the absence of the tag gives no fact.
- **Dietary options**, from the tags `urn:tag:dietary_option:qloo:` followed by vegetarian, vegan, halal, kosher, gluten free or nut free. The list is offered only when it covers every dietary requirement of the plan. A vegan tag also counts for vegetarian. The absence of a tag gives no fact, because a place may cater for a diet without carrying the tag.

These facts carry the source tag Qloo and the evidence they were read from. Group capacity and covered seating are not stated by Qloo and stay unknown. For those, and for any fact Qloo leaves unknown, a live case can look at OpenStreetMap as a fallback, as described in [OPENSTREETMAP.md](OPENSTREETMAP.md), and shows it with its own source. Whatever remains stays unknown until the person attests it, and the gate treats unknown as not passing. A fact the person has checked is never replaced by either source. No Qloo data is sent to OpenStreetMap and nothing from OpenStreetMap is sent to Qloo.

A diet tag is not a guarantee. Anyone with an allergy or a strict religious requirement should confirm with the venue, and [RESPONSIBLE_USE.md](RESPONSIBLE_USE.md) says so.

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

This is the shape that Qloo accepted in the run of 25 October 2026. Entity and tag signals were accepted in a single request. The reduced forms described above were needed for the three evaluation scenarios that sent five or more tag signals, which is why the cap exists.

## Running the experiment

```sh
npm run qloo:smoke -- --city "New York" --seed-a "Miles Davis" --seed-b "Metallica"
```

Without a key the command reports that credentials are missing, makes no request and writes nothing. With a key it runs the checks in the table above and prints a verdict:

- **go**: every check passed
- **conditional**: the integration works, with limits that are listed
- **no go**: the integration cannot support the product as designed

The report records counts, key names, the shapes of values and rankings of the public cultural entities used as probes. It stores no venue data and no key.

### From GitHub Actions

The same experiment can run from the **Qloo smoke test** workflow, which is started by hand from the Actions tab. It reads the key from a repository secret named `QLOO_API_KEY`, so the key stays inside GitHub and is never pasted anywhere else. Add the secret under Settings, Secrets and variables, Actions. The workflow fails at once, without any request, if the secret is missing. It prints the redacted report and keeps it as a downloadable artifact. Because the log of a public repository is public, the report holds only counts, key names and rankings of public probes, as described above.

## Troubleshooting

If a request fails with an authentication error, the key was rejected. Ask Qloo support for a replacement and include the error category and time, never the key. If matching is ambiguous or unexpected, refine the phrase rather than forcing a fuzzy match, and describe the assumption in any write up.
