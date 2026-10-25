import { useEffect, useState } from 'react';
import {
  api,
  type EvaluationReportFile,
  type ScenarioPreset,
  type Showcase,
  type ShowcaseEntry,
} from '../lib/api';

function VignetteRows({
  entries,
  kind,
}: {
  entries: ShowcaseEntry[];
  kind: 'plain' | 'afterglow';
}) {
  return (
    <>
      {entries.map((entry) => (
        <div
          className={`vrow${entry.ruledOutBecause ? ' struck' : ''}`}
          key={`${kind}-${entry.name}`}
        >
          <span className="name">
            {entry.ruledOutBecause ? <span className="visually-hidden">Ruled out: </span> : null}
            {entry.name}
          </span>
          {entry.ruledOutBecause ? (
            <span className="pill bad">Ruled out</span>
          ) : (
            <span className="pill ok">Meets every requirement</span>
          )}
          <span className="why">
            {entry.ruledOutBecause ??
              entry.needsCheck ??
              (entry.providerRank !== null
                ? `Simulated taste rank ${entry.providerRank} of the whole pool.`
                : '')}
          </span>
        </div>
      ))}
    </>
  );
}

function Vignette({ showcase }: { showcase: Showcase }) {
  return (
    <figure
      className="vignette"
      aria-label="An example of the gate at work, from the simulated catalogue"
      style={{ margin: 0 }}
    >
      <div className="vignette-sky" aria-hidden="true" />
      <div className="vignette-body">
        <h2 style={{ fontSize: '1.25rem' }}>{showcase.title}</h2>
        <p className="small muted-text">{showcase.summary}</p>
        <h3
          style={{
            fontSize: '0.95rem',
            marginTop: '0.9rem',
            fontFamily: 'var(--font-body)',
            fontWeight: 650,
          }}
        >
          A plain list ranked by taste alone
        </h3>
        <VignetteRows entries={showcase.withoutGate} kind="plain" />
        <h3
          style={{
            fontSize: '0.95rem',
            marginTop: '0.9rem',
            fontFamily: 'var(--font-body)',
            fontWeight: 650,
          }}
        >
          What AFTERGLOW offers instead
        </h3>
        <VignetteRows entries={showcase.afterglow} kind="afterglow" />
        <figcaption className="vignette-note">
          {showcase.label}. This example was chosen to show the gate at work. It is not typical of
          every scenario.
        </figcaption>
      </div>
    </figure>
  );
}

export function Home() {
  const [showcase, setShowcase] = useState<Showcase | null>(null);
  const [showcaseFailed, setShowcaseFailed] = useState(false);
  const [presets, setPresets] = useState<ScenarioPreset[]>([]);
  const [report, setReport] = useState<EvaluationReportFile | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .showcase()
      .then((result) => !cancelled && setShowcase(result))
      .catch(() => !cancelled && setShowcaseFailed(true));
    api
      .scenarios()
      .then((result) => !cancelled && setPresets(result.scenarios))
      .catch(() => undefined);
    api
      .evaluation()
      .then(
        (result) =>
          !cancelled &&
          setReport(result.reports.find((r) => r.kind === 'offline_simulated') ?? null),
      )
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <section className="hero" aria-labelledby="home-title">
        <div>
          <h1 id="home-title">Save the experience, not just the plan.</h1>
          <p className="lede">
            When a booking falls through, AFTERGLOW keeps what you wanted from the evening, finds
            alternatives using Qloo taste data, rules out any place that breaks a hard requirement,
            and shows its evidence.
          </p>
          <div className="button-row">
            <a className="btn primary" href="#/new">
              Start a recovery
            </a>
            <a className="btn" href="#/evidence">
              See the evidence
            </a>
          </div>
        </div>
        {showcase ? (
          <Vignette showcase={showcase} />
        ) : showcaseFailed ? (
          <p className="muted-text">The example could not be loaded right now.</p>
        ) : (
          <p className="muted-text" role="status">
            Loading an example.
          </p>
        )}
      </section>

      <section className="principles" aria-label="How AFTERGLOW works">
        <div>
          <h3>Your intent is fixed</h3>
          <p>
            The plan is recorded once as an intent anchor. Disruptions and your decisions are
            layered on top, and the anchor is never rewritten to make a result look better.
          </p>
        </div>
        <div>
          <h3>Hard requirements are not negotiable</h3>
          <p>
            A place that fails a requirement is ruled out, not ranked lower. When a fact is unknown
            it is flagged for your check and never assumed to pass.
          </p>
        </div>
        <div>
          <h3>Every fact shows its source</h3>
          <p>
            Each value is tagged as Qloo, simulated, said by you, checked by you or calculated here.
            AFTERGLOW never books anything. Confirmed means you told it so.
          </p>
        </div>
      </section>

      {report ? (
        <section className="panel" aria-labelledby="home-eval">
          <h2 id="home-eval">What the offline test showed</h2>
          <p style={{ marginTop: '0.5rem' }}>
            Across {report.summary.scenarios} hand authored scenarios in the simulated catalogue, a
            plain top three broke at least one requirement in{' '}
            {report.summary.ungatedScenariosWithViolation}. After the gate, an independent check
            found {report.summary.gatedViolations.tasteOn + report.summary.gatedViolations.tasteOff}{' '}
            violations in the shortlists. These scenarios were written for this project, so the
            numbers show how the pipeline behaves and are not a rate in the real world.
          </p>
          <p style={{ marginTop: '0.8rem' }}>
            <a href="#/evidence">Read the method and its limits</a>
          </p>
        </section>
      ) : null}

      {presets.length > 0 ? (
        <section className="presets" aria-labelledby="home-presets">
          <h2 id="home-presets">Try a simulated example</h2>
          <p className="muted-text" style={{ marginTop: '0.4rem' }}>
            Each example runs in an invented city with invented venues. No live data is involved.
          </p>
          <div className="preset-list">
            {presets.map((preset) => (
              <div className="preset" key={preset.id}>
                <div>
                  <h3>{preset.title}</h3>
                  <p>{preset.summary}</p>
                </div>
                <a className="btn" href={`#/new?scenario=${encodeURIComponent(preset.id)}`}>
                  Open this example<span className="visually-hidden">: {preset.title}</span>
                </a>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
