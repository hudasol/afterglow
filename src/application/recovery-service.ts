import { randomBytes, randomUUID } from 'node:crypto';
import {
  deriveStatus,
  foldEvents,
  resolutionKey,
  type CallTrace,
  type CaseEvent,
  type CaseMode,
  type CaseState,
  type ResolvedRef,
  type ResolutionKind,
  type SearchRun,
  type StoredEvent,
  type TasteResolution,
} from '../domain/case.js';
import { buildCaseView, type CaseView } from '../domain/case-view.js';
import type { RelaxationOption } from '../domain/feasibility.js';
import {
  categoryTagPhrase,
  constraintKey,
  intentAnchorInputSchema,
  type IntentAnchor,
} from '../domain/intent.js';
import { factContextOf } from '../domain/fact-context.js';
import { checkOriginalVenue } from '../domain/original-venue.js';
import { deriveEffectivePlan, disruptionSchema } from '../domain/plan.js';
import { describeTasteCoverage } from '../domain/scoring.js';
import { buildTrace, type AgentTrace } from '../domain/trace.js';
import { normaliseName, type Candidate } from '../domain/venue.js';
import { AppError, statusForProviderCode } from './errors.js';
import {
  ProviderError,
  type PlaceFactsProvider,
  type ProviderContext,
  type TasteProvider,
} from './ports.js';
import { ConcurrencyError, type CaseRepository, type CaseSummary } from './repository.js';

export interface RecoveryServiceDeps {
  repo: CaseRepository;
  providers: Record<CaseMode, TasteProvider>;
  /** Optional second source for practical facts. Used for live cases only. */
  placeFacts?: PlaceFactsProvider;
  caseTtlHours: number;
  clock?: () => Date;
  newCaseId?: () => string;
  poolSize?: number;
}

export interface OpenCaseInput {
  mode: CaseMode;
  anchor: unknown;
  disruption: unknown;
}

export interface CaseListItem extends CaseSummary {
  status: CaseView['status'];
}

const MAX_TRACES = 60;

function appErrorFromProvider(error: unknown): AppError {
  if (error instanceof ProviderError) {
    return new AppError(error.code, error.message, statusForProviderCode(error.code));
  }
  return new AppError('provider_error', 'The taste provider could not be reached.', 502);
}

export class RecoveryService {
  readonly #repo: CaseRepository;
  readonly #providers: Record<CaseMode, TasteProvider>;
  readonly #clock: () => Date;
  readonly #newCaseId: () => string;
  readonly #ttlMs: number;
  readonly #poolSize: number;
  readonly #placeFacts: PlaceFactsProvider | undefined;
  readonly #locks = new Map<string, Promise<unknown>>();

  constructor(deps: RecoveryServiceDeps) {
    this.#repo = deps.repo;
    this.#providers = deps.providers;
    this.#clock = deps.clock ?? (() => new Date());
    this.#newCaseId = deps.newCaseId ?? randomUUID;
    this.#ttlMs = deps.caseTtlHours * 3_600_000;
    this.#poolSize = deps.poolSize ?? 40;
    this.#placeFacts = deps.placeFacts;
  }

