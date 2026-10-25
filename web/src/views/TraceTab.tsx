import { useEffect, useState } from 'react';
import type { AgentTrace, TracePhase, TraceStep } from '../../../src/domain/trace.js';
import { api, ApiError } from '../lib/api';
import { formatStamp } from '../lib/format';

const PHASE_LABEL: Record<TracePhase, string> = {
  observe: 'Observed',
  plan: 'Planned',
  act: 'Did',
  decide: 'Decided',
  hand_over: 'Handed back',
};

/** Consecutive steps in the same phase read as one row. */
function groupByPhase(steps: readonly TraceStep[]): { phase: TracePhase; texts: string[] }[] {
  const rows: { phase: TracePhase; texts: string[] }[] = [];
  for (const step of steps) {
    const last = rows.at(-1);
    if (last && last.phase === step.phase) last.texts.push(step.text);
    else rows.push({ phase: step.phase, texts: [step.text] });
  }
  return rows;
}

export function TraceTab({ caseId, refreshKey }: { caseId: string; refreshKey: string }) {
  const [trace, setTrace] = useState<AgentTrace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .trace(caseId)
      .then((result) => {
        if (cancelled) return;
        setTrace(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(caught instanceof ApiError ? caught.message : 'The trace could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, refreshKey]);

  if (error) return <p className="error">{error}</p>;
  if (!trace) return <p className="muted-text">Loading the trace.</p>;

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="trace-intro">
        <h2 id="trace-intro">How the agent worked</h2>
        <p style={{ maxWidth: '62ch' }}>
          AFTERGLOW follows a fixed procedure. It is not a chat model and it does not improvise.
          Each cycle below lists what it observed, what it planned, what it did, what it decided and
          where it handed the decision back to you. The cycles are rebuilt from the recorded events.
          Nothing in them is added afterwards.
        </p>
      </section>

      <ol className="trace-cycles" aria-label="Cycles of the agent">
        {trace.cycles.map((cycle) => (
          <li key={cycle.number} className="panel trace-cycle">
            <header className="trace-head">
              <h3>
                Cycle {cycle.number}. {cycle.heading}
              </h3>
              <time dateTime={cycle.at}>{formatStamp(cycle.at)}</time>
            </header>
            {cycle.tally ? (
              <p className="trace-tally">
                <span className="pill ok">{cycle.tally.feasible} feasible</span>
                <span className="pill warn">{cycle.tally.needsVerification} need your check</span>
                <span className="pill bad">{cycle.tally.ruledOut} ruled out</span>
              </p>
            ) : (
              <p className="trace-tally">
                <span className="pill bad">Nothing ranked</span>
              </p>
            )}
            <dl className="trace-steps">
              {groupByPhase(cycle.steps).map((row, index) => (
                <div key={`${row.phase}-${index}`} className="trace-row" data-phase={row.phase}>
                  <dt>{PHASE_LABEL[row.phase]}</dt>
                  <dd>
                    <ul>
                      {row.texts.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ol>

      {trace.since.length > 0 ? (
        <section className="panel" aria-labelledby="trace-since">
          <h3 id="trace-since">
            {trace.cycles.length === 0 ? 'Before the first search' : 'Since the last cycle'}
          </h3>
          <ul className="trace-since">
            {trace.since.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
