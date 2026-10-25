import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { z } from 'zod';
import { AppError } from '../../application/errors.js';
import type { RecoveryService } from '../../application/recovery-service.js';
import { sessionKeyFromToken } from '../../application/session.js';
import { caseModeSchema } from '../../domain/case.js';
import { disruptionSchema } from '../../domain/plan.js';
import { buildShowcase, type Showcase } from '../../evaluation/showcase.js';
import { scenarios } from '../../simulation/scenarios.js';
import { rateLimit } from './rate-limit.js';

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  code?: string;
  message: string;
}

export interface IntegrationStatus {
  liveConfigured: boolean;
  qlooBaseUrl: string;
  qlooCallsToday: number | null;
  qlooDailyCap: number;
  /** Runs a minimal authenticated call to Qloo. Null when no key is configured. */
  probe: (() => Promise<ProbeResult>) | null;
}

export interface AppOptions {
  service: RecoveryService;
  integration: IntegrationStatus;
  version: string;
  host: string;
  port: number;
  accessToken?: string | undefined;
  allowedOrigins: string[];
  rateLimitPerMinute: number;
  trustProxy: boolean;
  serveWeb: boolean;
  webRoot: string;
  evaluationRoot: string;
  publicDemo: boolean;
}

const SESSION_PATTERN = /^[A-Za-z0-9_-]{22,64}$/u;

function sessionKeyOf(req: Request): string {
  const header = req.header('x-afterglow-session');
  if (!header || !SESSION_PATTERN.test(header)) {
    throw new AppError('session_required', 'A valid session header is required.', 400);
  }
  return sessionKeyFromToken(header);
}

function wrap(
  handler: (req: Request, res: Response) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  };
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const openBody = z.object({
  mode: caseModeSchema,
  anchor: z.unknown(),
  disruption: z.unknown(),
});
const choiceBody = z.object({
  key: z.string().min(1).max(300),
  chosenId: z.string().min(1).max(300).optional(),
  skip: z.boolean().optional(),
});
const attestBody = z.object({
  candidateId: z.string().min(1).max(200),
  constraintKey: z.string().min(1).max(80),
  satisfied: z.boolean(),
});
const relaxBody = z.object({ constraintKeys: z.array(z.string().min(1).max(80)).min(1).max(10) });
const reasonBody = z.object({ reason: z.string().trim().max(200).optional() });
const noteBody = z.object({ note: z.string().trim().max(200).optional() });
const closeBody = z.object({ outcome: z.enum(['recovered', 'abandoned']) });
const disruptionBody = z.object({ disruption: disruptionSchema });

function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const message = result.error.issues
      .slice(0, 4)
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new AppError('invalid_request', message, 400);
  }
  return result.data;
}

