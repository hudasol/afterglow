# Known limitations

## What the project does not establish

- **Live Qloo behaviour.** The live path has not yet been run against the real API. Until the smoke test is recorded, treat every statement about live results as unverified.
- **Quality of taste recommendations.** Nothing in this repository measures whether Qloo affinity predicts what a person or group will enjoy. Affinity describes what groups of people tend to like.
- **Real world rates.** The offline evaluation uses an invented, hand authored catalogue. Its percentages describe the pipeline on that catalogue only.
- **User outcomes.** No people took part in any evaluation.

## Product limits

- **Unknown facts in live mode.** Qloo responses are not read for opening hours, dietary options, accessibility, capacity or covered seating. For live cases AFTERGLOW looks some of them up on OpenStreetMap, matching each place by name and position, but only where volunteers have tagged a matching place, and that lookup has not yet been run against real data. Everything else stays unknown until the person attests it. A plan with many such requirements can still show many places as needing a check, and may show none as ready. Covered seating and prices are never read from OpenStreetMap.
- **No booking.** AFTERGLOW does not book, call, message or pay. Starting an attempt means the person contacts the venue themselves. Confirmed records the person's statement and is not verified with the venue.
- **One city per case, city level location.** Distance is measured from the original venue when its location can be found. When it cannot, distance based requirements are unknown, and the original venue is not excluded unless it can be matched by name.
- **Shortlist size.** The shortlist shows three places. The pool is limited by what the provider returns for a city and category.
- **Relaxation suggestions.** Each suggestion is the exact set of requirements that at least one place fails, ordered with the smallest sets first, and at most three are shown. A place admitted by a relaxation can still need the person's check for facts that are unknown.
- **Language and region.** The interface and matching rules are written for English and for place names Qloo can match.

## Operational limits

- **No accounts.** Cases belong to a browser through a random identifier stored locally. Clearing site data separates a person from their cases. Anyone who holds the identifier can read the cases it scopes.
- **Shared map service.** The OpenStreetMap lookup uses the public Overpass service, which has fair use limits and can be slow or unavailable. When it fails the facts stay unknown and the case says so.
- **Single process.** Case locking is in process, so run one server instance per database file.
- **Ephemeral hosting.** On a host with an ephemeral disk, cases are lost when the service restarts. Idle cases are removed after 48 hours by default.
- **Public demo.** A public demo with a live key shares one daily call cap among all visitors. The cap protects the quota and means live mode can stop working for the rest of the day.
- **Experimental SQLite.** `node:sqlite` is marked experimental in Node.js. The warning is expected.
