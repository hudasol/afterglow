# OpenStreetMap place facts

This document describes how AFTERGLOW reads practical facts about venues from OpenStreetMap, why it does so, what it sends, and what has and has not been verified.

## Status

The reader, matcher, client and integration are implemented and tested against invented responses. They have **not yet been run against real OpenStreetMap data** from this project. The check that does so is `npm run osm:smoke`, or the **OpenStreetMap smoke test** workflow in GitHub Actions. It needs no key. Until its result is recorded here, treat every statement about how much real data AFTERGLOW can read as unverified.

| Check                                              | Result      |
| -------------------------------------------------- | ----------- |
| Overpass query accepted and parsed on real data    | Not yet run |
| Share of real opening hours values read in full    | Not yet run |
| Share of venues that carry wheelchair or diet tags | Not yet run |

## Why a second source

Qloo describes what groups of people tend to like. It does not supply opening hours, dietary options, step free access or group capacity in a form AFTERGLOW reads. Without another source, a live plan that insists on any of those requirements would show every place as needing a check. OpenStreetMap is an open map that volunteers edit, and many venues carry tags for exactly those facts.

## What is read

Only the tags below are read, and only when the plan insists on the matching requirement.

| Requirement         | Tags read                                                                            | Rule                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Open at plan time   | `opening_hours`                                                                      | A fixed subset is understood: weekday lists and ranges, time ranges past midnight, `off`, `24/7`. Anything else makes the value unreadable. |
| Dietary requirement | `diet:*` with `yes` or `only`, and a `cuisine` of vegan, vegetarian, halal or kosher | A diet fact is offered only when the tags cover every dietary requirement of the plan. A missing tag is never read as a no.                 |
| Step free access    | `wheelchair`                                                                         | `yes` and `designated` mean yes. `no` means no. `limited` and a missing tag stay unknown.                                                   |
| Fits the party size | `capacity`                                                                           | A whole number from 1 to 500.                                                                                                               |

Nut free kitchens, covered seating and prices are never inferred from OpenStreetMap.

## How a place is matched

For each place Qloo returned, with a known location and at least one needed fact still unknown, AFTERGLOW asks OpenStreetMap for named venues within 150 metres of that point. A venue matches when its name is the same after case, accents and punctuation are removed, or when one name is a whole word run of the other and the shorter name has at least five characters. When several match, the same name wins over a contained name, and then the nearest wins. A place with no match keeps its facts unknown, and the reason says that no matching place was found.

## How the facts are used

- A value from OpenStreetMap is stored on the place with the source `openstreetmap`, the tag it was read from, the OpenStreetMap reference, and the time it was read. The interface shows the source on each requirement and the tag value under it.
- A fact that Qloo or the person has already supplied is never replaced.
- The feasibility gate treats an OpenStreetMap value like any other known fact. A venue shut for the whole day of the plan fails. A venue whose hours do not cover the plan fails.
- The person always has the last word. Checking a fact in the interface overrides the map for that place.
- Any failure, whether a timeout, a rate limit, a bad answer or an unreadable tag, leaves the facts unknown. The search carries on and a note on the case says what happened.

## What is sent

Only the public coordinates of venues that Qloo returned, in one request per search, to the public Overpass API. No title, party size, note, time, taste name or personal detail is sent. At most 40 places are looked up per search. Answers are kept in memory for six hours so that repeated searches do not call the shared service again. The request is recorded in the case evidence as an `overpass` call, without coordinates in the stored parameters.

The lookup runs only for live cases. The labelled demo never contacts OpenStreetMap.

## Licence and attribution

OpenStreetMap data is available under the Open Database Licence and must be credited as © OpenStreetMap contributors. AFTERGLOW shows that credit in the footer whenever the lookup is enabled, and on a case whenever a fact from OpenStreetMap was used. OpenStreetMap is community data. It can be wrong or out of date, so the interface says so wherever it shows a value from it.

## Configuration

| Variable              | Default                                                                                 | Purpose                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `AFTERGLOW_OSM_FACTS` | `true`                                                                                  | Turns the lookup off when set to `false`. It also needs a Qloo key.                       |
| `OVERPASS_URL`        | `https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter` | One endpoint, or several separated by commas that are tried in order. Each must be https. |
| `OVERPASS_TIMEOUT_MS` | `12000`                                                                                 | How long to wait for each endpoint.                                                       |

The public Overpass services are shared and have fair use limits. The first real data run from this project met a timeout and then a 502 from the main public server, so the client moves to the next endpoint when one is overloaded, times out or limits the rate, and records which host answered. It does not move on when a query is refused, because another server would refuse it too. A busy public demo should run its own instance or turn the lookup off. The lookup runs at the same time as the Qloo ranking, so it adds waiting time only when it is the slower of the two.

## Running the check

```sh
npm run osm:smoke -- --lat 40.7580 --lon -73.9855 --radius 400 --points 1
```

The check asks for the named venues around one public point, or around a grid of up to 40 points with `--points`, which is how a search asks and shows how long it takes. It reports how many venues carry the tags above and how many `opening_hours` values the reader understands. The report records counts and tag values only, never venue names. It is written to `data/evaluation/osm-smoke-<date>.json`. The same check can be started from the **OpenStreetMap smoke test** workflow in the Actions tab. Its verdict is **go** when hours are present, at least half are understood and the answer took ten seconds or less, **conditional** when venues come back but few hours can be used or the answer was slow, and **no go** when nothing comes back.

## Limits

- Coverage depends on volunteers. Many venues have no hours or no wheelchair tag, and those stay unknown.
- The hours reader understands a deliberately small subset. Months, sunrise, public holiday logic and open ended hours make a value unreadable rather than guessed.
- Public holidays are not applied. A rule that only concerns public holidays is ignored, so a venue can be shut on a holiday that falls on the plan day.
- Matching by name and position can pick the wrong place when two venues with the same name stand close together.
