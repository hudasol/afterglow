import { useCallback, useEffect, useState } from 'react';
import type { CaseView } from '../../../src/domain/case-view.js';
import { constraintKey, describeConstraint } from '../../../src/domain/constraint-text.js';
import type { Disruption } from '../../../src/domain/plan.js';
import { ChoicePanel } from '../components/ChoicePanel';
import { DisruptionForm } from '../components/DisruptionForm';
import { Horizon } from '../components/Horizon';
import { Inspector } from '../components/Inspector';
import { OptionGroups } from '../components/OptionList';
import { RelaxationPanel } from '../components/RelaxationPanel';
import { SlopeChart, type SlopeBaseline } from '../components/SlopeChart';
import { SourceBanner } from '../components/SourceBanner';
import { Timeline } from '../components/Timeline';
import { useCaseActions } from '../components/useCaseActions';
import { api, ApiError } from '../lib/api';
import { formatDuration, formatPlanTime } from '../lib/format';
import { caseHref, go, type CaseTab } from '../lib/router';
import { ProvenanceTab } from './ProvenanceTab';
import { TraceTab } from './TraceTab';

const TAB_LABELS: Record<CaseTab, string> = {
  options: 'Options',
  trace: 'Agent trace',
  compare: 'Taste on and off',
  evidence: 'Evidence',
  history: 'History',
};

const STATUS_TEXT: Record<CaseView['status'], string> = {
  needs_choices: 'Waiting for your choice',
  anchored: 'Anchored',
  recovering: 'Options ready',
  attempting: 'Attempt under way',
  recovered: 'Recovered',
  abandoned: 'Closed without a recovery',
};

function AnchorSummary({ view }: { view: CaseView }) {
  const { anchor, plan } = view;
  const original = new Map(anchor.hardConstraints.map((c) => [constraintKey(c), c]));
  return (
    <details className="panel">
      <summary style={{ cursor: 'pointer', fontWeight: 650 }}>
        Your intent anchor and the current plan
      </summary>
      <dl className="anchor-summary" style={{ marginTop: '1rem' }}>
        <dt>Original plan</dt>
        <dd>
          {anchor.title} at {anchor.originalVenue.name}, {formatPlanTime(anchor.planStart)}, for{' '}
          {anchor.partySize} {anchor.partySize === 1 ? 'person' : 'people'},{' '}
          {formatDuration(anchor.durationMinutes)}
        </dd>
        <dt>What must survive</dt>
        <dd>
          <ul className="chip-list">
            {anchor.preserve.map((item) => (
              <li className="chip" key={item}>
                {item}
              </li>
            ))}
          </ul>
        </dd>
        <dt>Taste signals</dt>
        <dd>
          <ul className="chip-list">
            {[...anchor.tasteEntities, ...anchor.tasteTags].map((item) => (
              <li className="chip" key={item}>
                {item}
              </li>
            ))}
          </ul>
        </dd>
        <dt>What changed</dt>
        <dd>
          {view.disruptions.length === 0 ? (
            'Nothing yet.'
          ) : (
            <ul>
              {view.disruptions.map((d, index) => (
                <li key={`${d.kind}-${index}`}>{d.description}</li>
              ))}
            </ul>
          )}
        </dd>
        <dt>Requirements in force now</dt>
        <dd>
          {plan.hardConstraints.length === 0 ? (
            'None.'
          ) : (
            <ul>
              {plan.hardConstraints.map((c) => (
                <li key={constraintKey(c)}>{describeConstraint(c)}</li>
              ))}
            </ul>
          )}
        </dd>
        {plan.relaxedConstraintKeys.length > 0 ? (
          <>
            <dt>Requirements you agreed to give up</dt>
            <dd>
              <ul>
                {plan.relaxedConstraintKeys.map((key) => {
                  const constraint = original.get(key);
                  return <li key={key}>{constraint ? describeConstraint(constraint) : key}</li>;
                })}
              </ul>
            </dd>
          </>
        ) : null}
      </dl>
      <p className="small muted-text">
        The anchor above is never edited. Disruptions and your decisions are layered on top.
      </p>
    </details>
  );
}

