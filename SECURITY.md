# Security policy

## Reporting a problem

Please report a vulnerability privately through the repository's **Security** tab ("Report a vulnerability"), or contact the maintainers through their GitHub profiles. Do not open a public issue for one. Include the steps to reproduce it and the commit you tested.

## Scope

In scope: the API and web interface in this repository, the MCP server, and the hosted demo at https://afterglow-gsc4.onrender.com.

Out of scope: Qloo, OpenStreetMap and Overpass, Render and GitHub themselves. Report those to their operators.

## What the application protects, and how

- **The Qloo key** is read only by the server from the environment. It is not sent to the browser, written to a log, a case, an evaluation report or a results file, and the connection probe returns only the status of a call.
- **Cases** belong to a browser through a random identifier sent in a header and stored only as a SHA 256 hash. There are no accounts. Anyone who holds the identifier can read the cases it scopes, so treat it like a bearer token.
- **Writes** are checked against an allowed origin, the JSON body is limited to 64 KB, requests are rate limited per client address, and live actions that spend the shared Qloo allowance have a smaller per client hourly budget and a daily cap.
- **A non loopback bind** is refused unless an access token or the explicit public demo setting is set.
- **Only what is needed leaves the server.** The city, the venue category, public taste names and phrases, and the original venue name are sent to Qloo. Titles, party sizes, notes and times stay on the server. See [docs/RESPONSIBLE_USE.md](docs/RESPONSIBLE_USE.md).

## Known limits

The hosted demo keeps cases in an ephemeral SQLite file and has no accounts. It is a demonstration and is not meant to hold anything private. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md).
