import { useEffect, useState } from 'react';
import {
  api,
  type EvaluationReportFile,
  type BaselineRunView,
  type LiveRunView,
  type OsmProbeResult,
  type ProbeResult,
  type ServerStatus,
  type SmokeReportFile,
} from '../lib/api';
import { formatStamp } from '../lib/format';

const REPO = 'https://github.com/hudasol/afterglow';

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
  const [liveRuns, setLiveRuns] = useState<LiveRunView[]>([]);
  const [baselineRuns, setBaselineRuns] = useState<BaselineRunView[]>([]);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [osm, setOsm] = useState<OsmProbeResult | { error: string } | null>(null);
  const [askingOsm, setAskingOsm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .evaluation()
      .then((result) => {
        if (cancelled) return;
        setReports(result.reports);
        setSmoke(result.smoke);
        setLiveRuns(result.liveRuns);
        setBaselineRuns(result.baselineRuns ?? []);
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
        cached: false,
      });
    } finally {
      setProbing(false);
    }
  };

  const runOsmProbe = async () => {
    setAskingOsm(true);
    try {
      setOsm(await api.osmProbe());
    } catch (caught) {
      setOsm({ error: caught instanceof Error ? caught.message : 'The check failed.' });
    } finally {
      setAskingOsm(false);
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
                {probe.cached
                  ? ' This is the answer from a moment ago, so Qloo was not asked again.'
                  : ''}
              </p>
            ) : null}
          </>
        ) : (
          <p className="muted-text">Loading the server status.</p>
        )}
      </section>

      <section className="panel" aria-labelledby="ev-osm">
        <h2 id="ev-osm">OpenStreetMap place facts</h2>
        <p style={{ marginTop: '0.5rem' }}>
          Qloo states opening hours, step free access and dietary options for part of the places it
          returns, and never group capacity or covered seating. For live cases, and only for facts a
          plan insists on that Qloo left unknown, this server asks the public Overpass service about
          the venues Qloo returned and reads the matching tags. Only the public coordinates of those
          venues are sent. The data is © OpenStreetMap contributors, under the{' '}
          <a href="https://www.openstreetmap.org/copyright">Open Database Licence</a>, and
          volunteers edit it, so the interface shows its source on every value taken from it.
        </p>
        <p className="small muted-text" style={{ marginTop: '0.4rem' }}>
          {live?.placeFacts
            ? 'Live cases on this server use it.'
            : 'Live cases on this server do not use it. That needs a Qloo key and the lookup turned on.'}{' '}
          The check below asks for the named venues around one public point in Manhattan and shows
          what this server received. It is made from this server, so it shows what the hosted
          application can reach.
        </p>
        <div className="button-row" style={{ marginTop: '0.9rem' }}>
          <button
            type="button"
            className="btn"
            disabled={!live?.placeFactsCheck || askingOsm}
            onClick={() => void runOsmProbe()}
          >
            {askingOsm ? 'Asking OpenStreetMap' : 'Ask OpenStreetMap now'}
          </button>
        </div>
        {osm ? (
          'error' in osm ? (
            <p className="callout bad" role="status" style={{ marginTop: '0.8rem' }}>
              Not reachable. {osm.error}
            </p>
          ) : (
            <p
              className={
                osm.verdict === 'go'
                  ? 'callout'
                  : osm.verdict === 'conditional'
                    ? 'callout warn'
                    : 'callout bad'
              }
              role="status"
              style={{ marginTop: '0.8rem' }}
            >
              {osm.ok ? 'Answered.' : 'Not answered.'} {osm.message}
              {osm.ok
                ? ` ${osm.venues} named venues, ${osm.hoursRead} of ${osm.hoursPresent} opening hours values read in full, ${osm.latencyMs ?? 'unknown'} ms${osm.host ? ` from ${osm.host}` : ''}.`
                : ''}
              {osm.cached ? ' This is the answer from a moment ago.' : ''}
            </p>
          )
        ) : null}
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

      <section aria-labelledby="ev-live" className="stack">
        <h2 id="ev-live">Live evaluation on Qloo data</h2>
        <p className="muted-text">
          Twelve numeric predictions were written down before the first run and committed to the
          repository. They were then tested on 20 plans in five cities with real Qloo data. The
          plans, cities and signals were chosen by the team that built the method, and no people
          took part. Misses are kept. The full documents are in the{' '}
          <a href={`${REPO}/blob/main/docs/PREREGISTRATION.md`}>preregistration</a>,{' '}
          <a href={`${REPO}/blob/main/docs/EVALUATION_LIVE.md`}>registered result</a>,{' '}
          <a href={`${REPO}/blob/main/docs/EVALUATION_LIVE_SECOND_RUN.md`}>second run</a> and{' '}
          <a href={`${REPO}/blob/main/docs/EVALUATION_LIVE_NOTES.md`}>notes on the misses</a>.
        </p>
        {liveRuns.length === 0 ? (
          <div className="callout warn">No live evaluation result is recorded with this build.</div>
        ) : (
          liveRuns.map((run) => (
            <article className="panel" key={run.label} aria-labelledby={`live-${run.label}`}>
              <h3 id={`live-${run.label}`}>{run.label}</h3>
              <p className="small muted-text">
                {run.providerLabel}. {formatStamp(run.generatedAt)}. {run.completed} of{' '}
                {run.scenarios} scenarios completed. {run.hits} predictions met, {run.misses} missed
                {run.notEvaluated > 0 ? `, ${run.notEvaluated} not evaluated` : ''}.
              </p>
              {run.note ? <p className="small">{run.note}</p> : null}
              <div
                className="table-wrap"
                tabIndex={0}
                role="region"
                aria-label={`${run.label}, predictions`}
              >
                <table className="data" style={{ marginTop: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th scope="col">Id</th>
                      <th scope="col">Measure</th>
                      <th scope="col">Predicted</th>
                      <th scope="col">Observed</th>
                      <th scope="col">95% interval</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.predictions.map((p) => (
                      <tr key={p.id}>
                        <td>{p.id}</td>
                        <td>{p.claim}</td>
                        <td>{p.predicted}</td>
                        <td>{p.observed}</td>
                        <td>{p.interval}</td>
                        <td>
                          <span className={`pill ${p.verdict === 'HIT' ? 'ok' : 'bad'}`}>
                            {p.verdict === 'HIT'
                              ? 'Met'
                              : p.verdict === 'MISS'
                                ? 'Missed'
                                : 'Not evaluated'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))
        )}
      </section>

      {baselineRuns.length > 0 ? (
        <section aria-labelledby="ev-baselines" className="stack">
          <h2 id="ev-baselines">Against simpler approaches</h2>
          <p className="muted-text">
            The same plans ranked five ways from the same pool of places: at random, nearest first,
            most popular, by Qloo taste alone, and by AFTERGLOW. Each is also shown without the
            gate, which is how a plain recommender behaves. A requirement counts as broken only when
            a fact that is known is against the place. See{' '}
            <a href={`${REPO}/blob/main/docs/PREREGISTRATION_V2.md`}>the preregistration</a>,{' '}
            <a href={`${REPO}/blob/main/docs/EVALUATION_BASELINES_TEST.md`}>the test results</a> and{' '}
            <a href={`${REPO}/blob/main/docs/EVALUATION_BASELINES_DEV.md`}>
              the development results
            </a>
            .
          </p>
          {baselineRuns.map((run) => (
            <article className="panel" key={run.set} aria-labelledby={`base-${run.set}`}>
              <h3 id={`base-${run.set}`}>{run.label}</h3>
              <p className="small muted-text">
                {run.providerLabel}. {formatStamp(run.generatedAt)}. {run.completed} of{' '}
                {run.scenarios} scenarios completed
                {run.set === 'test'
                  ? `. ${run.hits} predictions met, ${run.misses} missed${
                      run.notEvaluated > 0 ? `, ${run.notEvaluated} not evaluated` : ''
                    }.`
                  : '. No predictions were made for these scenarios.'}
              </p>
              <div
                className="table-wrap"
                tabIndex={0}
                role="region"
                aria-label={`${run.label}, approaches compared`}
              >
                <table className="data" style={{ marginTop: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th scope="col">Approach</th>
                      <th scope="col">Gate</th>
                      <th scope="col">Top three breaks a requirement</th>
                      <th scope="col">Mean km from the venue</th>
                      <th scope="col">Affinity lift</th>
                      <th scope="col">With a requested vibe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.arms.map((arm) => (
                      <tr key={`${arm.approach}-${arm.gate}`}>
                        <td>{arm.approach}</td>
                        <td>{arm.gate ? 'Yes' : 'No'}</td>
                        <td>{arm.breaking}</td>
                        <td>{arm.km}</td>
                        <td>{arm.lift}</td>
                        <td>{arm.vibe}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {run.predictions.length > 0 ? (
                <div
                  className="table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label={`${run.label}, predictions`}
                >
                  <table className="data" style={{ marginTop: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th scope="col">Id</th>
                        <th scope="col">Measure</th>
                        <th scope="col">Predicted</th>
                        <th scope="col">Observed</th>
                        <th scope="col">95% interval</th>
                        <th scope="col">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.predictions.map((p) => (
                        <tr key={p.id}>
                          <td>{p.id}</td>
                          <td>{p.claim}</td>
                          <td>{p.predicted}</td>
                          <td>{p.observed}</td>
                          <td>{p.interval}</td>
                          <td>
                            <span className={`pill ${p.verdict === 'HIT' ? 'ok' : 'bad'}`}>
                              {p.verdict === 'HIT'
                                ? 'Met'
                                : p.verdict === 'MISS'
                                  ? 'Missed'
                                  : 'Not evaluated'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </article>
          ))}
          <p className="small muted-text">
            Affinity lift is the mean Qloo affinity of the top three minus the mean of the places
            that passed the gate, in standard deviations of those places. It shows that the Qloo
            signal is used. It does not show that people would prefer the result: no person judged
            any list.
          </p>
        </section>
      ) : null}

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
            Only the city, the venue category, the taste names and phrases, and the original venue
            name, when it is used as a taste signal or a distance limit needs it, are sent to Qloo.
          </li>
          <li>Titles, party sizes, notes and times stay on this server.</li>
          <li>The API key never reaches the browser, the repository or the logs.</li>
          <li>AFTERGLOW does not book, call or message anyone. Confirmed means you told it so.</li>
        </ul>
      </section>
    </div>
  );
}