  describeProviders(): Record<CaseMode, TasteProvider['descriptor']> {
    return { live: this.#providers.live.descriptor, demo: this.#providers.demo.descriptor };
  }

  // ---- reads ----------------------------------------------------------------------------

  getCase(sessionKey: string, caseId: string): CaseView {
    const { state, events } = this.#load(sessionKey, caseId);
    return buildCaseView(caseId, state, events);
  }

  listCases(sessionKey: string): CaseListItem[] {
    return this.#repo
      .list(sessionKey)
      .slice(0, 20)
      .flatMap((summary) => {
        const events = this.#repo.load(sessionKey, summary.id);
        if (!events) return [];
        return [{ ...summary, status: deriveStatus(foldEvents(events)) }];
      });
  }

  deleteCase(sessionKey: string, caseId: string): void {
    if (!this.#repo.remove(sessionKey, caseId))
      throw new AppError('not_found', 'Case not found.', 404);
  }

  purgeExpired(): number {
    return this.#repo.purgeExpired(this.#clock().toISOString());
  }

  /** What the agent observed, planned, did and decided in each cycle, rebuilt from the events. */
  getTrace(sessionKey: string, caseId: string): AgentTrace {
    const { events } = this.#load(sessionKey, caseId);
    return buildTrace(caseId, events);
  }

  /** The redacted request to result explanation. It lists what left the server and what came back. */
  getProvenance(sessionKey: string, caseId: string) {
    const { state, events } = this.#load(sessionKey, caseId);
    const view = buildCaseView(caseId, state, events);
    const run = view.run;
    const anchor = state.opened.anchor;
    const originalLookedUp = Object.values(state.resolutions).some(
      (r) => r.kind === 'original_venue',
    );
    return {
      caseId,
      generatedAt: this.#clock().toISOString(),
      mode: state.opened.mode,
      providerLabel: state.opened.providerLabel,
      sentToProvider: {
        locationQuery: anchor.city,
        categoryPhrase: categoryTagPhrase[anchor.category],
        entityNames: anchor.tasteEntities,
        tagPhrases: anchor.tasteTags,
        originalVenueName: originalLookedUp ? anchor.originalVenue.name : null,
      },
      sentToPlaceFacts: run?.placeFacts
        ? {
            source: 'OpenStreetMap, through the public Overpass API',
            sent: 'The public coordinates of venues that Qloo returned. Nothing else.',
            places: run.placeFacts.looked,
          }
        : null,
      keptLocal: [
        'Case title and the statements of what to preserve',
        'Party size, dates and times',
        'Hard constraints, which are applied by this application',
        'Whether you checked a fact or declined an option',
      ],
      choices: view.resolutions.map((resolution) => ({
        kind: resolution.kind,
        input: resolution.input,
        status: resolution.status,
        selected: resolution.selected
          ? { id: resolution.selected.id, name: resolution.selected.name }
          : null,
        method: resolution.method ?? null,
        alsoUsed: (resolution.alsoUsed ?? []).map((ref) => ({ id: ref.id, name: ref.name })),
        alternativesConsidered: (resolution.candidates ?? []).map((c) => ({
          id: c.id,
          name: c.name,
        })),
      })),
      calls: { resolution: view.resolutionTraces, latestSearch: run?.traces ?? [] },
      result: run
        ? {
            runId: run.runId,
            poolSize: run.poolSize,
            tasteStatus: run.tasteStatus,
            tasteNote: run.tasteNote,
            placeFacts: run.placeFacts,
            exemplars: run.appliedSignals.exemplars ?? [],
            shortlist: view.options
              .filter((option) => view.shortlistIds.includes(option.candidate.id))
              .map((option) => ({
                name: option.candidate.name,
                providerRank: option.tasteOn?.providerRank ?? null,
                providerAffinity: option.tasteOn?.providerAffinity ?? null,
                feasibility: option.feasibility,
              })),
          }
        : null,
      note: 'Provider affinity describes what groups tend to like. It is not a prediction about any individual.',
    };
  }

  // ---- writes ---------------------------------------------------------------------------

  async openCase(sessionKey: string, input: OpenCaseInput): Promise<CaseView> {
    const provider = this.#providers[input.mode];
    if (!provider.descriptor.configured) {
      throw new AppError(
        'live_unavailable',
        'Live mode needs a Qloo API key on the server. Use the labelled demo mode, or configure a key.',
        503,
      );
    }
    const anchorResult = intentAnchorInputSchema.safeParse(input.anchor);
    if (!anchorResult.success) {
      throw new AppError('invalid_request', describeIssues(anchorResult.error.issues), 400);
    }
    const disruptionResult = disruptionSchema.safeParse(input.disruption);
    if (!disruptionResult.success) {
      throw new AppError('invalid_request', describeIssues(disruptionResult.error.issues), 400);
    }
    const anchor = anchorResult.data;
    const supported = provider.descriptor.supportedCities;
    if (supported && !supported.map(normaliseName).includes(normaliseName(anchor.city))) {
      throw new AppError(
        'unsupported_city',
        `The demo catalogue only covers ${supported.join(', ')}. Change the city, or use live mode.`,
        400,
      );
    }

    const resolved = await this.#resolveSignals(provider, anchor);
    const now = this.#clock();
    const at = now.toISOString();
    const caseId = this.#newCaseId();
    const events: CaseEvent[] = [
      {
        type: 'case_opened',
        anchor,
        mode: input.mode,
        providerLabel: provider.descriptor.label,
      },
      ...resolved.map((entry): CaseEvent => ({
        type: 'taste_resolution_recorded',
        resolution: entry.resolution,
        traces: entry.traces,
      })),
      { type: 'disruption_recorded', disruption: disruptionResult.data },
    ];
    this.#repo.create({
      id: caseId,
      sessionKey,
      mode: input.mode,
      title: anchor.title,
      at,
      expiresAt: new Date(now.getTime() + this.#ttlMs).toISOString(),
      events,
    });

    return this.#withLock(caseId, async () => {
      const loaded = this.#load(sessionKey, caseId);
      if (deriveStatus(loaded.state) !== 'needs_choices') {
        await this.#appendSearch(caseId, loaded, 'case_opened');
      }
      return this.getCase(sessionKey, caseId);
    });
  }

  chooseResolution(
    sessionKey: string,
    caseId: string,
    input: { key: string; chosenId?: string; skip?: boolean },
  ): Promise<CaseView> {
    return this.#withLock(caseId, async () => {
      const loaded = this.#load(sessionKey, caseId);
      this.#assertOpen(loaded.state);
      const resolution = loaded.state.resolutions[input.key];
      if (resolution?.status !== 'ambiguous') {
        throw new AppError('not_pending', 'That signal does not need a choice.', 409);
      }
      let event: CaseEvent;
      if (input.skip) {
        event = {
          type: 'taste_resolution_recorded',
          resolution: {
            kind: resolution.kind,
            input: resolution.input,
            status: 'not_found',
            warnings: ['Skipped by you.'],
          },
        };
      } else {
        const chosen = resolution.candidates?.find((candidate) => candidate.id === input.chosenId);
        if (!chosen) throw new AppError('invalid_choice', 'Choose one of the listed entries.', 400);
        event = { type: 'taste_choice_made', key: input.key, chosen };
      }
      this.#append(caseId, loaded, [event]);
      const next = this.#load(sessionKey, caseId);
      if (
        deriveStatus(next.state) !== 'needs_choices' &&
        next.state.runs.length === 0 &&
        next.state.disruptions.length > 0
      ) {
        await this.#appendSearch(caseId, next, 'case_opened');
      }
      return this.getCase(sessionKey, caseId);
    });
  }

  recordDisruption(sessionKey: string, caseId: string, raw: unknown): Promise<CaseView> {
    const parsed = disruptionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('invalid_request', describeIssues(parsed.error.issues), 400);
    }
    return this.#withLock(caseId, async () => {
      const loaded = this.#load(sessionKey, caseId);
      this.#assertOpen(loaded.state);
      this.#assertNoPendingChoices(loaded.state);
      this.#append(caseId, loaded, [{ type: 'disruption_recorded', disruption: parsed.data }]);
      await this.#appendSearch(caseId, this.#load(sessionKey, caseId), 'disruption');
      return this.getCase(sessionKey, caseId);
    });
  }

  rerunSearch(sessionKey: string, caseId: string): Promise<CaseView> {
    return this.#withLock(caseId, async () => {
      const loaded = this.#load(sessionKey, caseId);
      this.#assertOpen(loaded.state);
      this.#assertNoPendingChoices(loaded.state);
      if (loaded.state.disruptions.length === 0) {
        throw new AppError('no_disruption', 'Record what went wrong before searching.', 409);
      }
      await this.#appendSearch(caseId, loaded, 'manual');
      return this.getCase(sessionKey, caseId);
    });
  }

  attestFact(
    sessionKey: string,
    caseId: string,
    input: { candidateId: string; constraintKey: string; satisfied: boolean },
  ): Promise<CaseView> {
    return this.#withLock(caseId, async () => {
      const loaded = this.#load(sessionKey, caseId);
      this.#assertOpen(loaded.state);
      const { candidate, view } = this.#candidateInPool(loaded, caseId, input.candidateId);
      const activeKeys = view.plan.hardConstraints.map(constraintKey);
      if (!activeKeys.includes(input.constraintKey)) {
        throw new AppError(
          'invalid_constraint',
          'That constraint is not active for this case.',
          400,
        );
      }
      if (loaded.state.attempts[candidate.id] === 'confirmed') {
        throw new AppError('already_confirmed', 'This option is already confirmed.', 409);
      }
      this.#append(caseId, loaded, [
        {
          type: 'fact_attested',
          candidateId: candidate.id,
          constraintKey: input.constraintKey,
          attestation: { satisfied: input.satisfied, at: this.#clock().toISOString() },
        },
      ]);
      return this.getCase(sessionKey, caseId);
    });
  }

  relaxConstraints(sessionKey: string, caseId: string, keys: string[]): Promise<CaseView> {
    return this.#withLock(caseId, async () => {
      const loaded = this.#load(sessionKey, caseId);
      this.#assertOpen(loaded.state);
      const view = buildCaseView(caseId, loaded.state, loaded.events);
      const wanted = [...new Set(keys)].sort().join('|');
      const offered: RelaxationOption | undefined = view.relaxations.find(
        (option) => [...option.constraintKeys].sort().join('|') === wanted,
      );
      if (!offered) {
        throw new AppError(
          'not_offered',
          'A constraint can only be given up when no option is left and that exact change was offered.',
          409,
        );
      }
      this.#append(
        caseId,
        loaded,
        offered.constraintKeys.map((constraintKey): CaseEvent => ({
          type: 'constraint_relaxed',
          constraintKey,
        })),
      );
      return this.getCase(sessionKey, caseId);
    });
  }

  rejectOption(
    sessionKey: string,
    caseId: string,
    candidateId: string,
    reason?: string,
  ): Promise<CaseView> {
    return this.#withLock(caseId, async () => {
      const loaded = this.#load(sessionKey, caseId);
      this.#assertOpen(loaded.state);
      const { candidate } = this.#candidateInPool(loaded, caseId, candidateId);
      if (
        loaded.state.attempts[candidate.id] === 'attempted' ||
        loaded.state.attempts[candidate.id] === 'confirmed'
      ) {
        throw new AppError(
          'in_progress',
          'Mark the attempt as failed before declining this option.',
          409,
        );
      }
      this.#append(caseId, loaded, [
        {
          type: 'option_rejected',
          candidateId: candidate.id,
          ...(reason ? { reason: reason.slice(0, 200) } : {}),
        },
      ]);
      return this.getCase(sessionKey, caseId);
    });
  }

  startAttempt(sessionKey: string, caseId: string, candidateId: string): Promise<CaseView> {
    return this.#withLock(caseId, async () => {
      const loaded = this.#load(sessionKey, caseId);
      this.#assertOpen(loaded.state);
      const view = buildCaseView(caseId, loaded.state, loaded.events);
      const option = view.options.find((entry) => entry.candidate.id === candidateId);
      if (!option)
        throw new AppError('not_found', 'That option is not in the current search.', 404);
      if (option.feasibility === 'rejected' || option.state === 'failed') {
        throw new AppError(
          'not_eligible',
          'That option fails a hard constraint or was ruled out.',
          409,
        );
      }
      if (Object.values(loaded.state.attempts).includes('attempted')) {
        throw new AppError('attempt_open', 'Finish or fail the current attempt first.', 409);
      }
      this.#append(caseId, loaded, [{ type: 'attempt_started', candidateId }]);
      return this.getCase(sessionKey, caseId);
    });
  }

  confirmAttempt(sessionKey: string, caseId: string, candidateId: string): Promise<CaseView> {
    return this.#resolveAttempt(sessionKey, caseId, candidateId, {
      type: 'attempt_confirmed',
      candidateId,
    });
  }

  failAttempt(
    sessionKey: string,
    caseId: string,
    candidateId: string,
    note?: string,
  ): Promise<CaseView> {
    return this.#resolveAttempt(sessionKey, caseId, candidateId, {
      type: 'attempt_failed',
      candidateId,
      ...(note ? { note: note.slice(0, 200) } : {}),
    });
  }

  closeCase(
    sessionKey: string,
    caseId: string,
    outcome: 'recovered' | 'abandoned',
  ): Promise<CaseView> {
    return this.#withLock(caseId, async () => {
      const loaded = this.#load(sessionKey, caseId);
      this.#assertOpen(loaded.state);
      const confirmed = Object.values(loaded.state.attempts).includes('confirmed');
      if (outcome === 'recovered' && !confirmed) {
        throw new AppError(
          'not_confirmed',
          'Confirm an option before closing the case as recovered.',
          409,
        );
      }
      this.#append(caseId, loaded, [{ type: 'case_closed', outcome }]);
      return this.getCase(sessionKey, caseId);
    });
  }

  // ---- internals ------------------------------------------------------------------------

  #resolveAttempt(
    sessionKey: string,
    caseId: string,
    candidateId: string,
    event: Extract<CaseEvent, { type: 'attempt_confirmed' | 'attempt_failed' }>,
  ): Promise<CaseView> {
    return this.#withLock(caseId, async () => {
      const loaded = this.#load(sessionKey, caseId);
      this.#assertOpen(loaded.state);
      if (loaded.state.attempts[candidateId] !== 'attempted') {
        throw new AppError('not_attempted', 'Start an attempt on this option first.', 409);
      }
      this.#append(caseId, loaded, [event]);
      return this.getCase(sessionKey, caseId);
    });
  }

  #assertOpen(state: CaseState): void {
    if (state.closed) throw new AppError('case_closed', 'This case is closed.', 409);
  }

  #assertNoPendingChoices(state: CaseState): void {
    if (deriveStatus(state) === 'needs_choices') {
      throw new AppError('choices_pending', 'Resolve the ambiguous signals first.', 409);
    }
  }

  #load(sessionKey: string, caseId: string): { state: CaseState; events: StoredEvent[] } {
    const events = this.#repo.load(sessionKey, caseId);
    if (!events || events.length === 0) throw new AppError('not_found', 'Case not found.', 404);
    return { state: foldEvents(events), events };
  }

  #append(caseId: string, loaded: { events: StoredEvent[] }, events: CaseEvent[]): void {
    try {
      this.#repo.append(caseId, loaded.events.length, this.#clock().toISOString(), events);
    } catch (error) {
      if (error instanceof ConcurrencyError) throw new AppError('conflict', error.message, 409);
      throw error;
    }
  }

  #candidateInPool(
    loaded: { state: CaseState; events: StoredEvent[] },
    caseId: string,
    candidateId: string,
  ): { candidate: Candidate; view: CaseView } {
    const view = buildCaseView(caseId, loaded.state, loaded.events);
    const option = view.options.find((entry) => entry.candidate.id === candidateId);
    if (!option) throw new AppError('not_found', 'That option is not in the current search.', 404);
    return { candidate: option.candidate, view };
  }

  async #withLock<T>(caseId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(caseId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    const tail = run.catch(() => undefined);
    this.#locks.set(caseId, tail);
    try {
      return await run;
    } finally {
      if (this.#locks.get(caseId) === tail) this.#locks.delete(caseId);
    }
  }

  async #resolveSignals(
    provider: TasteProvider,
    anchor: IntentAnchor,
  ): Promise<{ resolution: TasteResolution; traces: CallTrace[] }[]> {
    const wants: { kind: ResolutionKind; input: string }[] = [];
    const seen = new Set<string>();
    const add = (kind: ResolutionKind, input: string) => {
      const key = resolutionKey(kind, input);
      if (!seen.has(key)) {
        seen.add(key);
        wants.push({ kind, input });
      }
    };
    anchor.tasteEntities.forEach((name) => add('entity', name));
    anchor.tasteTags.forEach((name) => add('tag', name));
    add('category', categoryTagPhrase[anchor.category]);
    // The original venue is looked up when it is a taste signal, or when a distance limit needs its
    // location. Otherwise nothing about it is sent.
    if (
      anchor.useOriginalVenueAsSignal ||
      anchor.hardConstraints.some((constraint) => constraint.kind === 'max_distance_km')
    ) {
      add('original_venue', anchor.originalVenue.name);
    }

    try {
      return await Promise.all(
        wants.map(async ({ kind, input }) => {
          const traces: CallTrace[] = [];
          const ctx: ProviderContext = { traces, city: anchor.city };
          const resolution = await provider.resolve(kind, input, ctx);
          return { resolution, traces };
        }),
      );
    } catch (error) {
      throw appErrorFromProvider(error);
    }
  }

  async #appendSearch(
    caseId: string,
    loaded: { state: CaseState; events: StoredEvent[] },
    trigger: SearchRun['trigger'],
  ): Promise<void> {
    const events = await this.#runSearch(loaded.state, trigger);
    this.#append(caseId, loaded, events);
  }

  /**
   * Asks the second source for the facts the plan depends on. It never throws: when the lookup
   * fails the pool comes back unchanged and the summary says so, so the person is asked instead.
   * It records its calls separately so that they stay in a fixed order next to the taste calls.
   */
  async #lookUpPlaceFacts(
    state: CaseState,
    pool: Candidate[],
  ): Promise<{ pool: Candidate[]; summary: SearchRun['placeFacts']; traces: CallTrace[] }> {
    const traces: CallTrace[] = [];
    if (state.opened.mode !== 'live' || !this.#placeFacts || pool.length === 0) {
      return { pool, summary: undefined, traces };
    }
    const plan = deriveEffectivePlan(state.opened.anchor, state.disruptions, state.relaxedKeys);
    try {
      const enriched = await this.#placeFacts.enrich(pool, plan, {
        traces,
        city: state.opened.anchor.city,
      });
      return {
        pool: enriched.candidates,
        traces,
        summary:
          enriched.looked > 0
            ? {
                source: 'openstreetmap',
                looked: enriched.looked,
                matched: enriched.matched,
                filled: enriched.filled,
                ...(enriched.note ? { note: enriched.note } : {}),
              }
            : undefined,
      };
    } catch {
      return {
        pool,
        traces,
        summary: {
          source: 'openstreetmap',
          looked: 0,
          matched: 0,
          filled: 0,
          note: 'The place facts lookup failed. Facts that depend on it stay unknown.',
        },
      };
    }
  }

  async #runSearch(state: CaseState, trigger: SearchRun['trigger']): Promise<CaseEvent[]> {
    const provider = this.#providers[state.opened.mode];
    const anchor = state.opened.anchor;
    const runId = `run_${randomBytes(4).toString('hex')}`;
    const traces: CallTrace[] = [];
    const ctx: ProviderContext = { traces, city: anchor.city };

    // The entry the person or the matcher settled on comes first for every phrase, then the other
    // tags that share its name. The provider may only be able to use the first few.
    const selected = (kind: ResolutionKind): ResolvedRef[] => {
      const resolved = Object.values(state.resolutions).filter(
        (resolution) =>
          resolution.kind === kind && resolution.status === 'resolved' && resolution.selected,
      );
      return [
        ...resolved.map((resolution) => resolution.selected as ResolvedRef),
        ...resolved.flatMap((resolution) => resolution.alsoUsed ?? []),
      ];
    };
    const entities = selected('entity');
    const tags = selected('tag');
    const category = selected('category')[0];

    let pool: Candidate[];
    try {
      pool = await provider.fetchPool(
        {
          city: anchor.city,
          take: this.#poolSize,
          ...(category ? { categoryTagId: category.id } : {}),
          facts: factContextOf(deriveEffectivePlan(anchor, state.disruptions, state.relaxedKeys)),
        },
        ctx,
      );
    } catch (error) {
      const failure = appErrorFromProvider(error);
      return [{ type: 'search_failed', runId, code: failure.code, message: failure.message }];
    }

    // The venue that fell through is a signal of its own: places that share its audience. A name
    // search is not limited to the city, so the entry is checked against the places found there.
    const venueCheck = checkOriginalVenue({
      selected: selected('original_venue')[0],
      venueName: anchor.originalVenue.name,
      city: anchor.city,
      pool,
    });
    const lostVenue = anchor.useOriginalVenueAsSignal ? (venueCheck.ref ?? undefined) : undefined;

    // Practical facts the taste provider does not supply come from a second, labelled source. It
    // does not depend on the taste ranking, so both run at once and the search waits for the slower.
    const factsTask = this.#lookUpPlaceFacts(state, pool);

    let tasteScores: SearchRun['tasteScores'] = null;
    let tasteStatus: SearchRun['tasteStatus'] = 'unavailable';
    let tasteNote: string | undefined;
    // Only the tags that were sent count as applied, so the Evidence tab never claims more.
    let appliedTags: ResolvedRef[] = [];
    let exemplars: NonNullable<SearchRun['appliedSignals']['exemplars']> = [];

    if (pool.length === 0) {
      tasteNote = 'The provider returned no places for this city and category.';
    } else if (entities.length + tags.length + (lostVenue ? 1 : 0) === 0) {
      tasteNote = 'No taste signal could be resolved, so only the practical baseline is shown.';
    } else {
      try {
        const ranked = await provider.rank(
          {
            city: anchor.city,
            candidateIds: pool.map((candidate) => candidate.id),
            entityIds: [...entities, ...(lostVenue ? [lostVenue] : [])].map((entity) => entity.id),
            tagIds: tags.map((tag) => tag.id),
          },
          ctx,
        );
        appliedTags = ranked.appliedTagIds
          ? tags.filter((tag) => ranked.appliedTagIds?.includes(tag.id))
          : tags;
        exemplars = (ranked.exemplars ?? []).flatMap((set) => {
          const tag = tags.find((candidate) => candidate.id === set.tagId);
          return tag ? [{ tag: tag.name, places: set.places.map((place) => place.name) }] : [];
        });
        if (ranked.scores.length === 0) {
          tasteNote =
            'The provider returned no taste scores for these places, so only the practical baseline is shown.';
        } else {
          tasteScores = ranked.scores;
          tasteStatus = ranked.degradedNote ? 'degraded' : 'applied';
          tasteNote =
            [ranked.degradedNote, describeTasteCoverage(ranked.scores, pool.length)]
              .filter(Boolean)
              .join(' ') || undefined;
        }
      } catch (error) {
        const failure = appErrorFromProvider(error);
        tasteNote = `Taste ranking was unavailable (${failure.code}). Only the practical baseline is shown.`;
      }
    }

    if (venueCheck.note) {
      tasteNote = [tasteNote, venueCheck.note].filter(Boolean).join(' ').slice(0, 500);
    }

    const facts = await factsTask;
    pool = facts.pool;
    traces.push(...facts.traces);
    const placeFacts = facts.summary;

    const run: SearchRun = {
      runId,
      at: this.#clock().toISOString(),
      trigger,
      pool,
      tasteScores,
      tasteStatus,
      ...(tasteNote ? { tasteNote } : {}),
      ...(placeFacts ? { placeFacts } : {}),
      appliedSignals: {
        entityNames: entities.map((entity) => entity.name),
        tagNames: [...new Set(appliedTags.map((tag) => tag.name))],
        ...(category ? { categoryTag: category.name } : {}),
        ...(lostVenue ? { lostVenue: lostVenue.name } : {}),
        ...(exemplars.length > 0 ? { exemplars } : {}),
        location: anchor.city,
      },
      traces: traces.slice(0, MAX_TRACES),
    };
    return [{ type: 'search_completed', run }];
  }
}

function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.map(String).join('.')}: ${issue.message}`
        : issue.message,
    )
    .join('; ');
}
