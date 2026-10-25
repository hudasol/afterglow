import type { CaseView, OptionView } from '../../../src/domain/case-view.js';
import { formatAffinity, formatKm, priceText } from '../lib/format';

function feasibilityPill(option: OptionView) {
  switch (option.state) {
    case 'confirmed':
      return <span className="pill ok">Confirmed by you</span>;
    case 'attempted':
      return <span className="pill info">Attempt under way</span>;
    case 'failed':
      return <span className="pill bad">Did not work out</span>;
    default:
  }
  switch (option.feasibility) {
    case 'feasible':
      return <span className="pill ok">Meets every requirement</span>;
    case 'needs_verification':
      return <span className="pill warn">Needs your check</span>;
    case 'rejected':
      return <span className="pill bad">Ruled out</span>;
  }
}

export function Meter({ value, label }: { value: number | null; label: string }) {
  if (value === null) {
    return <span className="small muted-text">{label}: not returned</span>;
  }
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className="meter">
      <span className="bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span>
        {label} {formatAffinity(value)}
      </span>
    </span>
  );
}

export function affinityLabel(mode: CaseView['mode']): string {
  return mode === 'demo' ? 'Simulated affinity' : 'Qloo affinity';
}

function OptionRow({
  option,
  mode,
  selected,
  position,
  onSelect,
}: {
  option: OptionView;
  mode: CaseView['mode'];
  selected: boolean;
  position: number | null;
  onSelect: (id: string) => void;
}) {
  const price = option.candidate.facts.priceLevel;
  return (
    <li className="option" data-selected={selected}>
      <button
        type="button"
        className="row"
        onClick={() => onSelect(option.candidate.id)}
        aria-pressed={selected}
      >
        <span className="rank" aria-hidden="true">
          {position ?? ''}
        </span>
        <span className="title">
          {position !== null ? <span className="visually-hidden">Rank {position}. </span> : null}
          {option.candidate.name}
        </span>
        <span className="side">
          {feasibilityPill(option)}
          {option.providerTaste ? (
            <Meter value={option.providerTaste.affinity} label={affinityLabel(mode)} />
          ) : null}
        </span>
        <span className="meta">
          {price.status === 'known' ? `Price ${priceText(price.value)}` : 'Price not available'}
          {', '}
          {formatKm(option.distanceKm)}
        </span>
      </button>
    </li>
  );
}

export function OptionGroups({
  view,
  selectedId,
  onSelect,
}: {
  view: CaseView;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const position = (option: OptionView): number | null =>
    (view.activeArm === 'taste_on' ? option.tasteOn?.position : option.tasteOffPosition) ?? null;
  const inProgress = view.options.filter((o) => o.state === 'attempted' || o.state === 'confirmed');
  const shortlist = view.options.filter((o) => o.state === 'awaiting_approval');
  const others = view.options.filter((o) => o.state === 'evaluated');
  const ruledOut = view.options.filter((o) => o.state === 'rejected' || o.state === 'failed');

  const group = (title: string, hint: string, items: OptionView[]) =>
    items.length === 0 ? null : (
      <section className="option-group" aria-labelledby={`g-${title}`}>
        <h2 id={`g-${title}`}>{title}</h2>
        <p className="hint">{hint}</p>
        <ol className="option-list">
          {items.map((option) => (
            <OptionRow
              key={option.candidate.id}
              option={option}
              mode={view.mode}
              selected={selectedId === option.candidate.id}
              position={position(option)}
              onSelect={onSelect}
            />
          ))}
        </ol>
      </section>
    );

  return (
    <>
      {group('In progress', 'The option you are working on.', inProgress)}
      {group(
        'Shortlist',
        view.activeArm === 'taste_on'
          ? 'Ordered by the recovery score, which blends taste with closeness. Every place here passed the gate.'
          : 'Ordered by distance, then price. Taste ranking was not available for this search.',
        shortlist,
      )}
      {group('Also eligible', 'These passed the gate but ranked lower.', others)}
      {ruledOut.length > 0 ? (
        <details className="ruled-out option-group">
          <summary>Ruled out ({ruledOut.length})</summary>
          <p className="hint">
            Each place below failed a requirement you set or was excluded by a decision of yours.
          </p>
          <ol className="option-list">
            {ruledOut.map((option) => (
              <OptionRow
                key={option.candidate.id}
                option={option}
                mode={view.mode}
                selected={selectedId === option.candidate.id}
                position={null}
                onSelect={onSelect}
              />
            ))}
          </ol>
        </details>
      ) : null}
    </>
  );
}
