/** Small, dependency free statistics for the live evaluation. */

/** A seeded generator, so that a bootstrap gives the same interval every time it is run. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MeanInterval {
  n: number;
  mean: number;
  low: number;
  high: number;
}

export const BOOTSTRAP_SEED = 20261025;
export const BOOTSTRAP_RESAMPLES = 10_000;

/** The mean with a 95 percent percentile bootstrap interval across scenarios. */
export function bootstrapMean(values: readonly number[]): MeanInterval | null {
  if (values.length === 0) return null;
  const n = values.length;
  const average = (items: readonly number[]) => items.reduce((a, b) => a + b, 0) / items.length;
  const random = mulberry32(BOOTSTRAP_SEED);
  const means: number[] = [];
  for (let r = 0; r < BOOTSTRAP_RESAMPLES; r += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += values[Math.floor(random() * n)] as number;
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) =>
    means[Math.min(means.length - 1, Math.floor(q * means.length))] as number;
  return { n, mean: average(values), low: at(0.025), high: at(0.975) };
}

export interface ProportionInterval {
  count: number;
  total: number;
  share: number;
  low: number;
  high: number;
}

/** A proportion with its 95 percent Wilson score interval. */
export function wilson(count: number, total: number): ProportionInterval | null {
  if (total === 0) return null;
  const z = 1.959964;
  const p = count / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return {
    count,
    total,
    share: p,
    low: Math.max(0, centre - margin),
    high: Math.min(1, centre + margin),
  };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
