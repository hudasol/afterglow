import type { CaseView } from '../../../src/domain/case-view.js';

export function RelaxationPanel({
  view,
  busy,
  onRelax,
}: {
  view: CaseView;
  busy: boolean;
  onRelax: (constraintKeys: string[]) => void;
}) {
  if (view.relaxations.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="relax-title">
      <h2 id="relax-title">No place meets every requirement</h2>
      <p className="lede" style={{ marginBottom: '0.8rem' }}>
        AFTERGLOW will not quietly loosen anything. These are the smallest sets of requirements
        that, if you chose to give them up, would admit at least one place. Your original intent
        stays on record either way.
      </p>
      <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
        {view.relaxations.map((option) => (
          <li key={option.constraintKeys.join('+')} className="callout warn">
            <strong>
              Give up {option.descriptions.length === 1 ? 'this requirement' : 'these requirements'}
              :
            </strong>
            <ul>
              {option.descriptions.map((description) => (
                <li key={description}>{description}</li>
              ))}
            </ul>
            <p className="small" style={{ margin: '0.4rem 0' }}>
              Admits {option.admits} {option.admits === 1 ? 'place' : 'places'}, for example{' '}
              {option.candidateNames.slice(0, 3).join(', ')}.
            </p>
            <button
              type="button"
              className="btn small"
              disabled={busy}
              onClick={() => onRelax(option.constraintKeys)}
            >
              Yes, give this up
            </button>
          </li>
        ))}
      </ul>
      <p className="small muted-text" style={{ marginTop: '0.8rem' }}>
        Prefer not to? Record a different disruption, such as a later time or a smaller party, or
        close this case.
      </p>
    </section>
  );
}
