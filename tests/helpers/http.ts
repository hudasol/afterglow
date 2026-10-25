import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  createApp,
  type AppOptions,
  type IntegrationStatus,
} from '../../src/interfaces/http/app.js';
import { makeService } from './service.js';

/** Test responses are read as loosely typed JSON. Assertions check the fields they care about. */
export interface TestResponse extends Omit<Response, 'json'> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json(): Promise<any>;
}

export const SESSION_HEADER = 'x-afterglow-session';
export const SESSION = 'abcdefghijklmnopqrstuv0123456789';

export async function startServer(
  overrides: Partial<AppOptions> = {},
  integration?: Partial<IntegrationStatus>,
) {
  const { service } = makeService();
  const app = createApp({
    service,
    integration: {
      liveConfigured: false,
      qlooBaseUrl: 'https://hackathon.api.qloo.com',
      qlooCallsToday: null,
      qlooDailyCap: 2000,
      probe: null,
      ...integration,
    },
    version: 'test',
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: [],
    rateLimitPerMinute: 0,
    trustProxy: false,
    serveWeb: false,
    webRoot: 'web/dist',
    evaluationRoot: 'data/evaluation',
    publicDemo: false,
    ...overrides,
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const request = (path: string, init: RequestInit = {}): Promise<TestResponse> =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        [SESSION_HEADER]: SESSION,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string>),
      },
    }) as Promise<TestResponse>;
  return {
    base,
    request,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
