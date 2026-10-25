/** Small, dependency free list comparison metrics used by the Taste On and Taste Off report. */

export function overlapAtK(a: readonly string[], b: readonly string[], k: number): number | null {
  const limit = Math.min(k, a.length, b.length);
  if (limit === 0) return null;
  const top = new Set(a.slice(0, limit));
  let shared = 0;
  for (const id of b.slice(0, limit)) if (top.has(id)) shared += 1;
  return shared / limit;
}

/** Kendall tau between two orderings, computed over the items present in both. */
export function kendallTau(a: readonly string[], b: readonly string[]): number | null {
  const positionInB = new Map(b.map((id, index) => [id, index]));
  const shared = a.filter((id) => positionInB.has(id));
  if (shared.length < 2) return null;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < shared.length; i += 1) {
    for (let j = i + 1; j < shared.length; j += 1) {
      const left = positionInB.get(shared[i] as string) as number;
      const right = positionInB.get(shared[j] as string) as number;
      if (left < right) concordant += 1;
      else discordant += 1;
    }
  }
  return (concordant - discordant) / (concordant + discordant);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
