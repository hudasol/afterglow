import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { CaseMode } from '../../../src/domain/case.js';
import type {
  DietaryRequirement,
  HardConstraint,
  IntentAnchor,
  Occasion,
  VenueCategory,
} from '../../../src/domain/intent.js';
import {
  DisruptionFields,
  disruptionFrom,
  draftFrom,
  type DisruptionDraft,
} from '../components/DisruptionFields';
import { ListInput } from '../components/ListInput';
import { api, ApiError, type ScenarioPreset, type ServerStatus } from '../lib/api';
import { formatPlanTime, toLocalInput, toOffsetIso } from '../lib/format';
import { caseHref, go } from '../lib/router';

const OCCASIONS: { value: Occasion; label: string }[] = [
  { value: 'date', label: 'A date' },
  { value: 'friends', label: 'Friends' },
  { value: 'family', label: 'Family' },
  { value: 'celebration', label: 'A celebration' },
  { value: 'work', label: 'Work' },
  { value: 'solo', label: 'On my own' },
];

const CATEGORIES: { value: VenueCategory; label: string }[] = [
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'bar', label: 'Bar' },
  { value: 'cafe', label: 'Cafe' },
  { value: 'live_music', label: 'Live music' },
  { value: 'dessert', label: 'Dessert' },
  { value: 'museum_or_gallery', label: 'Museum or gallery' },
];

const DIETARY: { value: DietaryRequirement; label: string }[] = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'halal', label: 'Halal' },
  { value: 'kosher', label: 'Kosher' },
  { value: 'gluten_free', label: 'Gluten free' },
  { value: 'nut_free', label: 'Nut free' },
];

interface FormState {
  mode: CaseMode;
  title: string;
  occasion: Occasion;
  partySize: number;
  city: string;
  planStart: string;
  durationMinutes: number;
  category: VenueCategory;
  originalVenue: string;
  useOriginalVenueAsSignal: boolean;
  preserve: string[];
  entities: string[];
  tags: string[];
  distanceOn: boolean;
  distanceKm: number;
  priceOn: boolean;
  priceLevel: number;
  dietary: DietaryRequirement[];
  stepFree: boolean;
  openAtPlanTime: boolean;
  fitsParty: boolean;
  covered: boolean;
  disruption: DisruptionDraft;
}

