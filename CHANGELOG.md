# Changelog

All notable changes are listed here, newest first. The project follows [Semantic Versioning](https://semver.org/) from the first tagged release.

## Unreleased

### Added

- A baseline comparison of AFTERGLOW against random, nearest first, popular and taste only lists, each with and without the gate, judged by the oracle (`npm run eval:baselines`).
- A second preregistration, [docs/PREREGISTRATION_V2.md](docs/PREREGISTRATION_V2.md), and 20 test scenarios in five cities that the development scenarios do not use, frozen by hash.
- Recorded baseline runs on the Evidence page, and a recorded example from live Qloo data on the front page in place of the simulated one.
- Ready made live plans on the front page, one per city, that open a case on real Qloo data in one press.
- A per client hourly budget for live case actions, so one visitor cannot spend the shared Qloo allowance (`AFTERGLOW_LIVE_ACTIONS_PER_HOUR`).
- A one minute cache for the connection probe, so repeated requests share one call to Qloo.
- `npm run qloo:categories`, a read only check of how a venue category resolves on Qloo.
- Contribution guide, security policy, decision records, issue and pull request templates, and Dependabot configuration.
- The front page opens with the held out results, including the weak part, and a recorded comparison of the nearest first order with the Qloo blend. The Evidence page opens with a summary of what the recorded results support and what they do not.
- A captioned walkthrough video of the hosted demo, [docs/media/afterglow-demo.mp4](docs/media/afterglow-demo.mp4).
- The hosted site shows the version and commit it is running, in the footer and in `/api/health`.

### Changed

- Each vibe a plan asks for is sent to Qloo as up to three example places instead of a bare tag, with the tag ladder as a fallback ([docs/adr/0003-vibes-as-example-places.md](docs/adr/0003-vibes-as-example-places.md)).
- Qloo affinity is rescaled across the places that pass the gate before it is blended with closeness ([docs/adr/0004-rescale-affinity.md](docs/adr/0004-rescale-affinity.md)).
- The category phrases for live music and dessert resolve to a single place genre on Qloo.
- The gated nearest first list leaves out places without a known distance.
- The keepalive window starts on 29 October 2026.
- The inspector draws its check, cross and unknown marks instead of using text symbols, and the order comparison chart becomes a table on small screens.
- CI runs the unit checks on Node 22 and 24.

### Removed

- The workflow that probed hosted model endpoints, which was only used to find out what was reachable.

## 0.1.0, 25 October 2026

First complete version.

- Intent anchor, feasibility gate with pass, fail and unknown, three orderings (nearest first, most popular first, taste on), relaxation proposals and an append only event log per case.
- Qloo provider for `/search`, `/v2/tags` and `/v2/insights`, with opening hours, step free access and dietary options read from place entities, and a labelled simulated catalogue for demo mode.
- OpenStreetMap place facts for live cases, implemented and tested with invented responses.
- Web interface with an agent trace, an evidence page and a history tab; an MCP server over stdio.
- Offline evaluation on the simulated catalogue, a live smoke test, and a preregistered live evaluation over 20 scenarios in five cities, run twice, with its misses recorded.
- Render blueprint, continuous integration and a keepalive workflow for the hosted demo.
