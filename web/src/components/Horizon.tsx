import type { CaseView } from '../../../src/domain/case-view.js';

const STAGES = [
  { short: 'Anchored', full: 'Plan anchored' },
  { short: 'Disrupted', full: 'Disruption recorded' },
  { short: 'Options', full: 'Options ready' },
  { short: 'Attempt', full: 'Attempt under way' },
  { short: 'Confirmed', full: 'Confirmed by you' },
];

export function stageFor(view: CaseView): number {
  if (view.status === 'recovered') return 5;
  if (view.status === 'attempting') return 4;
  if (view.run && view.disruptions.length > 0) return 3;
  if (view.disruptions.length > 0 && view.status !== 'needs_choices') return 2;
  return 1;
}

/** The progress band. It fills from dusk toward the afterglow as the recovery advances. */
export function Horizon({ view }: { view: CaseView }) {
  const stage = stageFor(view);
  const width = (stage / STAGES.length) * 100;
  return (
    <nav className="horizon" aria-label="Recovery progress">
      <div className="track" aria-hidden="true">
        <div
          className="fill"
          style={{ width: `${width}%`, ['--band-width' as string]: `${(100 / width) * 100}%` }}
        />
      </div>
      <ol>
        {STAGES.map((item, index) => (
          <li
            key={item.full}
            className={index + 1 < stage ? 'done' : undefined}
            {...(index + 1 === stage ? { 'aria-current': 'step' as const } : {})}
          >
            <span className="full">{item.full}</span>
            <span className="short" aria-hidden="true">
              {item.short}
            </span>
          </li>
        ))}
      </ol>
      {view.status === 'abandoned' ? (
        <p className="small muted-text" role="status">
          This case was closed without a recovery.
        </p>
      ) : null}
    </nav>
  );
}
