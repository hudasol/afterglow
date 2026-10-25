import type { CaseView, OptionView } from '../../../src/domain/case-view.js';
import type { Fact } from '../../../src/domain/evidence.js';
import { formatClock, formatKm, priceText } from '../lib/format';
import { Meter, affinityLabel } from './OptionList';
import { Source, type SourceKey } from './Source';

function FactRow<T>({
  label,
  fact,
  show,
}: {
  label: string;
  fact: Fact<T>;
  show: (value: T) => string;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        {fact.status === 'known' ? (
          <>
            {show(fact.value)} <Source kind={fact.provenance.source} />
          </>
        ) : (
          <>
            <span className="muted-text">Not available</span>{' '}
            <span className="small muted-text">{fact.reason}</span>
          </>
        )}
      </td>
    </tr>
  );
}

const VERDICT_MARK = { pass: 'Yes', fail: 'No', unknown: '?' } as const;

export interface InspectorProps {
  view: CaseView;
  option: OptionView;
  busy: string | null;
  closed: boolean;
  onAttest: (candidateId: string, key: string, satisfied: boolean) => void;
  onAttempt: (candidateId: string) => void;
  onReject: (candidateId: string) => void;
  onConfirm: (candidateId: string) => void;
  onFail: (candidateId: string) => void;
}

