# MCP server

AFTERGLOW can be driven by any client that speaks the Model Context Protocol. The server exposes the same recovery workflow as the web interface. It uses the same service, the same feasibility gate and the same taste providers, so a client cannot reach anything the web interface cannot.

The server runs over standard input and output. It does not listen on a network port.

## Run it

```sh
npm ci
npm run mcp
```

A client normally starts the process itself. A typical client configuration looks like this, with the path changed to where the repository was cloned:

```json
{
  "mcpServers": {
    "afterglow": {
      "command": "npm",
      "args": ["--silent", "--prefix", "/absolute/path/to/afterglow", "run", "mcp"]
    }
  }
}
```

The `--silent` flag matters. Standard output carries the protocol, and any other text written there breaks the connection. The server writes its own log lines to standard error only.

Without a Qloo key the server offers the labelled demo mode. To use live mode, put `QLOO_API_KEY` in the `.env` file in the repository folder. The key is read by the server process and is never returned by any tool, never logged and never placed in a tool result.

Cases opened through the server are kept under their own session, so they are separate from cases opened in a browser. Set `AFTERGLOW_MCP_SESSION` to any string to keep several clients apart.

## Tools

| Tool                          | What it does                                                                |
| ----------------------------- | --------------------------------------------------------------------------- |
| `afterglow_demo_scenarios`    | Lists ready made demo scenarios that can be passed to `afterglow_open_case` |
| `afterglow_open_case`         | Records the intent anchor and the disruption, resolves signals, runs search |
| `afterglow_list_cases`        | Lists cases opened through this server                                      |
| `afterglow_get_case`          | Returns the shortlist, removed options with reasons, and open questions     |
| `afterglow_get_provenance`    | Returns the redacted record of what was sent to the taste provider          |
| `afterglow_choose_signal`     | Settles an ambiguous taste signal, or skips it                              |
| `afterglow_record_disruption` | Records a new disruption and searches again                                 |
| `afterglow_search_again`      | Runs the search again with the current plan                                 |
| `afterglow_attest_fact`       | Records what the person checked for one constraint on one option            |
| `afterglow_relax_constraints` | Gives up constraints, only when exactly that change was offered             |
| `afterglow_reject_option`     | Rules an option out                                                         |
| `afterglow_start_attempt`     | Marks that the person will try an option                                    |
| `afterglow_confirm_attempt`   | Records that the person says they secured the place                         |
| `afterglow_fail_attempt`      | Records that an option did not work out                                     |
| `afterglow_close_case`        | Closes the case as recovered, which needs a confirmed option, or abandoned  |

Every tool result is compact JSON. It states the source of the data on every result, whether that is the labelled demo catalogue or live Qloo, and ends with the next actions that make sense for the case.

## Rules the server enforces, and one it cannot

Two rules are enforced by the application whatever the calling model does, and tests cover them.

- A constraint that cannot be checked from data stays unknown. An unknown never passes. The result lists the question for the person.
- A constraint can be given up only when no option is left and that exact change was offered. A request to give up anything else is refused.

One rule is requested and not enforced.

- Only the person should settle an unknown fact. `afterglow_attest_fact` records an answer as the person's and overrides data the app held. The server cannot tell who supplied the answer, so the server instructions tell the calling model to use it only with an answer the person gave. A client that ignores that instruction can record a fact the person never stated, and the case history would show it as the person's check. The web interface sends an answer only from a button the person presses.

The server never books, calls or pays. `afterglow_confirm_attempt` records what the person reports. A case cannot be closed as recovered without one.

- Errors come back as a tool result with an error code and a plain message. Internal detail never appears in a result.

## What this does and does not show

The server gives a model tools to run the recovery workflow. The model decides which tool to call and when, but the ranking, the gate and the history are computed by the application and are the same for every client. The model is not trusted to make claims about venues, and the tool results are built so that it has no way to present a demo venue as a live one.

A model connected to this server can be wrong, for example by asking the person a poor question or by summarising a result badly. The tool results are the source of truth, and the web interface shows the same case in full.

## Verification

- `tests/interfaces/mcp.test.ts` calls every behaviour above through a real MCP client over an in memory transport.
- `tests/interfaces/mcp-stdio.test.ts` starts the server as a real process, checks that standard output carries only the protocol and opens a demo case through it.
- Nothing here has been tested against a particular commercial client. The protocol is standard, but a specific client may handle tool annotations or server instructions differently.