function tomorrowEvening(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T19:30`;
}

function blankState(mode: CaseMode, demoCity: string): FormState {
  return {
    mode,
    title: '',
    occasion: 'friends',
    partySize: 2,
    city: mode === 'demo' ? demoCity : '',
    planStart: tomorrowEvening(),
    durationMinutes: 120,
    category: 'restaurant',
    originalVenue: '',
    useOriginalVenueAsSignal: true,
    preserve: [''],
    entities: [''],
    tags: [''],
    distanceOn: false,
    distanceKm: 3,
    priceOn: false,
    priceLevel: 3,
    dietary: [],
    stepFree: false,
    openAtPlanTime: false,
    fitsParty: false,
    covered: false,
    disruption: draftFrom(null, 2),
  };
}

function stateFromPreset(preset: ScenarioPreset): FormState {
  const a = preset.anchor;
  const find = <K extends HardConstraint['kind']>(kind: K) =>
    a.hardConstraints.find((c): c is Extract<HardConstraint, { kind: K }> => c.kind === kind);
  const distance = find('max_distance_km');
  const price = find('max_price_level');
  return {
    mode: 'demo',
    title: a.title,
    occasion: a.occasion,
    partySize: a.partySize,
    city: a.city,
    planStart: toLocalInput(a.planStart),
    durationMinutes: a.durationMinutes,
    category: a.category,
    originalVenue: a.originalVenue.name,
    useOriginalVenueAsSignal: a.useOriginalVenueAsSignal,
    preserve: a.preserve.length > 0 ? [...a.preserve] : [''],
    entities: a.tasteEntities.length > 0 ? [...a.tasteEntities] : [''],
    tags: a.tasteTags.length > 0 ? [...a.tasteTags] : [''],
    distanceOn: distance !== undefined,
    distanceKm: distance?.km ?? 3,
    priceOn: price !== undefined,
    priceLevel: price?.level ?? 3,
    dietary: a.hardConstraints.flatMap((c) => (c.kind === 'dietary' ? [c.requirement] : [])),
    stepFree: find('step_free_access') !== undefined,
    openAtPlanTime: find('open_at_plan_time') !== undefined,
    fitsParty: find('fits_party_size') !== undefined,
    covered: find('covered_space') !== undefined,
    disruption: draftFrom(preset.disruption, a.partySize),
  };
}

const clean = (values: string[]) => values.map((v) => v.trim()).filter((v) => v.length > 0);

function buildAnchor(state: FormState): { anchor?: IntentAnchor; problems: string[] } {
  const problems: string[] = [];
  const title = state.title.trim();
  const city = state.city.trim();
  const original = state.originalVenue.trim();
  const preserve = clean(state.preserve);
  const entities = clean(state.entities);
  const tags = clean(state.tags);
  if (title.length < 2) problems.push('Give the plan a short title.');
  if (city.length < 2) problems.push('Enter the city.');
  if (original.length < 2) problems.push('Enter the name of the original venue.');
  if (preserve.length === 0 || preserve.some((p) => p.length < 2)) {
    problems.push('Add at least one thing that must survive, in a few words.');
  }
  if (entities.length + tags.length === 0 && !state.useOriginalVenueAsSignal) {
    problems.push(
      'Add at least one name or vibe the group likes, or use the original venue as a signal, so the taste ranking has something to work with.',
    );
  }
  if (!Number.isInteger(state.partySize) || state.partySize < 1 || state.partySize > 30) {
    problems.push('Party size must be between 1 and 30.');
  }
  if (
    !Number.isInteger(state.durationMinutes) ||
    state.durationMinutes < 15 ||
    state.durationMinutes > 720
  ) {
    problems.push('Duration must be between 15 and 720 minutes.');
  }
  if (!state.planStart) problems.push('Choose when the plan starts.');
  if (state.distanceOn && !(state.distanceKm >= 0.1 && state.distanceKm <= 100)) {
    problems.push('The distance limit must be between 0.1 and 100 km.');
  }
  if (problems.length > 0) return { problems };

  const hardConstraints: HardConstraint[] = [];
  if (state.distanceOn) hardConstraints.push({ kind: 'max_distance_km', km: state.distanceKm });
  if (state.priceOn) hardConstraints.push({ kind: 'max_price_level', level: state.priceLevel });
  for (const requirement of state.dietary) hardConstraints.push({ kind: 'dietary', requirement });
  if (state.stepFree) hardConstraints.push({ kind: 'step_free_access' });
  if (state.openAtPlanTime) hardConstraints.push({ kind: 'open_at_plan_time' });
  if (state.fitsParty) hardConstraints.push({ kind: 'fits_party_size' });
  if (state.covered) hardConstraints.push({ kind: 'covered_space' });

  return {
    problems,
    anchor: {
      title,
      occasion: state.occasion,
      partySize: state.partySize,
      city,
      planStart: toOffsetIso(state.planStart),
      durationMinutes: state.durationMinutes,
      category: state.category,
      originalVenue: { name: original },
      useOriginalVenueAsSignal: state.useOriginalVenueAsSignal,
      preserve,
      tasteEntities: entities,
      tasteTags: tags,
      hardConstraints,
    },
  };
}

export function NewRecovery({
  status,
  scenarioId,
}: {
  status: ServerStatus | null;
  scenarioId: string | null;
}) {
  const demoCity = status?.modes.demo.cities[0] ?? 'Harbourvale';
  const liveReady = status?.modes.live.configured ?? false;
  const [state, setState] = useState<FormState>(() => blankState('demo', demoCity));
  const [presets, setPresets] = useState<ScenarioPreset[]>([]);
  const [presetId, setPresetId] = useState<string>('');
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .scenarios()
      .then((result) => {
        if (!cancelled) setPresets(result.scenarios);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply the preset named in the address once its details have loaded.
  const linkedPreset = scenarioId ? presets.find((p) => p.id === scenarioId) : undefined;
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null);
  if (linkedPreset && appliedPreset !== linkedPreset.id) {
    setAppliedPreset(linkedPreset.id);
    setState(stateFromPreset(linkedPreset));
    setPresetId(linkedPreset.id);
  }

  const patch = (partial: Partial<FormState>) =>
    setState((current) => ({ ...current, ...partial }));
  const demo = state.mode === 'demo';
  const sentSummary = useMemo(() => {
    const parts = [
      `the city (${state.city.trim() || 'not entered yet'})`,
      `the venue category (${state.category.replace('_', ' ')})`,
    ];
    const names = [...clean(state.entities), ...clean(state.tags)];
    parts.push(
      names.length > 0
        ? `the taste names and phrases (${names.join(', ')})`
        : 'the taste names and phrases you add',
    );
    if (state.useOriginalVenueAsSignal) {
      parts.push(
        state.distanceOn
          ? 'the original venue name, as a taste signal and to measure distance'
          : 'the original venue name, as a taste signal',
      );
    } else if (state.distanceOn) {
      parts.push('the original venue name, only to measure distance');
    }
    return parts.join(', ');
  }, [
    state.city,
    state.category,
    state.entities,
    state.tags,
    state.distanceOn,
    state.useOriginalVenueAsSignal,
  ]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const built = buildAnchor(state);
    if (!built.anchor) {
      setProblems(built.problems);
      return;
    }
    setProblems([]);
    setBusy(true);
    try {
      const view = await api.openCase({
        mode: state.mode,
        anchor: built.anchor,
        disruption: disruptionFrom(state.disruption),
      });
      go(caseHref(view.id));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'The case could not be opened. Try again.',
      );
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate aria-labelledby="new-title">
      <h1 id="new-title" style={{ fontSize: 'clamp(2rem, 4.5vw, 3rem)' }}>
        Start a recovery
      </h1>
      <p className="lede" style={{ color: 'var(--ink-2)', marginTop: '0.6rem' }}>
        Describe the plan once, as it was meant to be. AFTERGLOW records it as a fixed intent anchor
        and works from it for the rest of the case.
      </p>
      {status?.publicDemo ? (
        <p className="small muted-text" role="note" style={{ marginTop: '0.6rem' }}>
          This is a public demo. Cases are temporary and the server may erase them when it restarts.
          Please do not enter personal details.
        </p>
      ) : null}

      {problems.length > 0 ? (
        <div className="error" role="alert" style={{ marginTop: '1rem' }}>
          <p>Check these before continuing:</p>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section className="form-section" aria-labelledby="sec-source">
        <h2 id="sec-source">Where taste data comes from</h2>
        <div className="mode-choice" role="radiogroup" aria-labelledby="sec-source">
          <label>
            <input
              type="radio"
              name="mode"
              checked={demo}
              onChange={() => patch({ mode: 'demo', city: demoCity })}
            />
            <span>Simulated demo</span>
            <span className="desc">
              An invented city called {demoCity} with invented venues. Nothing is sent to Qloo and
              nothing describes a real place.
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              checked={!demo}
              disabled={!liveReady}
              onChange={() =>
                patch({ mode: 'live', city: state.city === demoCity ? '' : state.city })
              }
            />
            <span>Live Qloo</span>
            <span className="desc">
              {liveReady
                ? 'Real places and taste signals from the Qloo API. Facts Qloo does not supply stay unverified until you check them.'
                : 'Not available on this server because no Qloo API key is configured.'}
            </span>
          </label>
        </div>
        {demo && presets.length > 0 ? (
          <div className="field" style={{ marginTop: '1rem', maxWidth: '32rem' }}>
            <label htmlFor="preset">Start from an example</label>
            <select
              id="preset"
              value={presetId}
              onChange={(event) => {
                const preset = presets.find((p) => p.id === event.target.value);
                setPresetId(event.target.value);
                if (preset) setState(stateFromPreset(preset));
              }}
            >
              <option value="">Blank form</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.title}
                </option>
              ))}
            </select>
            <span className="hint">
              {presets.find((p) => p.id === presetId)?.summary ??
                'Fills in every field below. You can change any of it.'}
            </span>
          </div>
        ) : null}
        {!demo ? (
          <p className="callout" style={{ marginTop: '1rem' }}>
            Sent to Qloo: {sentSummary}. Kept on this server only: your title, party size, notes,
            times and requirements. Do not enter names of people you know.
          </p>
        ) : null}
      </section>

      <section className="form-section" aria-labelledby="sec-plan">
        <h2 id="sec-plan">The plan</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              type="text"
              value={state.title}
              maxLength={120}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="occasion">Occasion</label>
            <select
              id="occasion"
              value={state.occasion}
              onChange={(e) => patch({ occasion: e.target.value as Occasion })}
            >
              {OCCASIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="party">Party size</label>
            <input
              id="party"
              type="number"
              min={1}
              max={30}
              value={state.partySize}
              onChange={(e) => patch({ partySize: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="city">City</label>
            <input
              id="city"
              type="text"
              value={state.city}
              maxLength={80}
              readOnly={demo}
              aria-describedby="city-hint"
              onChange={(e) => patch({ city: e.target.value })}
            />
            <span className="hint" id="city-hint">
              {demo
                ? `The simulated demo only covers ${demoCity}.`
                : 'City or neighbourhood level only. Do not enter a street address.'}
            </span>
          </div>
          <div className="field">
            <label htmlFor="start">Starts at</label>
            <input
              id="start"
              type="datetime-local"
              value={state.planStart}
              onChange={(e) => patch({ planStart: e.target.value })}
            />
            {state.planStart ? (
              <span className="hint">{formatPlanTime(state.planStart)}</span>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="duration">Length in minutes</label>
            <input
              id="duration"
              type="number"
              min={15}
              max={720}
              step={15}
              value={state.durationMinutes}
              onChange={(e) => patch({ durationMinutes: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor="category">What kind of place</label>
            <select
              id="category"
              value={state.category}
              onChange={(e) => patch({ category: e.target.value as VenueCategory })}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="original">Original venue</label>
            <input
              id="original"
              type="text"
              value={state.originalVenue}
              maxLength={120}
              onChange={(e) => patch({ originalVenue: e.target.value })}
            />
          </div>
          <label className="check wide">
            <input
              type="checkbox"
              checked={state.useOriginalVenueAsSignal}
              onChange={(e) => patch({ useOriginalVenueAsSignal: e.target.checked })}
            />
            <span>
              Look for places that share this venue&rsquo;s audience. Its public name is sent to
              Qloo as a taste signal. Turn this off to send nothing about it.
            </span>
          </label>
        </div>
      </section>

      <section className="form-section" aria-labelledby="sec-preserve">
        <h2 id="sec-preserve">What must survive</h2>
        <p>
          The qualities that made this plan right, in your own words. They stay on this server and
          are never sent to Qloo.
        </p>
        <ListInput
          id="preserve"
          label="Qualities to keep"
          values={state.preserve}
          max={5}
          placeholder="For example: quiet enough to talk"
          addLabel="Add another quality"
          onChange={(preserve) => patch({ preserve })}
        />
      </section>

      <section className="form-section" aria-labelledby="sec-taste">
        <h2 id="sec-taste">What the group likes</h2>
        <p>
          Public names and vibes only, such as an artist, a film, a genre or a mood. Qloo describes
          what groups of people tend to like, so keep these general.
        </p>
        <div className="form-grid">
          <ListInput
            id="entities"
            label="Names the group likes"
            hint="Artists, films, books or well known places."
            values={state.entities}
            max={5}
            addLabel="Add another name"
            onChange={(entities) => patch({ entities })}
          />
          <ListInput
            id="tags"
            label="Vibes or genres"
            hint="For example: candlelit, jazz, garden."
            values={state.tags}
            max={5}
            addLabel="Add another vibe"
            onChange={(tags) => patch({ tags })}
          />
        </div>
      </section>

      <section className="form-section" aria-labelledby="sec-hard">
        <h2 id="sec-hard">Hard requirements</h2>
        <p>
          A place that fails any of these is ruled out, however well it matches the group&rsquo;s
          taste. When a fact is not known, the place is flagged for your check and never assumed to
          pass.
        </p>
        <div className="check-grid">
          <div className="check wide">
            <input
              id="hc-distance"
              type="checkbox"
              checked={state.distanceOn}
              onChange={(e) => patch({ distanceOn: e.target.checked })}
            />
            <label htmlFor="hc-distance">Within</label>
            <input
              type="number"
              min={0.1}
              max={100}
              step={0.5}
              value={state.distanceKm}
              disabled={!state.distanceOn}
              aria-label="Distance limit in kilometres"
              onChange={(e) => patch({ distanceKm: Number(e.target.value) })}
            />
            <span>km of the original venue</span>
          </div>
          <div className="check wide">
            <input
              id="hc-price"
              type="checkbox"
              checked={state.priceOn}
              onChange={(e) => patch({ priceOn: e.target.checked })}
            />
            <label htmlFor="hc-price">Price level at most</label>
            <select
              value={state.priceLevel}
              disabled={!state.priceOn}
              aria-label="Highest price level"
              onChange={(e) => patch({ priceLevel: Number(e.target.value) })}
            >
              {[1, 2, 3, 4].map((level) => (
                <option key={level} value={level}>
                  {level} of 4
                </option>
              ))}
            </select>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={state.stepFree}
              onChange={(e) => patch({ stepFree: e.target.checked })}
            />
            Step free access
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={state.openAtPlanTime}
              onChange={(e) => patch({ openAtPlanTime: e.target.checked })}
            />
            Open for the whole plan
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={state.fitsParty}
              onChange={(e) => patch({ fitsParty: e.target.checked })}
            />
            Can seat the whole party
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={state.covered}
              onChange={(e) => patch({ covered: e.target.checked })}
            />
            Covered or indoor space
          </label>
        </div>
        <fieldset className="field" style={{ marginTop: '1rem' }}>
          <legend>Dietary needs</legend>
          <div className="check-grid">
            {DIETARY.map((diet) => (
              <label className="check" key={diet.value}>
                <input
                  type="checkbox"
                  checked={state.dietary.includes(diet.value)}
                  onChange={(e) =>
                    patch({
                      dietary: e.target.checked
                        ? [...state.dietary, diet.value]
                        : state.dietary.filter((d) => d !== diet.value),
                    })
                  }
                />
                {diet.label}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="form-section" aria-labelledby="sec-disrupt">
        <h2 id="sec-disrupt">What went wrong</h2>
        <p>The disruption that starts the recovery. You can record more later.</p>
        <DisruptionFields
          idPrefix="first"
          draft={state.disruption}
          onChange={(disruption) => patch({ disruption })}
        />
      </section>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="button-row" style={{ marginTop: '1.5rem' }}>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Opening the case' : 'Open the case and find options'}
        </button>
        <a className="btn quiet" href="#/">
          Cancel
        </a>
      </div>
    </form>
  );
}
