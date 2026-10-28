import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { clientKey, windowLimiter } from '../../src/interfaces/http/rate-limit.js';

const request = (forwarded?: string, address = '10.0.0.1'): Request =>
  ({
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
    socket: { remoteAddress: address },
  }) as unknown as Request;

describe('window limiter', () => {
  it('allows the limit, refuses beyond it, and starts again after the window', () => {
    let clock = 0;
    const limiter = windowLimiter({
      limit: 2,
      windowMs: 1_000,
      trustProxy: false,
      now: () => clock,
    });
    expect(limiter.take(request()).allowed).toBe(true);
    expect(limiter.take(request()).allowed).toBe(true);
    const refused = limiter.take(request());
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(1);
    clock = 1_000;
    expect(limiter.take(request()).allowed).toBe(true);
  });

  it('counts each address on its own', () => {
    const limiter = windowLimiter({ limit: 1, windowMs: 1_000, trustProxy: false });
    expect(limiter.take(request(undefined, '10.0.0.1')).allowed).toBe(true);
    expect(limiter.take(request(undefined, '10.0.0.2')).allowed).toBe(true);
    expect(limiter.take(request(undefined, '10.0.0.1')).allowed).toBe(false);
  });

  it('is off when the limit is zero', () => {
    const limiter = windowLimiter({ limit: 0, windowMs: 1_000, trustProxy: false });
    for (let i = 0; i < 10; i += 1) expect(limiter.take(request()).allowed).toBe(true);
  });
});

describe('client address', () => {
  it('uses the connection address unless a proxy is trusted', () => {
    expect(clientKey(request('1.2.3.4, 5.6.7.8'), false)).toBe('10.0.0.1');
  });

  it('uses the last forwarded address behind one trusted proxy, which a visitor cannot forge', () => {
    expect(clientKey(request('9.9.9.9, 5.6.7.8'), true)).toBe('5.6.7.8');
    expect(clientKey(request(), true)).toBe('10.0.0.1');
  });
});
