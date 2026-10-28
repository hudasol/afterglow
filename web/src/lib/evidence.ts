/**
 * Helpers that read the recorded evaluation runs for the landing page and the Evidence page.
 * The types are structural so that this file has no imports and the tests can load it directly.
 */

interface RecordedPrediction {
  id: string;
  observed: string;
  verdict: 'HIT' | 'MISS' | 'NOT EVALUATED';
}

interface RecordedRun<P extends RecordedPrediction> {
  predictions: P[];
}

/** Two decimal places, or a plain statement when the figure was not available. */
export const twoPlaces = (value: number | null): string =>
  value === null ? 'not available' : value.toFixed(2);

/** The recorded answer for one prediction in one run, or null when it is not there. */
function observedFigure(run: RecordedRun<RecordedPrediction> | undefined, id: string) {
  const observed = run?.predictions.find((prediction) => prediction.id === id)?.observed;
  const value = observed === undefined ? Number.NaN : Number.parseFloat(observed);
  return Number.isFinite(value) ? value : null;
}

/** The share of the top three that stayed the same when another group's signals were used, from the latest live run. */
export function swapOverlap(runs: RecordedRun<RecordedPrediction>[]): number | null {
  return observedFigure(runs[runs.length - 1], 'P4');
}

/** The prediction ids that were missed in every recorded live run. */
export function missedInEveryLiveRun(runs: RecordedRun<RecordedPrediction>[]): string[] {
  const [first, ...rest] = runs;
  if (!first) return [];
  const missed = (run: RecordedRun<RecordedPrediction>) =>
    run.predictions.filter((prediction) => prediction.verdict === 'MISS').map((p) => p.id);
  return missed(first).filter((id) => rest.every((run) => missed(run).includes(id)));
}

/** The predictions of a run that were missed, with the claim and what was predicted and observed. */
export function missedPredictions<P extends RecordedPrediction>(run: RecordedRun<P>): P[] {
  return run.predictions.filter((prediction) => prediction.verdict === 'MISS');
}
