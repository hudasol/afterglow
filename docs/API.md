# HTTP API

The server exposes a JSON API under `/api`. The interface in `web/` is its only first party client, and the same operations are available to scripts. The agent tools in [MCP.md](MCP.md) call the same application service, so they behave identically.

All bodies are JSON with a limit of 64 kB. Times are ISO 8601 with an offset. Error responses always have the same shape.

```json
{ "error": { "code": "invalid_request", "message": "anchor: Required" } }
```

## Sessions

Cases belong to a session. A client creates a random session token of 22 to 64 characters from `A-Z a-z 0-9 _ -` and sends it as `X-Afterglow-Session` on every case request. The server stores only a hash of it, so one session cannot read another's cases. A missing or malformed header returns `400 session_required`.

When the server is started with `AFTERGLOW_ACCESS_TOKEN`, every route except `/api/health` also requires `Authorization: Bearer <token>`. A public demo runs without one and relies on the limits below.

## Reading the service

| Method and path                   | Returns                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET /api/health`                 | `{ "status": "ok", "version": "..." }`                                                       |
| `GET /api/status`                 | Which modes are available, which providers back them, and the Qloo daily call count and cap  |
| `GET /api/scenarios`              | Ready made demo plans with their `anchor`, `disruption` and any pre made `choices`           |
| `GET /api/live-presets`           | Ready made live plans, empty unless a Qloo key is configured                                 |
| `GET /api/evaluation`             | The recorded evaluation: reports, smoke checks, live runs, baseline runs, a recorded example |
| `GET /api/showcase`               | The offline demonstration used on the landing page                                           |
| `POST /api/integration/probe`     | One small authenticated call to Qloo, cached for a short time. `503` without a key           |
| `POST /api/integration/osm-probe` | One small real query to OpenStreetMap from the server. `503` when the lookup is turned off   |

## Cases

| Method and path                                    | Purpose                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /api/cases`                                  | Open a case from `{ mode, anchor, disruption }` and run the first search. Returns `201` |
| `GET /api/cases`                                   | List the session's cases                                                                |
| `GET /api/cases/:id`                               | The full case view: plan, options with gate results, comparison, history                |
| `DELETE /api/cases/:id`                            | Delete the case. Returns `204`                                                          |
| `GET /api/cases/:id/provenance`                    | Exactly what was sent to each provider, redacted, and what was kept on the server only  |
| `GET /api/cases/:id/trace`                         | What the agent observed, planned, did and decided, cycle by cycle                       |
| `POST /api/cases/:id/choices`                      | Settle an ambiguous signal: `{ key, chosenId }` or `{ key, skip: true }`                |
| `POST /api/cases/:id/disruptions`                  | Record a further change to the plan and search again                                    |
| `POST /api/cases/:id/search`                       | Repeat the search, for example after new facts                                          |
| `POST /api/cases/:id/attestations`                 | Record a person's check of one fact: `{ candidateId, constraintKey, satisfied }`        |
| `POST /api/cases/:id/relaxations`                  | Agree to give up named requirements: `{ constraintKeys: [...] }`                        |
| `POST /api/cases/:id/options/:candidateId/reject`  | Set an option aside, with an optional `reason`                                          |
| `POST /api/cases/:id/options/:candidateId/attempt` | Start trying an option                                                                  |
| `POST /api/cases/:id/options/:candidateId/confirm` | Record that the person confirmed the attempt worked                                     |
| `POST /api/cases/:id/options/:candidateId/fail`    | Record that the attempt failed, with an optional `note`                                 |
| `POST /api/cases/:id/close`                        | Close the case as `recovered` or `abandoned`                                            |

`mode` is `demo` for the simulated catalogue or `live` for Qloo. A live case is refused with `503 live_unavailable` when no key is configured. The `anchor` is validated by `intentAnchorInputSchema` in `src/domain/intent.ts` and `disruption` is one of these shapes.

| `kind`              | Extra fields                                  |
| ------------------- | --------------------------------------------- |
| `venue_unavailable` | `note` (optional)                             |
| `running_late`      | `minutes`, from 5 to 240                      |
| `weather`           | `condition`: `rain`, `extreme_heat` or `cold` |
| `budget_reduced`    | `maxPriceLevel`, from 1 to 4                  |
| `party_changed`     | `partySize`, from 1 to 30                     |

No route books anything. An attempt is a record that a person tried an option, and a confirmation is the person saying that it worked. The server never contacts a venue.

## A worked example

This opens the first demo scenario, reads the shortlist, then closes the case.

```sh
BASE=http://127.0.0.1:8788
SESSION=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")

# Take the anchor and disruption from a ready made scenario.
BODY=$(curl -s "$BASE/api/scenarios" | node -e "
  let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
    const x=JSON.parse(s).scenarios[0];
    console.log(JSON.stringify({mode:'demo',anchor:x.anchor,disruption:x.disruption}));
  })")

CASE=$(curl -s -X POST "$BASE/api/cases" \
  -H 'content-type: application/json' -H "x-afterglow-session: $SESSION" -d "$BODY")
ID=$(echo "$CASE" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")

curl -s "$BASE/api/cases/$ID/trace" -H "x-afterglow-session: $SESSION"
curl -s -X POST "$BASE/api/cases/$ID/close" -H 'content-type: application/json' \
  -H "x-afterglow-session: $SESSION" -d '{"outcome":"abandoned"}'
```

The case view lists every option the provider returned, each with its gate result (`pass`, `fail` or `unknown`) and the reason. The `shortlistIds` field holds the options that passed the gate, in the order of the active arm, which is `taste_on` by default. `comparison` shows how the three orderings differ.

## Errors and limits

| Status | `code`                                                                                                                                            | When                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 400    | `invalid_request`, `invalid_json`, `session_required`                                                                                             | The body, JSON or session header is not valid                             |
| 401    | `unauthorised`                                                                                                                                    | An access token is required and was not sent                              |
| 403    | `bad_host`, `bad_origin`                                                                                                                          | A loopback server received another Host, or a cross origin write          |
| 404    | `not_found`                                                                                                                                       | No such case, option or endpoint, or the case belongs to another session  |
| 409    | `conflict`, `case_closed`, `choices_pending`, `attempt_open`, `already_confirmed`, `not_offered`, `not_pending`, `not_attempted`, `no_disruption` | The action is not allowed in the case's current state                     |
| 413    | `too_large`                                                                                                                                       | The body is over 64 kB                                                    |
| 429    | `rate_limited`, `live_budget`                                                                                                                     | Over the per minute limit, or over the hourly allowance of live actions   |
| 502    | `provider_error` and the provider's own code                                                                                                      | Qloo failed or refused. The case records it rather than inventing results |
| 503    | `live_unavailable`, `QLOO_NOT_CONFIGURED`, `OSM_NOT_ENABLED`                                                                                      | The feature is not available on this server                               |

Limits are set with `AFTERGLOW_RATE_LIMIT_PER_MINUTE` and `AFTERGLOW_LIVE_ACTIONS_PER_HOUR`, and the Qloo calls per day with `QLOO_DAILY_CALL_CAP`. They are held in memory, so they reset when the process restarts and are meant for a single instance. Demo mode is never limited by the live allowance.
