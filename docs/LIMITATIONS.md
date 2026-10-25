# Known limitations

## What the project does not establish

- **Live Qloo behaviour beyond what was run.** The live path was exercised on 25 October 2026: one smoke test of 16 requests in New York, recorded in `data/evaluation/smoke-2026-10-25.json`, and the preregistered evaluation over 20 scenarios in five cities, recorded in `results/live-qloo.json`. Qloo data changes over time, each run is a single run on one day, and nothing here shows how the service behaves for other cities, other categories or other days.
- **Quality of taste recommendations.** Nothing in this repository measures whether Qloo affinity predicts what a person or group will enjoy. Affinity describes what groups of people tend to like.
- **Real world rates.** The offline evaluation uses an invented, hand authored catalogue. Its percentages describe the pipeline on that catalogue only. The live evaluation uses real Qloo data, but its 20 scenarios were chosen by the team that built the method, so it shows how the pipeline behaves on those plans and not how often it would help in general.
- **User outcomes.** No people took part in any evaluation.

## Product limits

- **Unknown facts in live mode.** Qloo states opening hours, a wheelchair accessible entrance and dietary options for part of the places it returns, and AFTERGLOW reads exactly those. In the smoke test on New York restaurants hours were present for 26 of 40 places, step free access for 31 and vegetarian food for 25. A missing value stays unknown. Qloo does not state group capacity or covered seating at all. For the facts that are still unknown AFTERGLOW can look at OpenStreetMap, matching each place by name and position, but only where volunteers have tagged a matching place, and that lookup has not yet been run successfully against real data, because the public Overpass servers did not answer when it was tried. Everything else stays unknown until the person attests it. A plan with many such requirements can still show many places as needing a check, and may show none as ready. Covered seating and prices are never read from OpenStreetMap.
- **Taste that cannot separate places.** When a plan sends vibe tags and no names, Qloo gave every place the same score in the live evaluation, and the order of the shortlist then follows distance. When names and tags are sent together Qloo scored only part of the pool. The application says so beside the shortlist. Names alone gave a usable spread. The cause on Qloo's side is not known.
- **Names in other countries.** A venue name can match a place in another country, because the name search is not limited to a city. AFTERGLOW checks the match against the places found in the city and does not use one that lies far outside them, and distance to the original venue is then unknown. It cannot catch a wrong match inside the same city.
- **Many tag signals.** At most four tag signals are sent, because Qloo was slow with five or more. A plan with more vibes has the rest left out, and the Evidence tab lists the tags that were sent.
- **Tags are not guarantees.** A dietary or access tag on a place is a statement from a data source, not from the venue. Someone with an allergy or a strict requirement must confirm with the venue.
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
