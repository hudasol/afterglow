import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionKeyFromToken } from '../../src/application/session.js';
import { createMcpServer, MCP_INSTRUCTIONS } from '../../src/interfaces/mcp/server.js';
import { scenarioById } from '../../src/simulation/scenarios.js';
import { makeService } from '../helpers/service.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

async function connect(token = 'test-session', shared = makeService()) {
  const server = createMcpServer({
    service: shared.service,
    sessionKey: sessionKeyFromToken(token),
    version: '0.0.0-test',
  });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return { client, shared };
}

type Client_ = Awaited<ReturnType<typeof connect>>['client'];

interface OptionBody {
  id: string;
  feasibility: string;
  positions: { tasteOn: number | null };
  questionsForThePerson: { key: string }[];
  gate: { basis: string; outcome: string }[];
}

/** The parts of a tool result that these tests read. */
interface Body {
  caseId: string;
  status: string;
  source: { mode: string; note: string };
  shortlist: OptionBody[];
  otherOptions: OptionBody[];
  removed: { count: number; examples: { id: string }[] };
  nextActions: string[];
  scenarios: { anchor: unknown; disruption: unknown }[];
  cases: unknown[];
  error: { code: string; message: string };
}

async function call(client: Client_, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const first = (result.content as { type: string; text: string }[])[0];
  return {
    isError: result.isError === true,
    body: JSON.parse(first?.text ?? 'null') as Body,
  };
}

const spec = scenarioById('s01-anniversary-venue-closed');
const openArgs = () => ({ mode: 'demo', anchor: spec?.anchor, disruption: spec?.disruption });

