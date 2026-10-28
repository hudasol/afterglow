import { describe, expect, it } from 'vitest';
import {
  BASELINE_SEED,
  GATED_ARMS,
  UNGATED_ARMS,
  evaluateBaselines,
  gatedLists,
  ungatedLists,
  TOP,
} from '../../src/evaluation/baselines.js';
import { openCaseView } from '../../src/evaluation/runner.js';
import { normaliseName } from '../../src/domain/venue.js';
import { SimulatedTasteProvider } from '../../src/simulation/provider.js';
import { scenarios } from '../../src/simulation/scenarios.js';

const provider = new SimulatedTasteProvider();
const spec = (id: string) => {
  const found = scenarios.find((s) => s.id === id);
  if (!found) throw new Error(`No scenario ${id}`);
  return found;
};

describe('baseline lists', () => {
  it('never put a place the gate rules out in a gated list', async () => {
    const opened = await openCaseView(provider, spec('s02-vegan-date-budget'));
    try {
      const lists = gatedLists(opened.view, BASELINE_SEED, 's02');
      for (const arm of GATED_ARMS) {
        for (const option of lists[arm]) expect(option.feasibility, arm).not.toBe('rejected');
      }
    } finally {
      opened.close();
    }
  });

  it('leave the venue that fell through out of the lists without the gate', async () => {
    const opened = await openCaseView(provider, spec('s01-anniversary-venue-closed'));
    try {
      const original = normaliseName(opened.view.anchor.originalVenue.name);
      const lists = ungatedLists(opened.view, BASELINE_SEED, 's01');
      for (const arm of UNGATED_ARMS) {
        expect(
          lists[arm].some((o) => normaliseName(o.candidate.name) === original),
          arm,
        ).toBe(false);
      }
    } finally {
      opened.close();
    }
  });

  it('order nearest first by distance and taste only by Qloo rank', async () => {
    const opened = await openCaseView(provider, spec('s02-vegan-date-budget'));
    try {
      const lists = ungatedLists(opened.view, BASELINE_SEED, 's02');
      const km = lists.nearest.map((o) => o.distanceKm ?? Infinity);
      expect(km).toEqual([...km].sort((a, b) => a - b));
      const ranks = lists.taste_only.map((o) => o.providerTaste?.rank ?? Infinity);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    } finally {
      opened.close();
    }
  });

  it('leave places without a known distance out of the nearest first list', async () => {
    const opened = await openCaseView(provider, spec('s02-vegan-date-budget'));
    try {
      const unlocated = {
        ...opened.view,
        options: opened.view.options.map((option) => ({ ...option, distanceKm: null })),
      };
      expect(gatedLists(unlocated, BASELINE_SEED, 's02').nearest).toEqual([]);
      expect(gatedLists(opened.view, BASELINE_SEED, 's02').nearest.length).toBeGreaterThan(0);
    } finally {
      opened.close();
    }
  });

  it('draw the same random list for the same seed and a different one for another seed', async () => {
    const opened = await openCaseView(provider, spec('s05-family-lunch-halal'));
    try {
      const names = (seed: number) =>
        ungatedLists(opened.view, seed, 'x').random.map((o) => o.candidate.id);
      expect(names(7)).toEqual(names(7));
      expect(names(7)).not.toEqual(names(8));
    } finally {
      opened.close();
    }
  });
});

describe('baseline measures', () => {
  it('find no requirement broken by AFTERGLOW on any scenario of the simulated catalogue', async () => {
    for (const s of scenarios) {
      const result = await evaluateBaselines(provider, s);
      expect(result.ok, `${s.id} completed`).toBe(true);
      if (result.eligible === 0) {
        // Nothing passed the gate, so there is no list to judge and none is offered.
        expect(result.gated.afterglow, `${s.id} offers nothing`).toBeNull();
        continue;
      }
      expect(result.gated.afterglow, s.id).not.toBeNull();
      expect(result.gated.afterglow?.violations, s.id).toBe(0);
      for (const arm of GATED_ARMS) {
        const list = result.gated[arm];
        // Only the nearest first list can be missing, when the original venue has no location.
        if (list === null) expect(arm, `${s.id} ${arm} is missing`).toBe('nearest');
        else expect(list.violations, `${s.id} ${arm}`).toBe(0);
      }
    }
  });

  it('find requirements broken by the plain recommenders where facts are known', async () => {
    const results = await Promise.all(scenarios.map((s) => evaluateBaselines(provider, s)));
    const broken = results.flatMap((r) =>
      UNGATED_ARMS.map((arm) => r.ungated[arm]?.violations ?? 0),
    );
    expect(broken.some((count) => count > 0)).toBe(true);
  });

  it('keep every list to three places and report coverage', async () => {
    const result = await evaluateBaselines(provider, spec('s05-family-lunch-halal'));
    expect(result.ok).toBe(true);
    for (const arm of GATED_ARMS) {
      expect(result.gated[arm]?.names.length ?? 0).toBeLessThanOrEqual(TOP);
    }
    expect(result.coverage.scoredShare).toBeGreaterThan(0);
    expect(result.coverage.scoredShare).toBeLessThanOrEqual(1);
  });

  it('report a failure when the case cannot be opened, without throwing', async () => {
    const result = await evaluateBaselines(provider, spec('s16-original-not-located'));
    expect(typeof result.ok).toBe('boolean');
    if (!result.ok) {
      expect(result.error).toBeTruthy();
      expect(result.gated.afterglow).toBeNull();
    }
  });
});
