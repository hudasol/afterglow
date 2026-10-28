import type { BaselineRunView, LiveRunView } from '../lib/api';
import { missedPredictions, missedInEveryLiveRun, swapOverlap, twoPlaces } from '../lib/evidence';

/**
 * A plain summary that sits above the detail: what the recorded results support and what they do
 * not. Every figure is read from the recorded runs, so it cannot drift from the tables below.
 */
const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

export function EvidenceSummary({
  heldOut,
  liveRuns,
}: {
  heldOut: BaselineRunView | null;
  liveRuns: LiveRunView[];
}) {
  if (!heldOut) return null;
  const { plainBreaking, gatedBreaking, vibe } = heldOut.headline;
  const fewest = Math.min(...plainBreaking.map((row) => row.count));
  const most = Math.max(...plainBreaking.map((row) => row.count));
  const total = plainBreaking[0]?.total ?? heldOut.completed;
  const swap = swapOverlap(liveRuns);
  const missedLive = missedInEveryLiveRun(liveRuns);
  const missedHeldOut = missedPredictions(heldOut);

  return (
    <section className="panel" aria-labelledby="ev-summary">
      <h2 id="ev-summary">What the recorded results show</h2>
      <div className="summary-columns">
        <div>
          <h3>Supported</h3>
          <ul>
            <li>
              Without the gate, the top three held a place that breaks a requirement in {fewest} to{' '}
              {most} of {total} plans, depending on the approach.
              {gatedBreaking
                ? ` With the gate it did in ${gatedBreaking.count} of ${gatedBreaking.total} plans that had a list.`
                : ''}
            </li>
            <li>
              {heldOut.hits} of {heldOut.hits + heldOut.misses + heldOut.notEvaluated} predictions
              written before the test run were met. The gate does not depend on the taste ranking.
            </li>
          </ul>
        </div>
        <div>
          <h3>Not supported</h3>
          <ul>
            <li>
              That the Qloo order serves a group. The requested vibe was in the top three about as
              often as in a nearest first list ({twoPlaces(vibe.afterglow)} against{' '}
              {twoPlaces(vibe.nearest)}).
              {swap === null
                ? ''
                : ` With another group's signals, ${Math.round(swap * 100)} percent of the top three stayed the same.`}
              {missedLive.length > 0
                ? ` ${missedLive.length} live predictions about this were missed in every run.`
                : ''}
            </li>
            {missedHeldOut.map((prediction) => (
              <li key={prediction.id}>
                A prediction on the test scenarios was missed, the {lowerFirst(prediction.claim)}.
                Predicted {prediction.predicted}, observed {prediction.observed}.
              </li>
            ))}
            <li>Whether anyone would prefer the result. No people took part in any evaluation.</li>
            <li>How it compares with a language model. No such baseline was run.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}
