import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/infrastructure/config.js';

describe('loadConfig', () => {
  it('starts with safe local defaults and no secrets', () => {
    const config = loadConfig({});
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.PORT).toBe(8788);
    expect(config.QLOO_API_KEY).toBeUndefined();
    expect(config.AFTERGLOW_ACCESS_TOKEN).toBeUndefined();
    expect(config.AFTERGLOW_OSM_FACTS).toBe(true);
    expect(config.AFTERGLOW_TRUST_PROXY).toBe(false);
  });

  it('treats an empty Qloo key as absent', () => {
    expect(loadConfig({ QLOO_API_KEY: '   ' }).QLOO_API_KEY).toBeUndefined();
    expect(loadConfig({ QLOO_API_KEY: ' abc ' }).QLOO_API_KEY).toBe('abc');
  });

  it('refuses a public address without a token or the public demo flag', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(/AFTERGLOW_ACCESS_TOKEN/);
    expect(() => loadConfig({ HOST: '0.0.0.0', AFTERGLOW_PUBLIC_DEMO: 'true' })).not.toThrow();
    expect(() =>
      loadConfig({ HOST: '0.0.0.0', AFTERGLOW_ACCESS_TOKEN: 'a'.repeat(16) }),
    ).not.toThrow();
  });

  it('rejects a token that is too short', () => {
    expect(() => loadConfig({ AFTERGLOW_ACCESS_TOKEN: 'short' })).toThrow(/Invalid configuration/);
  });

  it('names every invalid setting and never echoes a secret value', () => {
    const secret = 'sk-not-a-real-key-0000';
    try {
      loadConfig({ QLOO_API_KEY: secret, PORT: 'abc', QLOO_DAILY_CALL_CAP: '-1' });
      throw new Error('expected a failure');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('PORT');
      expect(message).toContain('QLOO_DAILY_CALL_CAP');
      expect(message).not.toContain(secret);
    }
  });

  it('trusts the first proxy on Render and only there', () => {
    expect(loadConfig({ RENDER: 'true' }).AFTERGLOW_TRUST_PROXY).toBe(true);
    expect(loadConfig({}).AFTERGLOW_TRUST_PROXY).toBe(false);
    expect(
      loadConfig({ RENDER: 'true', AFTERGLOW_TRUST_PROXY: 'false' }).AFTERGLOW_TRUST_PROXY,
    ).toBe(false);
  });

  it('accepts several https Overpass endpoints and rejects a plain http one', () => {
    const config = loadConfig({
      OVERPASS_URL: 'https://a.example/api/interpreter, https://b.example/api/interpreter',
    });
    expect(config.OVERPASS_URL).toEqual([
      'https://a.example/api/interpreter',
      'https://b.example/api/interpreter',
    ]);
    expect(() => loadConfig({ OVERPASS_URL: 'http://a.example/api' })).toThrow(/https/);
    expect(() => loadConfig({ OVERPASS_URL: 'http://127.0.0.1:9999/api' })).not.toThrow();
  });
});
