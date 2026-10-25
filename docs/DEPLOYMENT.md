# Deployment

AFTERGLOW is one Node.js process that serves the API and the built interface. It needs Node.js 22.13 or newer and a writable path for a SQLite file.

## Local, production style

```sh
npm ci
npm run build
npm start
```

## Hosting on Render

A blueprint is included in `render.yaml`.

1. Push the repository to GitHub.
2. In Render, create a new Blueprint from the repository, or create a Web Service with these settings:
   - Build command: `npm ci --include=dev && npm run build`
   - Start command: `npm start`
   - Health check path: `/api/health`
3. Set the environment variables below.
4. For live Qloo, add `QLOO_API_KEY` in the Render dashboard. Never put it in the repository or in `render.yaml`. Without it the service runs in demo mode only, and the interface says so.

| Variable                | Value on a public demo | Why                                              |
| ----------------------- | ---------------------- | ------------------------------------------------ |
| `HOST`                  | `0.0.0.0`              | Listen for external traffic                      |
| `AFTERGLOW_PUBLIC_DEMO` | `true`                 | Permit a non loopback bind without a token       |
| `DATABASE_PATH`         | `/tmp/afterglow.db`    | A writable path. The free tier disk is ephemeral |
| `QLOO_DAILY_CALL_CAP`   | `1500`                 | Keep visitors from exhausting the quota          |
| `QLOO_API_KEY`          | the personal key       | Enables live mode. Server side only              |
| `NODE_VERSION`          | `22.23.4` or newer 22  | Render reads this to pick the runtime            |

Render sets `PORT` and `RENDER`. When `RENDER` is `true` the server trusts the first proxy so rate limiting sees client addresses.

## Other hosts

Any host that runs Node.js 22.13 or newer works. Build with `npm ci --include=dev && npm run build`, start with `npm start`, bind `HOST=0.0.0.0` and set `AFTERGLOW_PUBLIC_DEMO=true` or `AFTERGLOW_ACCESS_TOKEN` to a value of 16 or more characters. A static only host is not suitable because the Qloo key must stay on a server.

Note that the built interface does not send the access token. A token protects the API for private or scripted use. A hosted demo for judges should use public demo mode, with the daily cap as the safeguard.

## After deploying

1. Open `/api/health`. It should return `{"status":"ok"}` with the version.
2. Open the site and the Evidence page. It states whether a Qloo key is configured.
3. With a key set, press Check the connection on the Evidence page.
4. Run the smoke test from a trusted machine with the same key and record the result in `docs/QLOO_INTEGRATION.md`.

## Keeping the free instance awake

A free Render instance sleeps after fifteen minutes without traffic and takes about a minute to wake. `.github/workflows/keepalive.yml` pings `/api/health` every ten minutes, but only between 30 October 2026 12:00 UTC and 6 November 2026 00:00 UTC, which covers the submission deadline and the judging period. Outside that window the job exits at once. This limits the use of the free instance hours of the Render workspace, which are shared by every free service in it.

## Data and persistence

Cases live in the SQLite file. On an ephemeral disk they are lost on restart. That is acceptable for a demo and is stated in [LIMITATIONS.md](LIMITATIONS.md). For durable cases, mount a persistent disk and point `DATABASE_PATH` at it. Run a single instance per database file.
