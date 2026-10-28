import { useEffect, useState } from 'react';
import { caseHref, go } from '../lib/router';
import {
  api,
  ApiError,
  type EvaluationReportFile,
  type LivePreset,
  type RecordedExample,
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

function RecordedVignette({ example }: { example: RecordedExample }) {
  const when = new Date(example.generatedAt).toISOString().slice(0, 10);
  const setName = example.set === 'test' ? 'held out test scenarios' : 'development scenarios';
  return (
    <figure
      className="vignette"
      aria-label="An example of the gate at work, recorded from live Qloo data"
      style={{ margin: 0 }}
    >
      <div className="vignette-sky" aria-hidden="true" />
      <div className="vignette-body">
        <h2 style={{ fontSize: '1.25rem' }}>{example.title}</h2>
        <p className="small muted-text">
          The venue fell through. Both lists below rank the same places, using Qloo taste data.
        </p>
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
        {example.plain.map((place) => (
          <div
            className={`vrow${place.reasons.length > 0 ? ' struck' : ''}`}
            key={`plain-${place.name}`}
          >
            <span className="name">
              {place.reasons.length > 0 ? (
                <span className="visually-hidden">Breaks a requirement: </span>
              ) : null}
              {place.name}
            </span>
            {place.reasons.length > 0 ? (
              <span className="pill bad">Breaks a requirement</span>
            ) : (
              <span className="pill ok">No known conflict</span>
            )}
            <span className="why">{place.reasons.join(', ')}</span>
          </div>
        ))}
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
        {example.afterglow.map((place) => (
          <div className="vrow" key={`afterglow-${place.name}`}>
            <span className="name">{place.name}</span>
            {place.needsCheck ? (
              <span className="pill warn">Needs a check</span>
            ) : (
              <span className="pill ok">Meets every requirement</span>
            )}
            <span className="why" />
          </div>
        ))}
        <figcaption className="vignette-note">
          Recorded on {when} from live Qloo data, {setName}. This is the first scenario in the file
          where the plain list holds a place that breaks a requirement, so it was not picked by
          hand. That happened in {example.plainBreaking.count} of {example.plainBreaking.total}{' '}
          scenarios. A place is marked only where a fact is known to be against it.
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
  const [recorded, setRecorded] = useState<RecordedExample | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [livePresets, setLivePresets] = useState<LivePreset[]>([]);
  const [liveId, setLiveId] = useState('');
  const [liveOpening, setLiveOpening] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  // The first example that needs no choice from the person, so one press reaches a shortlist.
  const quickExample = presets.find((preset) => !preset.choices);

  async function runExample(): Promise<void> {
    if (!quickExample) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const view = await api.openCase({
        mode: 'demo',
        anchor: quickExample.anchor,
        disruption: quickExample.disruption,
      });
      go(caseHref(view.id));
    } catch (caught) {
      setLaunchError(
        caught instanceof ApiError ? caught.message : 'The example could not be opened.',
      );
      setLaunching(false);
    }
  }

  const chosenLive = livePresets.find((preset) => preset.id === liveId) ?? livePresets[0];

  async function runLive(): Promise<void> {
    if (!chosenLive) return;
    setLiveOpening(true);
    setLiveError(null);
    try {
      const view = await api.openCase({
        mode: 'live',
        anchor: chosenLive.anchor,
        disruption: chosenLive.disruption,
      });
      go(caseHref(view.id));
    } catch (caught) {
      setLiveError(
        caught instanceof ApiError ? caught.message : 'The live example could not be opened.',
      );
      setLiveOpening(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    api
      .livePresets()
      .then((result) => !cancelled && setLivePresets(result.presets))
      .catch(() => undefined);
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
      .then((result) => {
        if (cancelled) return;
        setReport(result.reports.find((r) => r.kind === 'offline_simulated') ?? null);
        setRecorded(result.recordedExample);
      })
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
            <button
              type="button"
              className="btn"
              disabled={!quickExample || launching}
              onClick={() => void runExample()}
            >
              {launching ? 'Opening the example' : 'Run a simulated example'}
            </button>
            <a className="btn" href="#/evidence">
              See the evidence
            </a>
          </div>
          {launchError ? (
            <p className="error" role="alert" style={{ marginTop: '0.75rem' }}>
              {launchError}
            </p>
          ) : null}
        </div>
        {recorded ? (
          <RecordedVignette example={recorded} />
        ) : showcase ? (
          <Vignette showcase={showcase} />
        ) : showcaseFailed ? (
          <p className="muted-text">The example could not be loaded right now.</p>
        ) : (
          <p className="muted-text" role="status">
            Loading an example.
          </p>
        )}
      </section>

      {livePresets.length > 0 && chosenLive ? (
        <section className="panel live-example" aria-labelledby="home-live">
          <h2 id="home-live">Run it on real Qloo data</h2>
          <p style={{ marginTop: '0.5rem' }}>
            {chosenLive.summary} Opening this case asks Qloo for places, their tags and a taste
            ranking. It can take up to half a minute, and the server limits how many live cases one
            address can open in an hour.
          </p>
          <div className="live-controls">
            <div className="field">
              <label htmlFor="live-city">City</label>
              <select
                id="live-city"
                value={chosenLive.id}
                onChange={(event) => setLiveId(event.target.value)}
                disabled={liveOpening}
              >
                {livePresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.city}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn primary"
              disabled={liveOpening}
              onClick={() => void runLive()}
            >
              {liveOpening ? 'Asking Qloo' : `Run in ${chosenLive.city}`}
            </button>
          </div>
          {liveOpening ? (
            <p className="muted-text" role="status" style={{ marginTop: '0.6rem' }}>
              Asking Qloo. This can take up to half a minute on the first request after the server
              has been idle.
            </p>
          ) : null}
          {liveError ? (
            <p className="error" role="alert" style={{ marginTop: '0.6rem' }}>
              {liveError}
            </p>
          ) : null}
        </section>
      ) : null}

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
            {report.summary.ungatedScenariosWithViolation}. After the gate, a separate check found{' '}
            {report.summary.gatedViolations.tasteOn + report.summary.gatedViolations.tasteOff}{' '}
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
