import { useEffect, useState } from 'react';
import { api, ApiError, type CaseListItem } from '../lib/api';
import { formatStamp } from '../lib/format';
import { caseHref } from '../lib/router';

const STATUS: Record<CaseListItem['status'], string> = {
  needs_choices: 'Waiting for your choice',
  anchored: 'Anchored',
  recovering: 'Options ready',
  attempting: 'Attempt under way',
  recovered: 'Recovered',
  abandoned: 'Closed without a recovery',
};

export function Cases() {
  const [cases, setCases] = useState<CaseListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listCases()
      .then((result) => !cancelled && setCases(result.cases))
      .catch(
        (caught: unknown) =>
          !cancelled &&
          setError(caught instanceof ApiError ? caught.message : 'Your cases could not be loaded.'),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!cases)
    return (
      <p className="muted-text" role="status">
        Loading your cases.
      </p>
    );

  return (
    <div>
      <h1 style={{ fontSize: 'clamp(2rem, 4.5vw, 3rem)' }}>Your cases</h1>
      <p className="muted-text" style={{ marginTop: '0.5rem' }}>
        Cases are kept on this server and tied to this browser. Clearing site data in this browser
        separates you from them.
      </p>
      {cases.length === 0 ? (
        <div className="empty">
          <h2>No cases yet</h2>
          <p>Describe a plan that fell through and AFTERGLOW will start a case.</p>
          <a className="btn primary" href="#/new">
            Start a recovery
          </a>
        </div>
      ) : (
        <div style={{ marginTop: '1.25rem' }}>
          {cases.map((item) => (
            <div className="case-row" key={item.id}>
              <div>
                <h3>
                  <a href={caseHref(item.id)}>{item.title}</a>
                </h3>
                <p className="small muted-text">
                  {item.mode === 'demo' ? 'Simulated demo' : 'Live Qloo'}. Updated{' '}
                  {formatStamp(item.updatedAt)}.
                </p>
              </div>
              <span className="pill neutral">{STATUS[item.status]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
