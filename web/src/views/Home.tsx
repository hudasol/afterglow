import { useEffect, useState } from 'react';
import { caseHref, go } from '../lib/router';
import {
  api,
  ApiError,
  type BaselineRunView,
  type LivePreset,
  type OrderedPlace,
  type RecordedExample,
  type RecordedOrder,
  type ScenarioPreset,
  type Showcase,
  type ShowcaseEntry,
} from '../lib/api';
import { swapOverlap, twoPlaces } from '../lib/evidence';

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
          where the plain list holds a place that breaks a requirement and AFTERGLOW still has
          places to offer, so it was not picked by hand. The plain list held such a place in{' '}
          {example.plainBreaking.count} of {example.plainBreaking.total} scenarios. A place is
          marked only where a fact is known to be against it.
        </figcaption>
      </div>
    </figure>
  );
}

function HeldOutSummary({
  run,
  swapUnchanged,
}: {
  run: BaselineRunView;
  swapUnchanged: number | null;
}) {
  const { plainBreaking, gatedBreaking, vibe } = run.headline;
  return (
    <section className="panel" aria-labelledby="home-heldout">
      <h2 id="home-heldout">What the comparison on new cities showed</h2>
      <p className="muted-text" style={{ marginTop: '0.4rem' }}>
        {run.completed} plans in five cities the product was not developed on, ranked from the same
        Qloo places in one run on {new Date(run.generatedAt).toISOString().slice(0, 10)}, after the
        predictions were written down.
      </p>
      <div
        className="table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Plans whose top three breaks a requirement"
      >
        <table className="data compact" style={{ marginTop: '0.8rem' }}>
          <thead>
            <tr>
              <th scope="col">Approach</th>
              <th scope="col">Plans where the top three holds a place that breaks a requirement</th>
            </tr>
          </thead>
          <tbody>
            {plainBreaking.map((row) => (
              <tr key={row.approach}>
                <th scope="row">{row.approach}, without the gate</th>
                <td>
                  {row.count} of {row.total}
                </td>
              </tr>
            ))}
            {gatedBreaking ? (
              <tr>
                <th scope="row">AFTERGLOW, with the gate</th>
                <td>
                  {gatedBreaking.count} of {gatedBreaking.total}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p style={{ marginTop: '0.9rem' }}>
        That result comes from the gate and not from the taste ranking. A place is ruled out only
        when a known fact is against it, and on Qloo data that means its hours, price or distance.
      </p>
      <p style={{ marginTop: '0.6rem' }}>
        The Qloo order is the weaker part. The requested vibe was in the top three about as often as
        in a nearest first list ({twoPlaces(vibe.afterglow)} against {twoPlaces(vibe.nearest)}).
        {swapUnchanged !== null
          ? ` In the earlier evaluation, ranking with another group's signals left ${Math.round(swapUnchanged * 100)} percent of the top three unchanged.`
          : ''}{' '}
        {run.hits} of {run.hits + run.misses + run.notEvaluated} predictions were met and{' '}
        {run.misses} was missed.
      </p>
      <p style={{ marginTop: '0.8rem' }}>
        <a href="#/evidence">Read the method, the misses and the limits</a>
      </p>
    </section>
  );
}

function OrderList({ places }: { places: OrderedPlace[] }) {
  return (
    <ol className="order-list">
      {places.map((place) => (
        <li key={place.name}>
          <span className="name">{place.name}</span>
          <span className="small muted-text">
            {place.km === null ? 'distance unknown' : `${place.km.toFixed(1)} km`}
            {place.affinity === null ? '' : `, Qloo affinity ${place.affinity.toFixed(2)}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

function RecordedOrderPanel({ order }: { order: RecordedOrder }) {
  const when = new Date(order.generatedAt).toISOString().slice(0, 10);
  return (
    <section className="panel" aria-labelledby="home-order">
      <h2 id="home-order">What the Qloo signal changes</h2>
      <p className="muted-text" style={{ marginTop: '0.4rem' }}>
        {order.title}. Both lists are drawn from the same places, all of which passed the gate.
      </p>
      <div className="order-compare">
        <div>
          <h3>Nearest first, no taste data</h3>
          <OrderList places={order.nearest} />
        </div>
        <div>
          <h3>AFTERGLOW, Qloo taste blended with closeness</h3>
          <OrderList places={order.afterglow} />
        </div>
      </div>
      <p className="small muted-text" style={{ marginTop: '0.8rem' }}>
        Recorded on {when} from live Qloo data. This is the first scenario in the file where the two
        first choices differ, so it was not picked by hand. They differ in{' '}
        {order.firstChoicesDiffer.count} of {order.firstChoicesDiffer.total} scenarios. That shows
        that the Qloo signal changes the order. It does not show that people would prefer it.
      </p>
    </section>
  );
}

export function Home() {
  const [showcase, setShowcase] = useState<Showcase | null>(null);
  const [showcaseFailed, setShowcaseFailed] = useState(false);
  const [presets, setPresets] = useState<ScenarioPreset[]>([]);
  const [heldOut, setHeldOut] = useState<BaselineRunView | null>(null);
  const [swapUnchanged, setSwapUnchanged] = useState<number | null>(null);
  const [recorded, setRecorded] = useState<RecordedExample | null>(null);
  const [order, setOrder] = useState<RecordedOrder | null>(null);
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
        setHeldOut(result.baselineRuns.find((run) => run.set === 'test') ?? null);
        setSwapUnchanged(swapOverlap(result.liveRuns));
        setRecorded(result.recordedExample);
        setOrder(result.recordedOrder);
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
            alternatives using Qloo taste data, rules out a place when a known fact is against it,
            and asks you to check the rest.
          </p>
          {livePresets.length > 0 && chosenLive ? (
            <div className="hero-live" role="group" aria-labelledby="home-live">
              <h2 id="home-live">Run it on real Qloo data</h2>
              <p className="small muted-text">
                {chosenLive.summary} Opening this case asks Qloo for places and a taste ranking. It
                can take up to half a minute, and each address can open a limited number of live
                cases an hour.
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
                  Asking Qloo. This can take up to half a minute on the first request after the
                  server has been idle.
                </p>
              ) : null}
              {liveError ? (
                <p className="error" role="alert" style={{ marginTop: '0.6rem' }}>
                  {liveError}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="button-row">
            <a className={livePresets.length > 0 ? 'btn' : 'btn primary'} href="#/new">
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

      {heldOut ? <HeldOutSummary run={heldOut} swapUnchanged={swapUnchanged} /> : null}

      {order ? <RecordedOrderPanel order={order} /> : null}

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