describe('mcp interface', () => {
  it('lists the tools and carries the operating rules', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'afterglow_open_case',
        'afterglow_get_case',
        'afterglow_attest_fact',
        'afterglow_relax_constraints',
        'afterglow_confirm_attempt',
        'afterglow_close_case',
      ]),
    );
    for (const tool of tools) expect(tool.description?.length ?? 0).toBeGreaterThan(30);
    expect(client.getInstructions()).toBe(MCP_INSTRUCTIONS);
    expect(MCP_INSTRUCTIONS).toMatch(/never books/iu);
  });

  it('marks read tools as read only and keeps destructive hints off', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get('afterglow_get_case')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('afterglow_attest_fact')?.annotations?.readOnlyHint).toBe(false);
    for (const tool of tools) expect(tool.annotations?.destructiveHint).toBe(false);
  });

  it('lists the demo scenarios as data that opens a case', async () => {
    const { client } = await connect();
    const listed = await call(client, 'afterglow_demo_scenarios');
    expect(listed.body['scenarios'].length).toBeGreaterThan(2);
    const first = listed.body['scenarios'][0];
    const opened = await call(client, 'afterglow_open_case', {
      mode: 'demo',
      anchor: first?.anchor,
      disruption: first?.disruption,
    });
    expect(opened.isError).toBe(false);
  });

  it('opens a demo case and labels the source on the result', async () => {
    const { client } = await connect();
    const opened = await call(client, 'afterglow_open_case', openArgs());
    expect(opened.isError).toBe(false);
    expect(opened.body['source'].mode).toBe('demo');
    expect(opened.body['source'].note).toMatch(/not Qloo data/iu);
    expect(opened.body['status']).toBe('recovering');
    const shortlist = opened.body['shortlist'] as { positions: { tasteOn: number | null } }[];
    expect(shortlist.length).toBeGreaterThan(0);
    expect(shortlist.length).toBeLessThanOrEqual(3);
    expect(shortlist[0]?.positions.tasteOn).toBe(1);
    expect(opened.body['nextActions'].length).toBeGreaterThan(0);
  });

  it('refuses live mode when no key is configured', async () => {
    const { client } = await connect();
    const result = await call(client, 'afterglow_open_case', { ...openArgs(), mode: 'live' });
    expect(result.isError).toBe(true);
    expect(result.body['error'].code).toBe('live_unavailable');
  });

  it('rejects an anchor that fails validation', async () => {
    const { client } = await connect();
    const bad = { ...spec?.anchor, partySize: 0 };
    const failed = await call(client, 'afterglow_open_case', { ...openArgs(), anchor: bad }).then(
      (result) => result.isError,
      () => true,
    );
    expect(failed).toBe(true);
    const list = await call(client, 'afterglow_list_cases');
    expect(list.body['cases']).toHaveLength(0);
  });

  it('keeps cases private to the session that opened them', async () => {
    const shared = makeService();
    const first = await connect('session-one', shared);
    const second = await connect('session-two', shared);
    const opened = await call(first.client, 'afterglow_open_case', openArgs());
    const caseId = opened.body['caseId'] as string;
    const seen = await call(second.client, 'afterglow_get_case', { caseId });
    expect(seen.isError).toBe(true);
    expect(seen.body['error'].code).toBe('not_found');
    expect((await call(second.client, 'afterglow_list_cases')).body['cases']).toHaveLength(0);
  });

  it('turns an unexpected failure into a plain error without internal detail', async () => {
    const { client } = await connect();
    const result = await call(client, 'afterglow_get_case', { caseId: 'no-such-case' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.body)).not.toMatch(/at \S+ \(|node_modules|\.ts:/u);
  });

  it("settles an unknown fact only when the caller records the person's answer", async () => {
    const { client } = await connect();
    const unlocated = scenarioById('s16-original-not-located');
    const opened = await call(client, 'afterglow_open_case', {
      mode: 'demo',
      anchor: unlocated?.anchor,
      disruption: unlocated?.disruption,
    });
    const caseId = opened.body['caseId'] as string;
    const options = (body: Body): OptionBody[] => [...body.shortlist, ...body.otherOptions];
    const waiting = options(opened.body).find((option) =>
      option.questionsForThePerson.some((q) => q.key === 'max_distance_km'),
    );
    expect(waiting, 'the scenario should leave the distance unknown').toBeDefined();
    expect(waiting?.feasibility).toBe('needs_verification');

    const passed = await call(client, 'afterglow_attest_fact', {
      caseId,
      candidateId: waiting?.id,
      constraintKey: 'max_distance_km',
      satisfied: true,
    });
    expect(passed.isError).toBe(false);
    const afterPass = options(passed.body).find((option) => option.id === waiting?.id);
    expect(afterPass?.feasibility).toBe('feasible');
    expect(afterPass?.gate.find((entry) => entry.basis === 'user_attested')?.outcome).toBe('pass');

    const failed = await call(client, 'afterglow_attest_fact', {
      caseId,
      candidateId: waiting?.id,
      constraintKey: 'max_distance_km',
      satisfied: false,
    });
    expect(options(failed.body).some((option) => option.id === waiting?.id)).toBe(false);
    expect(failed.body['removed'].examples.some((example) => example.id === waiting?.id)).toBe(
      true,
    );
  });

  it('refuses to record an answer for a constraint that is not part of the plan', async () => {
    const { client } = await connect();
    const opened = await call(client, 'afterglow_open_case', openArgs());
    const result = await call(client, 'afterglow_attest_fact', {
      caseId: opened.body['caseId'],
      candidateId: opened.body['shortlist'][0]?.id,
      constraintKey: 'covered_space',
      satisfied: true,
    });
    expect(result.isError).toBe(true);
    expect(result.body['error'].code).toBe('invalid_constraint');
  });

  it('will not confirm an option that was never attempted, or close as recovered without one', async () => {
    const { client } = await connect();
    const opened = await call(client, 'afterglow_open_case', openArgs());
    const caseId = opened.body['caseId'] as string;
    const top = opened.body['shortlist'][0]?.id as string;

    const confirm = await call(client, 'afterglow_confirm_attempt', { caseId, candidateId: top });
    expect(confirm.isError).toBe(true);
    const close = await call(client, 'afterglow_close_case', { caseId, outcome: 'recovered' });
    expect(close.isError).toBe(true);
    expect(close.body['error'].code).toBe('not_confirmed');
  });

  it('carries a case from search to a recorded recovery', async () => {
    const { client } = await connect();
    const opened = await call(client, 'afterglow_open_case', openArgs());
    const caseId = opened.body['caseId'] as string;
    const top = opened.body['shortlist'][0]?.id as string;

    const started = await call(client, 'afterglow_start_attempt', { caseId, candidateId: top });
    expect(started.body['status']).toBe('attempting');
    expect(started.body['nextActions'].join(' ')).toMatch(/Ask the person/u);

    const confirmed = await call(client, 'afterglow_confirm_attempt', { caseId, candidateId: top });
    expect(confirmed.body['status']).toBe('recovered');

    const closed = await call(client, 'afterglow_close_case', { caseId, outcome: 'recovered' });
    expect(closed.isError).toBe(false);
    expect(closed.body['nextActions'][0]).toMatch(/closed/iu);
  });

  it('records a failed attempt and moves on to the next option', async () => {
    const { client } = await connect();
    const opened = await call(client, 'afterglow_open_case', openArgs());
    const caseId = opened.body['caseId'] as string;
    const top = opened.body['shortlist'][0]?.id as string;
    await call(client, 'afterglow_start_attempt', { caseId, candidateId: top });
    const failed = await call(client, 'afterglow_fail_attempt', {
      caseId,
      candidateId: top,
      note: 'Fully booked',
    });
    expect(failed.body['status']).toBe('recovering');
    const ids = [...failed.body['shortlist'], ...failed.body['otherOptions']].map(
      (option) => option.id,
    );
    expect(ids).not.toContain(top);
    expect(failed.body['removed'].count).toBeGreaterThan(0);
  });

  it('returns the agent trace of a case', async () => {
    const { client } = await connect();
    const opened = await call(client, 'afterglow_open_case', openArgs());
    const trace = (await call(client, 'afterglow_get_trace', { caseId: opened.body['caseId'] }))
      .body as unknown as { cycles: { heading: string; steps: { phase: string }[] }[] };
    expect(trace.cycles).toHaveLength(1);
    expect(trace.cycles[0]?.heading).toBe('First search');
    expect(trace.cycles[0]?.steps.map((step) => step.phase)).toContain('hand_over');
  });

  it('returns the redacted provenance of a case', async () => {
    const { client } = await connect();
    const opened = await call(client, 'afterglow_open_case', openArgs());
    const provenance = await call(client, 'afterglow_get_provenance', {
      caseId: opened.body['caseId'],
    });
    expect(provenance.isError).toBe(false);
    expect(JSON.stringify(provenance.body)).not.toMatch(/x-api-key|hack_/iu);
  });
});