export function createApp(options: AppOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const bindsLoopback = ['127.0.0.1', 'localhost', '::1'].includes(options.host);
  const allowedOrigins = new Set(options.allowedOrigins);

  // Security headers for every response.
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    next();
  });

  // Host check protects a loopback server from DNS rebinding.
  app.use((req, res, next) => {
    if (bindsLoopback) {
      const hostname = (req.headers.host ?? '').replace(/:\d+$/u, '');
      if (!loopbackHosts.has(hostname)) {
        res.status(403).json({ error: { code: 'bad_host', message: 'Unexpected Host header.' } });
        return;
      }
    }
    next();
  });

  // Cross origin writes are refused unless the origin matches the host or is listed.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      const sameHost = (() => {
        try {
          return new URL(origin).host === req.headers.host;
        } catch {
          return false;
        }
      })();
      if (!sameHost && !allowedOrigins.has(origin)) {
        res
          .status(403)
          .json({ error: { code: 'bad_origin', message: 'This origin is not allowed.' } });
        return;
      }
    }
    next();
  });

  app.use(
    '/api',
    rateLimit({ perMinute: options.rateLimitPerMinute, trustProxy: options.trustProxy }),
  );

  if (options.accessToken) {
    const expected = options.accessToken;
    app.use('/api', (req, res, next) => {
      if (req.path === '/health') {
        next();
        return;
      }
      const header = req.headers.authorization ?? '';
      const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!provided || !tokenMatches(provided, expected)) {
        res
          .status(401)
          .json({ error: { code: 'unauthorised', message: 'A valid access token is required.' } });
        return;
      }
      next();
    });
  }

  app.use('/api', express.json({ limit: '64kb' }));

  const api = express.Router();
  const { service, integration } = options;

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: options.version });
  });

  api.get('/status', (_req, res) => {
    const providers = service.describeProviders();
    res.json({
      version: options.version,
      publicDemo: options.publicDemo,
      modes: {
        live: {
          configured: integration.liveConfigured,
          label: providers.live.label,
          baseUrl: integration.qlooBaseUrl,
          callsToday: integration.qlooCallsToday,
          dailyCap: integration.qlooDailyCap,
        },
        demo: {
          configured: true,
          label: providers.demo.label,
          cities: providers.demo.supportedCities ?? [],
        },
      },
    });
  });

  api.post(
    '/integration/probe',
    wrap(async (_req, res) => {
      if (!integration.probe) {
        res.status(503).json({
          error: {
            code: 'QLOO_NOT_CONFIGURED',
            message: 'No Qloo API key is configured on this server.',
          },
        });
        return;
      }
      res.json(await integration.probe());
    }),
  );

  api.get('/scenarios', (_req, res) => {
    res.json({
      scenarios: scenarios
        .filter((scenario) => scenario.featured)
        .map(({ id, title, summary, anchor, disruption, choices }) => ({
          id,
          title,
          summary,
          anchor,
          disruption,
          ...(choices ? { choices } : {}),
        })),
    });
  });

  api.get('/evaluation', (_req, res) => {
    const readAll = (prefix: string): unknown[] => {
      const found: unknown[] = [];
      if (!existsSync(options.evaluationRoot)) return found;
      for (const file of readdirSync(options.evaluationRoot)
        .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
        .sort()) {
        try {
          found.push(JSON.parse(readFileSync(join(options.evaluationRoot, file), 'utf8')));
        } catch {
          // A malformed file is skipped rather than failing the page.
        }
      }
      return found;
    };
    res.json({ reports: readAll('report-'), smoke: readAll('smoke-') });
  });

  let showcase: Promise<Showcase> | null = null;
  api.get(
    '/showcase',
    wrap(async (_req, res) => {
      showcase ??= buildShowcase();
      try {
        res.json(await showcase);
      } catch (error) {
        showcase = null;
        throw error;
      }
    }),
  );

  api.get(
    '/cases',
    wrap((req, res) => res.json({ cases: service.listCases(sessionKeyOf(req)) })),
  );

  api.post(
    '/cases',
    wrap(async (req, res) => {
      const body = parseBody(openBody, req.body);
      const view = await service.openCase(sessionKeyOf(req), body);
      res.status(201).json(view);
    }),
  );

  api.get(
    '/cases/:id',
    wrap((req, res) => res.json(service.getCase(sessionKeyOf(req), String(req.params['id'])))),
  );

  api.delete(
    '/cases/:id',
    wrap((req, res) => {
      service.deleteCase(sessionKeyOf(req), String(req.params['id']));
      res.status(204).end();
    }),
  );

  api.get(
    '/cases/:id/provenance',
    wrap((req, res) =>
      res.json(service.getProvenance(sessionKeyOf(req), String(req.params['id']))),
    ),
  );

  api.get(
    '/cases/:id/trace',
    wrap((req, res) => res.json(service.getTrace(sessionKeyOf(req), String(req.params['id'])))),
  );

  api.post(
    '/cases/:id/choices',
    wrap(async (req, res) => {
      const body = parseBody(choiceBody, req.body);
      res.json(
        await service.chooseResolution(sessionKeyOf(req), String(req.params['id']), {
          key: body.key,
          ...(body.chosenId !== undefined ? { chosenId: body.chosenId } : {}),
          ...(body.skip !== undefined ? { skip: body.skip } : {}),
        }),
      );
    }),
  );

  api.post(
    '/cases/:id/disruptions',
    wrap(async (req, res) => {
      const body = parseBody(disruptionBody, req.body);
      res.json(
        await service.recordDisruption(
          sessionKeyOf(req),
          String(req.params['id']),
          body.disruption,
        ),
      );
    }),
  );

  api.post(
    '/cases/:id/search',
    wrap(async (req, res) =>
      res.json(await service.rerunSearch(sessionKeyOf(req), String(req.params['id']))),
    ),
  );

  api.post(
    '/cases/:id/attestations',
    wrap(async (req, res) => {
      const body = parseBody(attestBody, req.body);
      res.json(await service.attestFact(sessionKeyOf(req), String(req.params['id']), body));
    }),
  );

  api.post(
    '/cases/:id/relaxations',
    wrap(async (req, res) => {
      const body = parseBody(relaxBody, req.body);
      res.json(
        await service.relaxConstraints(
          sessionKeyOf(req),
          String(req.params['id']),
          body.constraintKeys,
        ),
      );
    }),
  );

  api.post(
    '/cases/:id/options/:candidateId/reject',
    wrap(async (req, res) => {
      const body = parseBody(reasonBody, req.body);
      res.json(
        await service.rejectOption(
          sessionKeyOf(req),
          String(req.params['id']),
          String(req.params['candidateId']),
          body.reason,
        ),
      );
    }),
  );

  api.post(
    '/cases/:id/options/:candidateId/attempt',
    wrap(async (req, res) =>
      res.json(
        await service.startAttempt(
          sessionKeyOf(req),
          String(req.params['id']),
          String(req.params['candidateId']),
        ),
      ),
    ),
  );

  api.post(
    '/cases/:id/options/:candidateId/confirm',
    wrap(async (req, res) =>
      res.json(
        await service.confirmAttempt(
          sessionKeyOf(req),
          String(req.params['id']),
          String(req.params['candidateId']),
        ),
      ),
    ),
  );

  api.post(
    '/cases/:id/options/:candidateId/fail',
    wrap(async (req, res) => {
      const body = parseBody(noteBody, req.body);
      res.json(
        await service.failAttempt(
          sessionKeyOf(req),
          String(req.params['id']),
          String(req.params['candidateId']),
          body.note,
        ),
      );
    }),
  );

  api.post(
    '/cases/:id/close',
    wrap(async (req, res) => {
      const body = parseBody(closeBody, req.body);
      res.json(await service.closeCase(sessionKeyOf(req), String(req.params['id']), body.outcome));
    }),
  );

  api.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint.' } });
  });

  app.use('/api', api);

  if (options.serveWeb) {
    const root = resolve(options.webRoot);
    if (existsSync(join(root, 'index.html'))) {
      app.use(express.static(root, { index: false, maxAge: '1h' }));
      app.get(/^(?!\/api\/).*/u, (_req, res) => {
        res.sendFile(join(root, 'index.html'));
      });
    }
  }

  const onError: ErrorRequestHandler = (
    error: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof AppError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    const status = (error as { status?: number }).status;
    if (status === 400 || (error as { type?: string }).type === 'entity.parse.failed') {
      res
        .status(400)
        .json({ error: { code: 'invalid_json', message: 'The request body is not valid JSON.' } });
      return;
    }
    if (status === 413) {
      res
        .status(413)
        .json({ error: { code: 'too_large', message: 'The request body is too large.' } });
      return;
    }
    console.error('Unhandled error:', error instanceof Error ? error.message : 'unknown');
    res
      .status(500)
      .json({ error: { code: 'internal', message: 'Something went wrong on the server.' } });
  };
  app.use(onError);

  return app;
}
