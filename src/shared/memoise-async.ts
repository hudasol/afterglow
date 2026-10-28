/**
 * Wraps an asynchronous call so that, for `ttlMs` after it finishes, callers get the same answer
 * and requests that arrive while it is running share the one call. The result of a failed call is
 * kept as well, so a service that is down is not asked more often than one that is up.
 */
export interface Memoised<T> {
  value: T;
  /** True when the value is the answer to an earlier call. */
  cached: boolean;
}

export function memoiseAsync<T>(
  call: () => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<Memoised<T>> {
  let last: { at: number; value: T } | null = null;
  let running: Promise<T> | null = null;
  return async () => {
    if (last && now() - last.at < ttlMs) return { value: last.value, cached: true };
    if (running) return { value: await running, cached: true };
    running = call().then((value) => {
      last = { at: now(), value };
      return value;
    });
    try {
      return { value: await running, cached: false };
    } finally {
      running = null;
    }
  };
}