function CompareTab({ view }: { view: CaseView }) {
  const [against, setAgainst] = useState<SlopeBaseline>('nearest');
  const comparison = view.comparison;
  if (!comparison) {
    const reason = !view.run
      ? 'No search has run yet.'
      : view.run.tasteStatus === 'unavailable'
        ? 'Taste ranking was not available for the latest search, so only the order without taste exists.'
        : 'Fewer than two places are eligible, so there is nothing to compare.';
    return (
      <div className="empty">
        <h2>Nothing to compare yet</h2>
        <p>{reason}</p>
      </div>
    );
  }
  const nameOf = (id: string) =>
    view.options.find((o) => o.candidate.id === id)?.candidate.name ?? id;
  const percent = (value: number | null) =>
    value === null ? 'not defined' : `${Math.round(value * 100)}%`;
  return (
    <div className="stack">
      <p className="lede" style={{ color: 'var(--ink-2)' }}>
        Every order uses the same places and the same gate. The only difference is the ordering
        rule. Nearest first sorts by distance, then price. Most popular first sorts by how popular
        each place is in general. With taste, places are sorted by the recovery score, which uses
        what this group likes.
      </p>
      {comparison.popular ? (
        <fieldset className="segmented">
          <legend className="visually-hidden">Compare taste with</legend>
          <span className="segmented-label" aria-hidden="true">
            Compare taste with
          </span>
          <label>
            <input
              type="radio"
              name="against"
              checked={against === 'nearest'}
              onChange={() => setAgainst('nearest')}
            />
            <span className="pill">Nearest first</span>
          </label>
          <label>
            <input
              type="radio"
              name="against"
              checked={against === 'popular'}
              onChange={() => setAgainst('popular')}
            />
            <span className="pill">Most popular first</span>
          </label>
        </fieldset>
      ) : null}
      <div className="compare-grid">
        <div className="panel">
          <SlopeChart view={view} baseline={comparison.popular ? against : 'nearest'} />
        </div>
        <dl className="stat-list panel">
          <div>
            <dt>Top choice changes with taste, against nearest first</dt>
            <dd>{comparison.topChoiceChanged ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt>Top three in common with nearest first</dt>
            <dd>{percent(comparison.overlapAt3)}</dd>
          </div>
          {comparison.popular ? (
            <>
              <div>
                <dt>Top choice changes with taste, against most popular</dt>
                <dd>{comparison.popular.topChoiceChanged ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt>Top three in common with most popular</dt>
                <dd>{percent(comparison.popular.overlapAt3)}</dd>
              </div>
            </>
          ) : null}
          <div>
            <dt>Order agreement with nearest first (Kendall tau)</dt>
            <dd>
              {comparison.kendallTau === null ? 'not defined' : comparison.kendallTau.toFixed(2)}
            </dd>
          </div>
        </dl>
      </div>
      <div className="form-grid">
        <section className="panel" aria-labelledby="top-off">
          <h2 id="top-off" style={{ fontSize: '1.2rem' }}>
            Top three, nearest first
          </h2>
          <ol>
            {comparison.tasteOffTopIds.map((id) => (
              <li key={id}>{nameOf(id)}</li>
            ))}
          </ol>
        </section>
        {comparison.popular ? (
          <section className="panel" aria-labelledby="top-popular">
            <h2 id="top-popular" style={{ fontSize: '1.2rem' }}>
              Top three, most popular first
            </h2>
            <ol>
              {comparison.popular.topIds.map((id) => (
                <li key={id}>{nameOf(id)}</li>
              ))}
            </ol>
          </section>
        ) : null}
        <section className="panel" aria-labelledby="top-on">
          <h2 id="top-on" style={{ fontSize: '1.2rem' }}>
            Top three with taste
          </h2>
          <ol>
            {comparison.tasteOnTopIds.map((id) => (
              <li key={id}>{nameOf(id)}</li>
            ))}
          </ol>
        </section>
      </div>
      <section className="panel" aria-labelledby="formula">
        <h2 id="formula" style={{ fontSize: '1.2rem' }}>
          How the recovery score works
        </h2>
        <p>{view.scoreFormula}</p>
        <p className="small muted-text" style={{ marginTop: '0.6rem' }}>
          {view.mode === 'demo'
            ? 'In demo mode the affinity comes from a simulated formula, so this comparison shows how the pipeline behaves, not how well Qloo predicts taste.'
            : 'Affinity describes what groups of people tend to like. It is not a prediction about anyone in your group, and the comparison does not prove that the taste order is better for you.'}
        </p>
      </section>
    </div>
  );
}

export function CaseScreen({ id, tab }: { id: string; tab: CaseTab }) {
  const [view, setView] = useState<CaseView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { busy, error, run } = useCaseActions(setView);

  useEffect(() => {
    let cancelled = false;
    api
      .getCase(id)
      .then((result) => {
        if (!cancelled) setView(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setLoadError(
            caught instanceof ApiError && caught.status === 404
              ? 'This case was not found. It may have expired or belong to a different browser.'
              : caught instanceof ApiError
                ? caught.message
                : 'The case could not be loaded.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const selectOption = useCallback((optionId: string) => {
    setSelectedId(optionId);
    // On a narrow screen the details sit below the list, so bring them into view.
    if (window.matchMedia('(max-width: 900px)').matches) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() =>
        document
          .getElementById('inspector')
          ?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }),
      );
    }
  }, []);

  const act = useCallback(
    (label: string, action: () => Promise<CaseView>) => void run(label, action),
    [run],
  );

  if (loadError) {
    return (
      <div className="empty">
        <h1 style={{ fontSize: '2rem' }}>Case unavailable</h1>
        <p>{loadError}</p>
        <a className="btn primary" href="#/cases">
          Back to your cases
        </a>
      </div>
    );
  }
  if (!view)
    return (
      <p className="muted-text" role="status">
        Loading the case.
      </p>
    );

  const closed = view.history.some((entry) => entry.kind === 'case_closed');
  const selected =
    view.options.find((o) => o.candidate.id === selectedId) ??
    view.options.find((o) => o.state !== 'rejected') ??
    view.options[0] ??
    null;
  const confirmedOption = view.options.find((o) => o.state === 'confirmed');
  const canAct = !closed;

  const onDisrupt = (disruption: Disruption) => act('disrupt', () => api.disrupt(id, disruption));

  return (
    <div>
      <div className="case-head">
        <div>
          <h1>{view.anchor.title}</h1>
          <p className="facts-line">
            {view.anchor.partySize} {view.anchor.partySize === 1 ? 'person' : 'people'},{' '}
            {formatPlanTime(view.plan.planStart)}, {view.anchor.city}. {STATUS_TEXT[view.status]}.
          </p>
        </div>
        <div className="button-row">
          {canAct && view.status === 'recovered' ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy !== null}
              onClick={() => act('close', () => api.close(id, 'recovered'))}
            >
              Close as recovered
            </button>
          ) : null}
          {canAct && view.status !== 'recovered' ? (
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => act('close', () => api.close(id, 'abandoned'))}
            >
              Close without a recovery
            </button>
          ) : null}
        </div>
      </div>

      <SourceBanner mode={view.mode} label={view.providerLabel} />
      <Horizon view={view} />

      <div role="status" aria-live="polite" className="visually-hidden">
        {busy ? 'Working' : ''}
      </div>
      {error ? (
        <p className="error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </p>
      ) : null}

      <nav className="tabs" aria-label="Case sections">
        {(Object.keys(TAB_LABELS) as CaseTab[]).map((key) => (
          <a
            key={key}
            href={caseHref(id, key)}
            {...(key === tab ? { 'aria-current': 'page' as const } : {})}
          >
            {TAB_LABELS[key]}
          </a>
        ))}
      </nav>

      {tab === 'options' ? (
        <div className="stack">
          <AnchorSummary view={view} />

          {view.pendingChoices.length > 0 ? (
            <ChoicePanel
              view={view}
              busy={busy !== null}
              onChoose={(key, chosenId) =>
                act('choose', () =>
                  api.choose(id, chosenId ? { key, chosenId } : { key, skip: true }),
                )
              }
            />
          ) : null}

          {view.searchFailure ? (
            <div className="callout bad" role="alert">
              <p>
                <strong>The search could not finish.</strong> {view.searchFailure.message}
              </p>
              <div className="button-row" style={{ marginTop: '0.6rem' }}>
                <button
                  type="button"
                  className="btn small"
                  disabled={busy !== null}
                  onClick={() => act('search', () => api.search(id))}
                >
                  Search again
                </button>
              </div>
            </div>
          ) : null}

          {view.run && view.run.tasteStatus !== 'applied' ? (
            <div className="callout warn" role="note">
              <strong>
                {view.run.tasteStatus === 'degraded'
                  ? 'Taste ranking was partly reduced.'
                  : 'Taste ranking was not available.'}
              </strong>{' '}
              {view.run.tasteNote ?? ''} Options are ordered by distance, then price, and the gate
              still applies in full.
            </div>
          ) : null}

          <RelaxationPanel
            view={view}
            busy={busy !== null}
            onRelax={(keys) => act('relax', () => api.relax(id, keys))}
          />

          {view.options.length > 0 ? (
            <div className="workspace">
              <div>
                <OptionGroups
                  view={view}
                  selectedId={selected?.candidate.id ?? null}
                  onSelect={selectOption}
                />
              </div>
              {selected ? (
                <Inspector
                  view={view}
                  option={selected}
                  busy={busy}
                  closed={closed}
                  onAttest={(candidateId, key, satisfied) =>
                    act('attest', () =>
                      api.attest(id, { candidateId, constraintKey: key, satisfied }),
                    )
                  }
                  onAttempt={(candidateId) => act('attempt', () => api.attempt(id, candidateId))}
                  onReject={(candidateId) => act('reject', () => api.reject(id, candidateId))}
                  onConfirm={(candidateId) => act('confirm', () => api.confirm(id, candidateId))}
                  onFail={(candidateId) => act('fail', () => api.fail(id, candidateId))}
                />
              ) : null}
            </div>
          ) : view.pendingChoices.length === 0 && !view.searchFailure ? (
            <p className="muted-text">No search results yet.</p>
          ) : null}

          {confirmedOption && !closed ? (
            <p className="callout" role="status">
              You confirmed {confirmedOption.candidate.name}. Close the case when you are ready, or
              keep exploring.
            </p>
          ) : null}

          {canAct && view.status !== 'abandoned' ? (
            <DisruptionForm
              busy={busy !== null}
              currentParty={view.plan.partySize}
              onSubmit={onDisrupt}
            />
          ) : null}
        </div>
      ) : null}

      {tab === 'trace' ? <TraceTab caseId={id} refreshKey={view.updatedAt} /> : null}
      {tab === 'compare' ? <CompareTab view={view} /> : null}
      {tab === 'evidence' ? <ProvenanceTab caseId={id} refreshKey={view.updatedAt} /> : null}
      {tab === 'history' ? (
        <div className="stack">
          <Timeline entries={view.history} />
          <div className="panel">
            <h2 style={{ fontSize: '1.2rem' }}>Remove this case</h2>
            <p className="small muted-text" style={{ margin: '0.4rem 0 0.8rem' }}>
              Deleting removes the case and its history from this server. It cannot be undone.
            </p>
            {confirmDelete ? (
              <div className="button-row">
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    api
                      .deleteCase(id)
                      .then(() => go('#/cases'))
                      .catch(() => setConfirmDelete(false));
                  }}
                >
                  Delete permanently
                </button>
                <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                  Keep the case
                </button>
              </div>
            ) : (
              <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>
                Delete this case
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
