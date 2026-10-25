import { RecoveryService } from '../application/recovery-service.js';
import { Database } from '../infrastructure/database.js';
import { SqliteCaseRepository } from '../infrastructure/sqlite-case-repository.js';
import { SimulatedTasteProvider } from '../simulation/provider.js';
import { SIMULATION_LABEL } from '../simulation/catalogue.js';
import { scenarios } from '../simulation/scenarios.js';
import { normaliseName } from '../domain/venue.js';

const SESSION = 'showcase-session-00000000000';
/** Chosen to show the gate at work: a plain top three breaks two requirements here. */
const SHOWCASE_SCENARIO = 's02-vegan-date-budget';

export interface ShowcaseEntry {
  name: string;
  /** Set when the gate ruled the place out. Copied from the gate, not written by hand. */
  ruledOutBecause: string | null;
  /** Set when the place passed but a fact still needs the person's check. */
  needsCheck: string | null;
  providerRank: number | null;
}

export interface Showcase {
  label: string;
  title: string;
  summary: string;
  disruption: string;
  /** The top three by provider rank with no gate, as a plain recommender would return them. */
  withoutGate: ShowcaseEntry[];
  /** The top three after the gate and the taste ordering. */
  afterglow: ShowcaseEntry[];
}

/**
 * Runs one simulated scenario end to end and reports what a plain ranked list would have shown
 * next to what AFTERGLOW offers. Everything here comes from the invented catalogue.
 */
export async function buildShowcase(): Promise<Showcase> {
  const spec = scenarios.find((scenario) => scenario.id === SHOWCASE_SCENARIO);
  if (!spec) throw new Error('The showcase scenario is missing.');
  const provider = new SimulatedTasteProvider();
  const db = new Database(':memory:');
  db.migrate(new URL('../../migrations', import.meta.url).pathname);
  try {
    const service = new RecoveryService({
      repo: new SqliteCaseRepository(db),
      providers: { demo: provider, live: provider },
      caseTtlHours: 1,
    });
    let view = await service.openCase(SESSION, {
      mode: 'demo',
      anchor: spec.anchor,
      disruption: spec.disruption,
    });
    for (const pending of view.pendingChoices) {
      const chosenId =
        spec.choices?.[normaliseName(pending.input)] ?? spec.choices?.[pending.input];
      view = await service.chooseResolution(SESSION, view.id, {
        key: pending.key,
        ...(chosenId ? { chosenId } : { skip: true }),
      });
    }
    const original = normaliseName(spec.anchor.originalVenue.name);
    const entry = (o: (typeof view.options)[number]): ShowcaseEntry => ({
      name: o.candidate.name,
      ruledOutBecause:
        o.feasibility === 'rejected'
          ? (o.rejectionReasons[0] ?? 'Ruled out by a requirement.')
          : null,
      needsCheck:
        o.feasibility === 'needs_verification'
          ? (o.gate.verificationQuestions[0]?.question ?? 'A fact needs your check.')
          : null,
      providerRank: o.providerTaste?.rank ?? null,
    });
    const withoutGate = view.options
      .filter((o) => o.providerTaste && normaliseName(o.candidate.name) !== original)
      .sort((a, b) => (a.providerTaste?.rank ?? 0) - (b.providerTaste?.rank ?? 0))
      .slice(0, 3)
      .map(entry);
    const afterglow = view.shortlistIds
      .map((id) => view.options.find((o) => o.candidate.id === id))
      .filter((o): o is NonNullable<typeof o> => o !== undefined)
      .map(entry);
    return {
      label: SIMULATION_LABEL,
      title: spec.title,
      summary: spec.summary,
      disruption: view.disruptions[0]?.description ?? '',
      withoutGate,
      afterglow,
    };
  } finally {
    db.close();
  }
}
