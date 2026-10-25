import { useEffect, useState } from 'react';
import {
  api,
  type EvaluationReportFile,
  type ProbeResult,
  type ServerStatus,
  type SmokeReportFile,
} from '../lib/api';
import { formatStamp } from '../lib/format';

const VERDICT_TEXT: Record<SmokeReportFile['verdict'], string> = {
  go: 'Go: every check passed.',
  conditional: 'Conditional: the integration works, with limits noted below.',
  no_go: 'No go: the integration cannot support the product as designed.',
};

function Percent({ value }: { value: number | null }) {
  return <>{value === null ? 'not defined' : `${Math.round(value * 100)}%`}</>;
}

function ReportCard({ report }: { report: EvaluationReportFile }) {
  const s = report.summary;
  const live = report.kind === 'live_qloo';
  return (
    <article className="panel" aria-labelledby={`rep-${report.kind}`}>
      <h3 id={`rep-${report.kind}`}>
        {live ? 'Live Qloo evaluation' : 'Offline evaluation on the simulated catalogue'}
      </h3>
      <p className="small muted-text">
        {report.provider.label}. Generated {formatStamp(report.generatedAt)}. {report.scenarioCount}{' '}
        scenarios.
      </p>
      <dl
        className="stat-list"
        style={{ marginTop: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}
      >
        <div>
          <dt>Scenarios completed</dt>
          <dd>
            {s.completed} of {s.scenarios}
          </dd>
        </div>
        <div>
          <dt>Plain top three broke a requirement</dt>
          <dd>
            {s.ungatedScenariosWithViolation} scenarios
            <div className="small muted-text" style={{ fontFamily: 'var(--font-body)' }}>
              {s.ungatedTopSlotsViolating.violating} of {s.ungatedTopSlotsViolating.total} places
            </div>
          </dd>
        </div>
        <div>
          <dt>Violations after the gate</dt>
          <dd>{s.gatedViolations.tasteOn + s.gatedViolations.tasteOff}</dd>
        </div>
        <div>
          <dt>Same eligible set in both arms</dt>
          <dd>{s.sameEligibleSetEverywhere ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt>Top choice changed with taste</dt>
          <dd>
            {s.topChoiceChanged.changed} of {s.topChoiceChanged.compared}
          </dd>
        </div>
        <div>
          <dt>Mean top three overlap</dt>
          <dd>
            <Percent value={s.meanOverlapAt3} />
          </dd>
        </div>
        <div>
          <dt>Mean order agreement</dt>
          <dd>{s.meanKendallTau === null ? 'not defined' : s.meanKendallTau.toFixed(2)}</dd>
        </div>
        <div>
          <dt>No option, ways forward offered</dt>
          <dd>
            {s.noFeasibleHandled.withWaysForward} of {s.noFeasibleHandled.scenarios}
          </dd>
        </div>
      </dl>
      <h4 style={{ marginTop: '1.25rem' }}>Method</h4>
      <ul>
        {report.method.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h4 style={{ marginTop: '1rem' }}>What this does not show</h4>
      <ul>
        {report.limits.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </article>
  );
}

export function EvidencePage({ status }: { status: ServerStatus | null }) {
  const [reports, setReports] = useState<EvaluationReportFile[] | null>(null);
  const [smoke, setSmoke] = useState<SmokeReportFile[]>([]);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .evaluation()
      .then((result) => {
        if (cancelled) return;
        setReports(result.reports);
        setSmoke(result.smoke);
      })
      .catch(() => !cancelled && setReports([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const live = status?.modes.live;
  const runProbe = async () => {
    setProbing(true);
    try {
      setProbe(await api.probe());
    } catch (caught) {
      setProbe({
        ok: false,
        latencyMs: 0,
        message: caught instanceof Error ? caught.message : 'The check failed.',
      });
    } finally {
      setProbing(false);
    }
  };

  return (
    <div className="stack">
      <h1 style={{ fontSize: 'clamp(2rem, 4.5vw, 3rem)' }}>Integration and evidence</h1>
      <p className="lede" style={{ color: 'var(--ink-2)' }}>
        This page states what is connected, what has been tested, and what the tests do not prove.
      </p>

      <section className="panel" aria-labelledby="ev-status">
        <h2 id="ev-status">Qloo connection</h2>
        {status ? (
          <>
            <p style={{ marginTop: '0.5rem' }}>
              {live?.configured
                ? `A Qloo API key is configured on this server. Requests go to ${live.baseUrl}.`
                : 'No Qloo API key is configured on this server, so live mode is switched off. Demo mode uses a simulated catalogue and sends nothing to Qloo.'}
            </p>
            {live?.configured ? (
              <p className="small muted-text" style={{ marginTop: '0.4rem' }}>
                Calls today: {live.callsToday ?? 'unknown'} of a daily cap of {live.dailyCap}. The
                key stays on the server and is never sent to the browser.
              </p>
            ) : null}
            <div className="button-row" style={{ marginTop: '0.9rem' }}>
              <button
                type="button"
                className="btn"
                disabled={!live?.configured || probing}
                onClick={() => void runProbe()}
              >
                {probing ? 'Checking' : 'Check the connection'}
              </button>
            </div>
            {probe ? (
              <p
                className={probe.ok ? 'callout' : 'callout bad'}
                role="status"
                style={{ marginTop: '0.8rem' }}
              >
                {probe.ok ? 'Reachable.' : 'Not reachable.'} {probe.message}
                {probe.ok
                  ? ` Round trip ${probe.latencyMs} ms.`
                  : probe.code
                    ? ` Code ${probe.code}.`
                    : ''}
              </p>
            ) : null}
          </>
        ) : (
          <p className="muted-text">Loading the server status.</p>
        )}
      </section>

      <section aria-labelledby="ev-smoke" className="stack">
        <h2 id="ev-smoke">Live smoke test</h2>
        {smoke.length === 0 ? (
          <div className="callout warn">
            No live smoke test result is recorded with this build. Until one is, nothing on this
            site claims that the live Qloo path has been verified. A result is written by running{' '}
            <code>npm run qloo:smoke</code> with a valid key.
          </div>
        ) : (
          smoke.map((item) => (
            <article className="panel" key={item.generatedAt}>
              <h3>{VERDICT_TEXT[item.verdict]}</h3>
              <p className="small muted-text">
                {formatStamp(item.generatedAt)}. City used: {item.options.city}.
              </p>
              <ul style={{ marginTop: '0.6rem' }}>
                {item.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Smoke test checks">
                <table className="data" style={{ marginTop: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th scope="col">Check</th>
                      <th scope="col">Result</th>
                      <th scope="col">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.checks.map((check) => (
                      <tr key={check.name}>
                        <td>{check.name}</td>
                        <td>
                          <span className={`pill ${check.ok ? 'ok' : 'bad'}`}>
                            {check.ok ? 'Passed' : 'Failed'}
                          </span>
                        </td>
                        <td>{check.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))
        )}
      </section>

      <section aria-labelledby="ev-eval" className="stack">
        <h2 id="ev-eval">Evaluation</h2>
        {reports === null ? (
          <p className="muted-text">Loading the evaluation.</p>
        ) : reports.length === 0 ? (
          <p className="callout warn">No evaluation report is recorded with this build.</p>
        ) : (
          reports.map((report) => (
            <ReportCard key={`${report.kind}-${report.generatedAt}`} report={report} />
          ))
        )}
      </section>

      <section className="panel" aria-labelledby="ev-data">
        <h2 id="ev-data">How data is handled</h2>
        <ul style={{ marginTop: '0.5rem' }}>
          <li>
            Qloo results describe what groups of people tend to like. They say nothing about any
            individual.
          </li>
          <li>
            Only the city, the venue category, the taste names and phrases, and, when a distance
            limit is set, the original venue name are sent to Qloo.
          </li>
          <li>Titles, party sizes, notes and times stay on this server.</li>
          <li>The API key never reaches the browser, the repository or the logs.</li>
          <li>AFTERGLOW does not book, call or message anyone. Confirmed means you told it so.</li>
        </ul>
      </section>
    </div>
  );
}
