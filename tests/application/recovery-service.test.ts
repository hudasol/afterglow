import { describe, expect, it } from 'vitest';
import { intentAnchorInputSchema } from '../../src/domain/intent.js';
import { disruptionSchema } from '../../src/domain/plan.js';
import { scenarioById, scenarios } from '../../src/simulation/scenarios.js';
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

describe('scenario definitions', () => {
  it.each(scenarios.map((s) => [s.id, s] as const))('%s is valid input', (_id, spec) => {
    expect(intentAnchorInputSchema.safeParse(spec.anchor).success).toBe(true);
    expect(disruptionSchema.safeParse(spec.disruption).success).toBe(true);
  });

  it('has unique identifiers', () => {
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
  });
});

describe('distances', () => {
  it('measures distance for ruled out places so the reason can be seen', async () => {
    const { service } = makeService();
    const view = await open(service, 's02-vegan-date-budget');
    const ruledOut = view.options.filter((o) => o.feasibility === 'rejected');
    expect(ruledOut.length).toBeGreaterThan(0);
    const measured = ruledOut.filter((o) => o.candidate.name !== 'Umber & Oak');
    expect(measured.every((o) => typeof o.distanceKm === 'number' && o.distanceKm >= 0)).toBe(true);
  });
});

describe('opening a case', () => {
  it('records the anchor, resolves signals and runs a search', async () => {
    const { service } = makeService();
    const view = await open(service, 's01-anniversary-venue-closed');
    expect(view.status).toBe('recovering');
    expect(view.mode).toBe('demo');
    expect(view.providerLabel).toContain('Simulated');
    expect(view.run?.tasteStatus).toBe('applied');
    expect(view.run?.poolSize).toBeGreaterThan(0);
    expect(view.resolutions.every((r) => r.status === 'resolved')).toBe(true);
    expect(view.history[0]?.text).toContain('intent anchor');
  });

  it('never offers the original venue and rejects options that break a hard constraint', async () => {
    const { service } = makeService();
    const view = await open(service, 's01-anniversary-venue-closed');
    const original = view.options.find((o) => o.candidate.name === 'The Lantern Room');
    expect(original?.state).toBe('rejected');
    expect(view.shortlistIds).not.toContain(original?.candidate.id);
    // Every shortlisted option has passed every hard constraint.
    for (const id of view.shortlistIds) {
      const option = view.options.find((o) => o.candidate.id === id);
      expect(option?.feasibility).toBe('feasible');
      expect(option?.gate.verdicts.every((v) => v.outcome === 'pass')).toBe(true);
    }
  });

  it('keeps the taste signal of rejected places visible so the trade off can be explained', async () => {
    const { service } = makeService();
    const view = await open(service, 's01-anniversary-venue-closed');
    const bestShortlisted = Math.min(
      ...view.shortlistIds.map(
        (id) => view.options.find((o) => o.candidate.id === id)?.providerTaste?.rank ?? Infinity,
      ),
    );
    const betterButRejected = view.options.filter(
      (o) => o.feasibility === 'rejected' && (o.providerTaste?.rank ?? Infinity) < bestShortlisted,
    );
    expect(betterButRejected.length).toBeGreaterThan(0);
    for (const option of betterButRejected) {
      expect(option.rejectionReasons.length).toBeGreaterThan(0);
      expect(option.providerTaste?.affinity).not.toBeNull();
    }
  });

  it('shows both orderings over the same pool and keeps affinity separate from the app score', async () => {
    const { service } = makeService();
    const view = await open(service, 's01-anniversary-venue-closed');
    expect(view.comparison).not.toBeNull();
    const eligible = view.options.filter((o) => o.feasibility !== 'rejected');
    expect(eligible.every((o) => o.tasteOn !== null && o.tasteOffPosition !== null)).toBe(true);
    const first = eligible.find((o) => o.tasteOn?.position === 1);
    expect(first?.tasteOn?.providerAffinity).not.toBeNull();
    expect(first?.tasteOn?.score.composite).not.toBe(first?.tasteOn?.providerAffinity);
    expect(view.scoreFormula).toContain('0.75');
  });

  it('refuses live mode when no key is configured', async () => {
    const { service } = makeService();
    const spec = scenario('s01-anniversary-venue-closed');
    await expect(
      service.openCase(SESSION, { mode: 'live', anchor: spec.anchor, disruption: spec.disruption }),
    ).rejects.toMatchObject({ code: 'live_unavailable', status: 503 });
  });

  it('refuses a city the demo catalogue does not cover', async () => {
    const { service } = makeService();
    const spec = scenario('s01-anniversary-venue-closed');
    await expect(
      service.openCase(SESSION, {
        mode: 'demo',
        anchor: { ...spec.anchor, city: 'Elsewhere' },
        disruption: spec.disruption,
      }),
    ).rejects.toMatchObject({ code: 'unsupported_city' });
  });

  it('rejects an invalid anchor with a readable message', async () => {
    const { service } = makeService();
    const spec = scenario('s01-anniversary-venue-closed');
    await expect(
      service.openCase(SESSION, {
        mode: 'demo',
        anchor: { ...spec.anchor, partySize: 0, tasteEntities: [], tasteTags: [] },
        disruption: spec.disruption,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('ambiguous signals', () => {
  it('waits for the person to choose and then searches', async () => {
    const { service } = makeService();
    const waiting = await open(service, 's00-jazz-needs-a-choice');
    expect(waiting.status).toBe('needs_choices');
    expect(waiting.run).toBeNull();
    expect(waiting.pendingChoices).toHaveLength(1);
    const pending = waiting.pendingChoices[0];
    expect(pending?.candidates?.map((c) => c.id)).toEqual(['sim-tag-jazz', 'sim-tag-jazz-genre']);

    await expect(
      service.recordDisruption(SESSION, 'case-1', { kind: 'running_late', minutes: 15 }),
    ).rejects.toMatchObject({
      code: 'choices_pending',
    });
    await expect(
      service.chooseResolution(SESSION, 'case-1', {
        key: pending?.key ?? '',
        chosenId: 'not-listed',
      }),
    ).rejects.toMatchObject({ code: 'invalid_choice' });

    const chosen = await service.chooseResolution(SESSION, 'case-1', {
      key: pending?.key ?? '',
      chosenId: 'sim-tag-jazz',
    });
    expect(chosen.status).toBe('recovering');
    expect(chosen.run?.appliedSignals.tagNames).toEqual(['jazz']);
    expect(chosen.resolutions.find((r) => r.kind === 'tag')?.method).toBe('user_choice');
  });

  it('lets the person skip a signal, leaving the search to run without it', async () => {
    const { service } = makeService();
    const spec = scenario('s00-jazz-needs-a-choice');
    const waiting = await service.openCase(SESSION, {
      mode: 'demo',
      anchor: { ...spec.anchor, useOriginalVenueAsSignal: false },
      disruption: spec.disruption,
    });
    const key = waiting.pendingChoices[0]?.key ?? '';
    const skipped = await service.chooseResolution(SESSION, 'case-1', { key, skip: true });
    expect(skipped.run?.tasteStatus).toBe('unavailable');
    expect(skipped.run?.tasteNote).toContain('No taste signal');
    expect(skipped.activeArm).toBe('taste_off');
  });

  it('still ranks by taste after a skip when the lost venue is a signal', async () => {
    const { service } = makeService();
    const waiting = await open(service, 's00-jazz-needs-a-choice');
    const key = waiting.pendingChoices[0]?.key ?? '';
    const skipped = await service.chooseResolution(SESSION, 'case-1', { key, skip: true });
    expect(skipped.run?.tasteStatus).toBe('applied');
    expect(skipped.run?.appliedSignals.lostVenue).toBe('Blue Hour Hall');
    expect(skipped.activeArm).toBe('taste_on');
  });
});

describe('degraded providers', () => {
  it('falls back to the practical baseline and says so when ranking fails', async () => {
    const provider = new FlakyProvider();
    provider.failRank = true;
    const { service } = makeService({ demo: provider });
    const view = await open(service, 's01-anniversary-venue-closed');
    expect(view.run?.tasteStatus).toBe('unavailable');
    expect(view.run?.tasteNote).toContain('QLOO_RATE_LIMIT');
    expect(view.activeArm).toBe('taste_off');
    expect(view.comparison).toBeNull();
    expect(view.shortlistIds.length).toBeGreaterThan(0);
  });

  it('records a failed search and recovers on retry', async () => {
    const provider = new FlakyProvider();
    provider.failPool = true;
    const { service } = makeService({ demo: provider });
    const failed = await open(service, 's01-anniversary-venue-closed');
    expect(failed.run).toBeNull();
    expect(failed.searchFailure?.code).toBe('QLOO_UPSTREAM');
    provider.failPool = false;
    const retried = await service.rerunSearch(SESSION, 'case-1');
    expect(retried.searchFailure).toBeNull();
    expect(retried.run?.poolSize).toBeGreaterThan(0);
  });
});

describe('the recovery loop', () => {
  it('re-gates the existing pool when an attempt fails, without calling the provider again', async () => {
    const provider = new FlakyProvider();
    const { service } = makeService({ demo: provider });
    const view = await open(service, 's01-anniversary-venue-closed');
    const before = { ...provider.calls };
    const top = view.shortlistIds[0] as string;
    const started = await service.startAttempt(SESSION, 'case-1', top);
    expect(started.status).toBe('attempting');
    expect(started.options.find((o) => o.candidate.id === top)?.state).toBe('attempted');

    const failed = await service.failAttempt(SESSION, 'case-1', top, 'Fully booked');
    expect(failed.status).toBe('recovering');
    expect(failed.options.find((o) => o.candidate.id === top)?.state).toBe('failed');
    expect(failed.shortlistIds).not.toContain(top);
    expect(failed.shortlistIds.length).toBeGreaterThan(0);
    expect(provider.calls.fetchPool).toBe(before.fetchPool);
    expect(provider.calls.rank).toBe(before.rank);
  });

  it('confirms only what was attempted and closes as recovered', async () => {
    const { service } = makeService();
    const view = await open(service, 's01-anniversary-venue-closed');
    const top = view.shortlistIds[0] as string;
    await expect(service.confirmAttempt(SESSION, 'case-1', top)).rejects.toMatchObject({
      code: 'not_attempted',
    });
    await expect(service.closeCase(SESSION, 'case-1', 'recovered')).rejects.toMatchObject({
      code: 'not_confirmed',
    });
    await service.startAttempt(SESSION, 'case-1', top);
    await expect(
      service.startAttempt(SESSION, 'case-1', view.shortlistIds[1] as string),
    ).rejects.toMatchObject({
      code: 'attempt_open',
    });
    const confirmed = await service.confirmAttempt(SESSION, 'case-1', top);
    expect(confirmed.status).toBe('recovered');
    const closed = await service.closeCase(SESSION, 'case-1', 'recovered');
    expect(closed.status).toBe('recovered');
    await expect(service.rejectOption(SESSION, 'case-1', top)).rejects.toMatchObject({
      code: 'case_closed',
    });
  });

  it('refuses to attempt an option that fails a hard constraint', async () => {
    const { service } = makeService();
    const view = await open(service, 's01-anniversary-venue-closed');
    const rejected = view.options.find((o) => o.feasibility === 'rejected');
    expect(rejected).toBeDefined();
    await expect(
      service.startAttempt(SESSION, 'case-1', rejected?.candidate.id ?? ''),
    ).rejects.toMatchObject({
      code: 'not_eligible',
    });
  });

  it('applies a second disruption on top of the first and searches again', async () => {
    const { service } = makeService();
    await open(service, 's01-anniversary-venue-closed');
    const view = await service.recordDisruption(SESSION, 'case-1', {
      kind: 'weather',
      condition: 'rain',
    });
    expect(view.runCount).toBe(2);
    expect(view.disruptions).toHaveLength(2);
    expect(view.plan.hardConstraints.some((c) => c.kind === 'covered_space')).toBe(true);
    for (const id of view.shortlistIds) {
      const option = view.options.find((o) => o.candidate.id === id);
      expect(option?.candidate.facts.covered).toMatchObject({ status: 'known', value: true });
    }
    // The anchor itself is unchanged by disruptions.
    expect(view.anchor.hardConstraints.some((c) => c.kind === 'covered_space')).toBe(false);
  });

  it('lets the person decline an option and removes it from the shortlist', async () => {
    const { service } = makeService();
    const view = await open(service, 's01-anniversary-venue-closed');
    const top = view.shortlistIds[0] as string;
    const declined = await service.rejectOption(SESSION, 'case-1', top, 'Too far for us');
    expect(declined.shortlistIds).not.toContain(top);
    expect(declined.options.find((o) => o.candidate.id === top)?.rejectionReasons[0]).toBe(
      'Too far for us',
    );
  });
});

describe('no feasible option', () => {
  it('offers relaxations, applies one only when the person agrees, and keeps the anchor', async () => {
    const { service } = makeService();
    const view = await open(service, 's10-no-feasible-option');
    expect(view.shortlistIds).toEqual([]);
    expect(view.relaxations.length).toBeGreaterThan(0);

    await expect(
      service.relaxConstraints(SESSION, 'case-1', ['step_free_access']),
    ).rejects.toMatchObject({
      code: 'not_offered',
    });

    const offered = view.relaxations[0];
    const relaxed = await service.relaxConstraints(
      SESSION,
      'case-1',
      offered?.constraintKeys ?? [],
    );
    expect([...relaxed.plan.relaxedConstraintKeys].sort()).toEqual(
      [...(offered?.constraintKeys ?? [])].sort(),
    );
    expect(relaxed.shortlistIds.length).toBeGreaterThan(0);
    expect(relaxed.anchor.hardConstraints).toEqual(view.anchor.hardConstraints);
    expect(relaxed.history.some((h) => h.kind === 'constraint_relaxed')).toBe(true);
  });
});

describe('unknown facts', () => {
  it('keeps options unverified until the person checks them, in either direction', async () => {
    const { service } = makeService();
    const view = await open(service, 's16-original-not-located');
    const waiting = view.options.filter((o) => o.feasibility === 'needs_verification');
    expect(waiting.length).toBeGreaterThan(0);
    expect(view.options.some((o) => o.feasibility === 'feasible')).toBe(false);
    const target = waiting[0];
    const question = target?.gate.verificationQuestions.find((q) => q.key === 'max_distance_km');
    expect(question).toBeDefined();

    const passed = await service.attestFact(SESSION, 'case-1', {
      candidateId: target?.candidate.id ?? '',
      constraintKey: 'max_distance_km',
      satisfied: true,
    });
    const afterPass = passed.options.find((o) => o.candidate.id === target?.candidate.id);
    expect(afterPass?.feasibility).toBe('feasible');
    expect(afterPass?.gate.verdicts.find((v) => v.key === 'max_distance_km')?.basis).toBe(
      'user_attested',
    );

    const failed = await service.attestFact(SESSION, 'case-1', {
      candidateId: target?.candidate.id ?? '',
      constraintKey: 'max_distance_km',
      satisfied: false,
    });
    expect(failed.options.find((o) => o.candidate.id === target?.candidate.id)?.feasibility).toBe(
      'rejected',
    );
  });

  it('refuses attestations for constraints that are not active', async () => {
    const { service } = makeService();
    const view = await open(service, 's01-anniversary-venue-closed');
    await expect(
      service.attestFact(SESSION, 'case-1', {
        candidateId: view.options[0]?.candidate.id ?? '',
        constraintKey: 'covered_space',
        satisfied: true,
      }),
    ).rejects.toMatchObject({ code: 'invalid_constraint' });
  });
});

describe('session isolation and provenance', () => {
  it('hides a case from other sessions', async () => {
    const { service } = makeService();
    await open(service, 's01-anniversary-venue-closed');
    expect(() => service.getCase('someone-else', 'case-1')).toThrowError(/not found/iu);
    expect(service.listCases('someone-else')).toEqual([]);
    expect(service.listCases(SESSION)).toHaveLength(1);
  });

  it('states exactly what was sent to the provider and what stayed local', async () => {
    const { service } = makeService();
    await open(service, 's01-anniversary-venue-closed');
    const provenance = service.getProvenance(SESSION, 'case-1');
    expect(provenance.sentToProvider.locationQuery).toBe('Harbourvale');
    expect(provenance.sentToProvider.entityNames).toEqual(['Odessa Vale']);
    expect(provenance.sentToProvider.originalVenueName).toBe('The Lantern Room');
    const serialised = JSON.stringify(provenance);
    expect(serialised).not.toContain('Anniversary dinner');
    expect(serialised).not.toContain('Candlelit and romantic');
    expect(provenance.calls.latestSearch.length).toBeGreaterThanOrEqual(0);
    expect(provenance.note).toContain('not a prediction');
  });

  it('sends nothing about the original venue when it is not a signal and no distance limit applies', async () => {
    const { service } = makeService();
    const spec = scenario('s02-vegan-date-budget');
    await service.openCase(SESSION, {
      mode: 'demo',
      anchor: { ...spec.anchor, useOriginalVenueAsSignal: false },
      disruption: spec.disruption,
    });
    expect(service.getProvenance(SESSION, 'case-1').sentToProvider.originalVenueName).toBeNull();
  });

  it('sends the original venue name when it is used as a taste signal', async () => {
    const { service } = makeService();
    await open(service, 's02-vegan-date-budget');
    expect(service.getProvenance(SESSION, 'case-1').sentToProvider.originalVenueName).toBe(
      'Umber & Oak',
    );
  });
});

describe('expiry', () => {
  it('purges expired cases', async () => {
    const { service, db } = makeService();
    await open(service, 's01-anniversary-venue-closed');
    db.sql.prepare("UPDATE cases SET expires_at = '2020-01-01T00:00:00Z'").run();
    expect(service.purgeExpired()).toBe(1);
    expect(service.listCases(SESSION)).toEqual([]);
  });
});

describe('the lost venue as a taste signal', () => {
  it('passes the lost venue to the ranking request next to the named signals', async () => {
    const provider = new FlakyProvider();
    const { service } = makeService({ demo: provider });
    const view = await open(service, 's01-anniversary-venue-closed');
    expect(view.run?.appliedSignals.lostVenue).toBe('The Lantern Room');
    expect(provider.lastRank?.entityIds).toEqual(['sim-ent-odessa-vale', 'sim-lantern-room']);
  });

  it('leaves the lost venue out of the ranking request when the person turned it off', async () => {
    const provider = new FlakyProvider();
    const { service } = makeService({ demo: provider });
    const spec = scenario('s01-anniversary-venue-closed');
    const view = await service.openCase(SESSION, {
      mode: 'demo',
      anchor: { ...spec.anchor, useOriginalVenueAsSignal: false },
      disruption: spec.disruption,
    });
    expect(view.run?.appliedSignals.lostVenue).toBeUndefined();
    expect(provider.lastRank?.entityIds).toEqual(['sim-ent-odessa-vale']);
  });

  it('accepts an anchor with only the lost venue as its taste signal', () => {
    const spec = scenario('s01-anniversary-venue-closed');
    const anchor = { ...spec.anchor, tasteEntities: [], tasteTags: [] };
    expect(intentAnchorInputSchema.safeParse(anchor).success).toBe(true);
    expect(
      intentAnchorInputSchema.safeParse({ ...anchor, useOriginalVenueAsSignal: false }).success,
    ).toBe(false);
  });

  it('never offers the lost venue as an option', async () => {
    const { service } = makeService();
    const view = await open(service, 's01-anniversary-venue-closed');
    const eligible = view.options.filter((o) => o.feasibility !== 'rejected');
    expect(eligible.some((o) => o.candidate.name === 'The Lantern Room')).toBe(false);
  });
});
