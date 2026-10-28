import { describe, expect, it } from 'vitest';
import { memoiseAsync } from '../../src/shared/memoise-async.js';

describe('memoiseAsync', () => {
  it('repeats an answer within the window and asks again after it', async () => {
    let clock = 0;
    let calls = 0;
    const get = memoiseAsync(
      async () => ++calls,
      1_000,
      () => clock,
    );
    expect(await get()).toEqual({ value: 1, cached: false });
    clock = 999;
    expect(await get()).toEqual({ value: 1, cached: true });
    clock = 1_000;
    expect(await get()).toEqual({ value: 2, cached: false });
    expect(calls).toBe(2);
  });

  it('lets requests that arrive during a call share it', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const get = memoiseAsync(async () => {
      calls += 1;
      await gate;
      return 'done';
    }, 1_000);
    const first = get();
    const second = get();
    release?.();
    expect(await first).toEqual({ value: 'done', cached: false });
    expect(await second).toEqual({ value: 'done', cached: true });
    expect(calls).toBe(1);
  });

  it('keeps the result of a call that reports a failure as a value', async () => {
    let calls = 0;
    const get = memoiseAsync(async () => ({ ok: false, n: ++calls }), 1_000);
    await get();
    expect((await get()).value).toEqual({ ok: false, n: 1 });
    expect(calls).toBe(1);
  });

  it('does not keep a call that throws', async () => {
    let calls = 0;
    const get = memoiseAsync(async () => {
      calls += 1;
      if (calls === 1) throw new Error('down');
      return calls;
    }, 1_000);
    await expect(get()).rejects.toThrow('down');
    expect((await get()).value).toBe(2);
  });
});