export function Inspector({
  view,
  option,
  busy,
  closed,
  onAttest,
  onAttempt,
  onReject,
  onConfirm,
  onFail,
}: InspectorProps) {
  const { candidate } = option;
  const facts = candidate.facts;
  const canAct = !closed && option.feasibility !== 'rejected' && option.state !== 'failed';
  const attemptOpen = view.options.some((o) => o.state === 'attempted');
  const sourceKind: SourceKey = candidate.source === 'simulation' ? 'simulation' : 'qloo';

  return (
    <aside id="inspector" className="inspector panel" aria-label={`Details for ${candidate.name}`}>
      <h2>{candidate.name}</h2>
      <p className="lede">
        <Source kind={sourceKind} /> {candidate.description ?? ''}
      </p>

      <div className="button-row">
        {canAct && option.state !== 'attempted' && option.state !== 'confirmed' ? (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={busy !== null || attemptOpen}
              onClick={() => onAttempt(candidate.id)}
            >
              Try this one
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => onReject(candidate.id)}
            >
              Decline this option
            </button>
          </>
        ) : null}
        {option.state === 'attempted' && !closed ? (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={busy !== null}
              onClick={() => onConfirm(candidate.id)}
            >
              It is confirmed
            </button>
            <button
              type="button"
              className="btn danger"
              disabled={busy !== null}
              onClick={() => onFail(candidate.id)}
            >
              It did not work out
            </button>
          </>
        ) : null}
      </div>
      {canAct && option.state !== 'attempted' && option.state !== 'confirmed' ? (
        <p className="small muted-text" style={{ marginTop: '0.6rem' }}>
          AFTERGLOW does not book or contact anyone. Trying an option means you contact the venue
          yourself, then tell AFTERGLOW what happened.
          {attemptOpen ? ' Finish the current attempt first.' : ''}
        </p>
      ) : null}
      {option.state === 'confirmed' ? (
        <p className="callout" role="status">
          You confirmed this option. AFTERGLOW recorded your statement and did not verify it with
          the venue.
        </p>
      ) : null}

      <section aria-labelledby="gate-title">
        <h3 id="gate-title">
          {option.feasibility === 'rejected'
            ? 'Why it was ruled out'
            : option.feasibility === 'needs_verification'
              ? 'What you still need to check'
              : 'Your requirements'}
        </h3>
        {option.feasibility === 'rejected' && option.rejectionReasons.length > 0 ? (
          <p className="callout bad" role="note">
            {option.rejectionReasons[0]}
          </p>
        ) : null}
        {option.gate.verdicts.length === 0 && option.feasibility !== 'rejected' ? (
          <p className="muted-text">You set no hard requirements for this plan.</p>
        ) : (
          <ul className="verdicts">
            {option.gate.verdicts.map((verdict) => (
              <li className="verdict" key={verdict.key}>
                <span className={`mark ${verdict.outcome}`} aria-hidden="true">
                  {verdict.outcome === 'pass' ? '✓' : verdict.outcome === 'fail' ? '✕' : '?'}
                </span>
                <span className="what">
                  <span className="visually-hidden">{VERDICT_MARK[verdict.outcome]}: </span>
                  {verdict.description}
                </span>
                <span className="why">
                  {verdict.reason} <Source kind={verdict.basis} />
                  {verdict.evidence ? (
                    <span className="evidence-tag">Read from the map: {verdict.evidence}</span>
                  ) : null}
                </span>
                {(verdict.outcome === 'unknown' || verdict.basis === 'user_attested') &&
                !closed &&
                option.state !== 'failed' ? (
                  <span className="button-row">
                    <button
                      type="button"
                      className="btn small"
                      disabled={busy !== null}
                      onClick={() => onAttest(candidate.id, verdict.key, true)}
                    >
                      It meets this
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      disabled={busy !== null}
                      onClick={() => onAttest(candidate.id, verdict.key, false)}
                    >
                      It does not
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="taste-title">
        <h3 id="taste-title">Taste evidence</h3>
        {option.providerTaste ? (
          <div className="stack">
            <Meter value={option.providerTaste.affinity} label={affinityLabel(view.mode)} />
            <p className="small">
              Rank {option.providerTaste.rank} of {view.run?.poolSize ?? 0} places in this search,
              as returned by the provider.{' '}
              {view.mode === 'live'
                ? 'Affinity describes what groups tend to like, not what you will enjoy.'
                : ''}
            </p>
            {option.providerTaste.explanation.length > 0 ? (
              <ul className="small">
                {option.providerTaste.explanation.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
            {option.matchedTags.length > 0 ? (
              <p className="small">
                Shares the tags you asked to keep: {option.matchedTags.join(', ')}.
              </p>
            ) : null}
            {option.tasteOn ? (
              <p className="small">
                Recovery score {option.tasteOn.score.composite.toFixed(2)} <Source kind="app" />.
                Taste part {option.tasteOn.score.tasteComponent?.toFixed(2) ?? 'unavailable'}
                {option.tasteOn.score.tasteBasis === 'rank' ? ' (rank based)' : ''}, closeness part{' '}
                {option.tasteOn.score.closenessComponent?.toFixed(2) ?? 'unavailable'}.
              </p>
            ) : option.feasibility === 'rejected' ? (
              <p className="small">
                This place scored well for taste but is not ranked, because ruled out places are
                never ranked.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="muted-text">
            No taste score was returned for this place in the latest search.
          </p>
        )}
      </section>

      <section aria-labelledby="facts-title">
        <h3 id="facts-title">What is known about this place</h3>
        <table className="facts">
          <tbody>
            <FactRow label="Address" fact={facts.address} show={(v) => v} />
            <FactRow label="Price level" fact={facts.priceLevel} show={(v) => priceText(v)} />
            <tr>
              <th scope="row">Distance from original</th>
              <td>
                {formatKm(option.distanceKm)}{' '}
                {option.distanceKm !== null ? <Source kind="app" /> : null}
              </td>
            </tr>
            <FactRow
              label="Opening hours"
              fact={facts.openWindow}
              show={(v) => `${formatClock(v.opensAt)} to ${formatClock(v.closesAt)}`}
            />
            <FactRow
              label="Dietary options"
              fact={facts.dietary}
              show={(v) =>
                v.length === 0 ? 'None listed' : v.map((d) => d.replace('_', ' ')).join(', ')
              }
            />
            <FactRow
              label="Step free access"
              fact={facts.stepFree}
              show={(v) => (v ? 'Yes' : 'No')}
            />
            <FactRow
              label="Group capacity"
              fact={facts.groupCapacity}
              show={(v) => `Seats up to ${v}`}
            />
            <FactRow
              label="Covered seating"
              fact={facts.covered}
              show={(v) => (v ? 'Covered or indoor' : 'Outdoor only')}
            />
          </tbody>
        </table>
      </section>
    </aside>
  );
}
