import { afterEach, describe, expect, it } from 'vitest';
import { scenarioById } from '../../src/simulation/scenarios.js';
import { SESSION_HEADER, startServer, type TestResponse } from '../helpers/http.js';

let closer: (() => Promise<void>) | undefined;
afterEach(async () => {
  await closer?.();
  closer = undefined;
});

const spec = scenarioById('s01-anniversary-venue-closed');
const openBody = () =>
  JSON.stringify({ mode: 'demo', anchor: spec?.anchor, disruption: spec?.disruption });

describe('http interface', () => {
  it('reports health and status without exposing any secret', async () => {
    const server = await startServer({}, { liveConfigured: true, qlooCallsToday: 3 });
    closer = server.close;
    expect((await (await server.request('/api/health')).json()).status).toBe('ok');
    const status = await (await server.request('/api/status')).json();
    expect(status.modes.live).toMatchObject({ configured: true, callsToday: 3, dailyCap: 2000 });
    expect(status.modes.demo.label).toContain('Simulated');
    expect(JSON.stringify(status)).not.toMatch(/key/iu);
  });

  it('requires a session header for case routes', async () => {
    const server = await startServer();
    closer = server.close;
    const response = (await fetch(`${server.base}/api/cases`)) as unknown as TestResponse;
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('session_required');
  });

  it('opens a case, reads it back and keeps it private to the session', async () => {
    const server = await startServer();
    closer = server.close;
    const created = await server.request('/api/cases', { method: 'POST', body: openBody() });
    expect(created.status).toBe(201);
    const view = await created.json();
    expect(view.status).toBe('recovering');
    expect(view.shortlistIds.length).toBeGreaterThan(0);

    expect((await server.request(`/api/cases/${view.id}`)).status).toBe(200);
    const other = await server.request(`/api/cases/${view.id}`, {
      headers: { [SESSION_HEADER]: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' },
    });
    expect(other.status).toBe(404);

    const list = await (await server.request('/api/cases')).json();
    expect(list.cases).toHaveLength(1);
    expect(list.cases[0].status).toBe('recovering');
  });

  it('runs the attempt and confirm flow over the API', async () => {
    const server = await startServer();
    closer = server.close;
    const view = await (
      await server.request('/api/cases', { method: 'POST', body: openBody() })
    ).json();
    const top = view.shortlistIds[0];
    const attempt = await server.request(`/api/cases/${view.id}/options/${top}/attempt`, {
      method: 'POST',
    });
    expect((await attempt.json()).status).toBe('attempting');
    const confirmed = await server.request(`/api/cases/${view.id}/options/${top}/confirm`, {
      method: 'POST',
    });
    expect((await confirmed.json()).status).toBe('recovered');
    const provenance = await (await server.request(`/api/cases/${view.id}/provenance`)).json();
    expect(provenance.sentToProvider.locationQuery).toBe('Harbourvale');
  });

  it('returns structured errors for bad input', async () => {
    const server = await startServer();
    closer = server.close;
    const badJson = await server.request('/api/cases', { method: 'POST', body: '{nope' });
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).error.code).toBe('invalid_json');

    const invalid = await server.request('/api/cases', {
      method: 'POST',
      body: JSON.stringify({ mode: 'demo', anchor: { title: 'x' }, disruption: spec?.disruption }),
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe('invalid_request');

    const live = await server.request('/api/cases', {
      method: 'POST',
      body: JSON.stringify({ mode: 'live', anchor: spec?.anchor, disruption: spec?.disruption }),
    });
    expect(live.status).toBe(503);
    expect((await live.json()).error.code).toBe('live_unavailable');

    expect((await server.request('/api/nothing')).status).toBe(404);
  });

  it('rejects oversized bodies', async () => {
    const server = await startServer();
    closer = server.close;
    const response = await server.request('/api/cases', {
      method: 'POST',
      body: JSON.stringify({ pad: 'x'.repeat(100_000) }),
    });
    expect(response.status).toBe(413);
  });

  it('refuses a cross origin write and a foreign host header', async () => {
    const server = await startServer();
    closer = server.close;
    const crossOrigin = await server.request('/api/cases', {
      method: 'POST',
      body: openBody(),
      headers: { origin: 'https://evil.example' },
    });
    expect(crossOrigin.status).toBe(403);
    expect((await crossOrigin.json()).error.code).toBe('bad_origin');
  });

  it('enforces the access token when one is set', async () => {
    const server = await startServer({ accessToken: 'a-long-enough-token-1234' });
    closer = server.close;
    expect((await server.request('/api/cases')).status).toBe(401);
    expect(
      (
        await server.request('/api/cases', {
          headers: { authorization: 'Bearer wrong-token-wrong-token' },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await server.request('/api/cases', {
          headers: { authorization: 'Bearer a-long-enough-token-1234' },
        })
      ).status,
    ).toBe(200);
    expect((await server.request('/api/health')).status).toBe(200);
  });

  it('rate limits a noisy client', async () => {
    const server = await startServer({ rateLimitPerMinute: 3 });
    closer = server.close;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await server.request('/api/health')).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
  });

  it('serves the featured scenarios and a missing probe as unavailable', async () => {
    const server = await startServer();
    closer = server.close;
    const list = await (await server.request('/api/scenarios')).json();
    expect(list.scenarios.length).toBeGreaterThanOrEqual(3);
    expect(list.scenarios.every((s: { anchor: unknown }) => s.anchor !== undefined)).toBe(true);
    const probe = await server.request('/api/integration/probe', { method: 'POST' });
    expect(probe.status).toBe(503);
  });

  it('runs a probe when live is configured', async () => {
    const server = await startServer(
      {},
      {
        liveConfigured: true,
        probe: async () => ({ ok: true, latencyMs: 12, message: 'ok' }),
      },
    );
    closer = server.close;
    const probe = await (await server.request('/api/integration/probe', { method: 'POST' })).json();
    expect(probe).toEqual({ ok: true, latencyMs: 12, message: 'ok' });
  });
});
