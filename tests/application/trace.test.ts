import { describe, expect, it } from 'vitest';
import type { TraceStep } from '../../src/domain/trace.js';
import { scenarioById } from '../../src/simulation/scenarios.js';
import { FlakyProvider, makeService } from '../helpers/service.js';

const SESSION = 'session-a';

function scenario(id: string) {
  const found = scenarioById(id);
  if (!found) throw new Error(`Unknown scenario ${id}`);
  return found;
}

async function open(service: ReturnType<typeof makeService>['service'], id: string) {
  const spec = scenario(id);
  return service.openCase(SESSION, {
    mode: 'demo',
    anchor: spec.anchor,
    disruption: spec.disruption,
  });
}

const phases = (steps: readonly TraceStep[]) => new Set(steps.map((step) => step.phase));

describe('agent trace', () => {
  it('shows every phase of the first search and agrees with the case view', async () => {
    const { service } = makeService();
    const view = await open(service, 's01-anniversary-venue-closed');
    const trace = service.getTrace(SESSION, view.id);

    expect(trace.cycles).toHaveLength(1);
    const cycle = trace.cycles[0];
    expect(cycle?.heading).toBe('First search');
    expect(cycle?.kind).toBe('search');
    expect(phases(cycle?.steps ?? [])).toEqual(
      new Set(['observe', 'plan', 'act', 'decide', 'hand_over']),
    );
    expect(cycle?.tally).toEqual({
      pool: view.options.length,
      feasible: view.options.filter((o) => o.feasibility === 'feasible').length,
      needsVerification: view.options.filter((o) => o.feasibility === 'needs_verification').length,
      ruledOut: view.options.filter((o) => o.feasibility === 'rejected').length,
    });
    const decision = cycle?.steps.filter((step) => step.phase === 'decide').map((s) => s.text);
    const topName = view.options.find((o) => o.candidate.id === view.shortlistIds[0])?.candidate
      .name;
    expect(decision?.join(' ')).toContain(topName ?? 'missing');
    expect(cycle?.steps.some((step) => step.text.includes(view.providerLabel))).toBe(true);
    expect(trace.since).toEqual([]);
    const observed = cycle?.steps.filter((step) => step.phase === 'observe').map((s) => s.text);
    expect(observed?.some((text) => /^Matched \d+ names and phrases/u.test(text))).toBe(true);
    expect(observed?.some((text) => text.startsWith('Resolved'))).toBe(false);
  });

  it('waits for a choice before any cycle, then records the choice in the first one', async () => {
    const { service } = makeService();
    const spec = scenario('s00-jazz-needs-a-choice');
    const opened = await open(service, spec.id);
    expect(opened.status).toBe('needs_choices');
    const waiting = service.getTrace(SESSION, opened.id);
    expect(waiting.cycles).toEqual([]);
    expect(waiting.since.join(' ')).toMatch(/matched several entries/u);

    const pending = opened.pendingChoices[0];
    await service.chooseResolution(SESSION, opened.id, {
      key: pending?.key ?? '',
      chosenId: spec.choices?.['jazz'] ?? '',
    });
    const trace = service.getTrace(SESSION, opened.id);
    expect(trace.cycles).toHaveLength(1);
    const observed = trace.cycles[0]?.steps.filter((s) => s.phase === 'observe').map((s) => s.text);
    expect(observed?.some((text) => text.startsWith('You chose'))).toBe(true);
  });

  it('adds a cycle for a new disruption and leaves earlier cycles unchanged', async () => {
    const { service } = makeService();
    const opened = await open(service, 's01-anniversary-venue-closed');
    const before = service.getTrace(SESSION, opened.id).cycles[0];

    await service.recordDisruption(SESSION, opened.id, { kind: 'weather', condition: 'rain' });
    const trace = service.getTrace(SESSION, opened.id);

    expect(trace.cycles).toHaveLength(2);
    expect(trace.cycles[0]).toEqual(before);
    expect(trace.cycles[1]?.heading).toBe('New search after a disruption');
    const observed = trace.cycles[1]?.steps.filter((s) => s.phase === 'observe');
    expect(observed?.some((s) => /rain/iu.test(s.text))).toBe(true);
  });

  it('records a change the person makes as a re-check without a new request', async () => {
    const { service } = makeService();
    const opened = await open(service, 's16-original-not-located');
    const waiting = opened.options.find((o) => o.feasibility === 'needs_verification');
    expect(waiting).toBeDefined();
    const searchesBefore = service.getProvenance(SESSION, opened.id).calls.latestSearch.length;

    await service.attestFact(SESSION, opened.id, {
      candidateId: waiting?.candidate.id ?? '',
      constraintKey: 'max_distance_km',
      satisfied: true,
    });
    const trace = service.getTrace(SESSION, opened.id);

    expect(trace.cycles).toHaveLength(2);
    const recheck = trace.cycles[1];
    expect(recheck?.kind).toBe('recheck');
    expect(recheck?.steps.some((s) => s.phase === 'act' && /No new request/u.test(s.text))).toBe(
      true,
    );
    expect(recheck?.steps.some((s) => s.phase === 'observe' && /You checked/u.test(s.text))).toBe(
      true,
    );
    expect(service.getProvenance(SESSION, opened.id).calls.latestSearch).toHaveLength(
      searchesBefore,
    );
    expect(recheck?.tally?.feasible).toBe((trace.cycles[0]?.tally?.feasible ?? 0) + 1);
  });

  it('shows the offer to relax requirements, then the agreement', async () => {
    const { service } = makeService();
    const opened = await open(service, 's10-no-feasible-option');
    const first = service.getTrace(SESSION, opened.id).cycles[0];
    const decision = first?.steps.filter((s) => s.phase === 'decide').map((s) => s.text);
    expect(decision?.join(' ')).toMatch(/No place meets every requirement/u);
    expect(decision?.join(' ')).toMatch(/waited for your agreement/u);

    const offered = opened.relaxations[0];
    await service.relaxConstraints(SESSION, opened.id, offered?.constraintKeys ?? []);
    const trace = service.getTrace(SESSION, opened.id);
    expect(trace.cycles).toHaveLength(2);
    const recheck = trace.cycles[1];
    expect(recheck?.kind).toBe('recheck');
    // Several requirements given up in one agreement are one change, not one cycle each.
    expect(offered?.constraintKeys.length).toBeGreaterThan(1);
    expect(recheck?.steps.filter((s) => s.phase === 'observe')).toHaveLength(
      offered?.constraintKeys.length ?? 0,
    );
    expect(recheck?.steps.some((s) => /Given up with your agreement/u.test(s.text))).toBe(true);
    expect(
      (recheck?.tally?.feasible ?? 0) + (recheck?.tally?.needsVerification ?? 0),
    ).toBeGreaterThan(0);
    expect(recheck?.steps.some((s) => s.phase === 'decide' && /Shortlist:/u.test(s.text))).toBe(
      true,
    );
  });

  it('reports a failed search and says nothing was ranked', async () => {
    const provider = new FlakyProvider();
    provider.failPool = true;
    const { service } = makeService({ demo: provider });
    const opened = await open(service, 's01-anniversary-venue-closed');
    const trace = service.getTrace(SESSION, opened.id);

    expect(trace.cycles).toHaveLength(1);
    const cycle = trace.cycles[0];
    expect(cycle?.outcome).toBe('failed');
    expect(cycle?.tally).toBeNull();
    expect(cycle?.steps.some((s) => s.phase === 'act' && /failed/u.test(s.text))).toBe(true);
    expect(cycle?.steps.some((s) => /stopped rather than guess/u.test(s.text))).toBe(true);
    expect(phases(cycle?.steps ?? []).has('decide')).toBe(false);
  });

  it('keeps later steps such as an attempt outside the cycles', async () => {
    const { service } = makeService();
    const opened = await open(service, 's01-anniversary-venue-closed');
    const top = opened.shortlistIds[0] ?? '';
    await service.startAttempt(SESSION, opened.id, top);
    const trace = service.getTrace(SESSION, opened.id);
    expect(trace.cycles).toHaveLength(1);
    expect(trace.since).toHaveLength(1);
    expect(trace.since[0]).toMatch(/You started trying/u);
  });

  it('never claims that anything was booked', async () => {
    const { service } = makeService();
    const opened = await open(service, 's01-anniversary-venue-closed');
    const top = opened.shortlistIds[0] ?? '';
    await service.startAttempt(SESSION, opened.id, top);
    await service.confirmAttempt(SESSION, opened.id, top);
    const trace = service.getTrace(SESSION, opened.id);
    const text = [...trace.cycles.flatMap((c) => c.steps.map((s) => s.text)), ...trace.since].join(
      '\n',
    );
    expect(text).not.toMatch(/\b(booked|reserved|paid)\b/iu);
    expect(text).toMatch(/does not book/u);
    expect(trace.since.join(' ')).toMatch(/not an automatic booking/u);
  });

  it('refuses a case that belongs to another session', async () => {
    const { service } = makeService();
    const opened = await open(service, 's01-anniversary-venue-closed');
    expect(() => service.getTrace('another-session', opened.id)).toThrow(/not found/iu);
  });
});
