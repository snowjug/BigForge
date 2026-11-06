import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { type Actor, AppError, type Platform } from '@bigforge/platform';
import { signSession, verifySession } from '@bigforge/security';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import { registerCoreRoutes } from './routes/core';
import { registerOpsRoutes } from './routes/ops';
import { registerReflexRoutes } from './routes/reflexes';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

export const SESSION_COOKIE = 'bf_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/ready',
  '/api/auth/login',
  '/api/auth/personas',
  '/api/auth/me',
  '/api/auth/logout',
]);

export interface AppOptions {
  /** Directory of the built web app (index.html + assets). Omit to serve the API only. */
  webDir?: string | undefined;
  logger?: boolean;
  secureCookies?: boolean;
}

export function parseBody<T>(schema: ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new AppError(
      400,
      'bad_request',
      'The request did not match the expected shape',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  return parsed.data;
}

export function requireActor(req: FastifyRequest): Actor {
  if (!req.actor) throw new AppError(401, 'unauthenticated', 'Sign in to continue');
  return req.actor;
}

export function issueSession(
  platform: Platform,
  reply: FastifyReply,
  user: { id: string; tenant: { id: string }; role: string },
  secure: boolean,
): void {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = signSession(
    { sub: user.id, tenant: user.tenant.id, role: user.role, exp },
    platform.config.sessionSecret,
  );
  void reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    secure,
  });
}

export async function buildApp(
  platform: Platform,
  options: AppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger
      ? {
          level: process.env.LOG_LEVEL ?? 'info',
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        }
      : false,
    bodyLimit: 256 * 1024,
    trustProxy: false,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // Accept empty JSON bodies as {} and report malformed JSON as a clean 400.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (typeof body !== 'string' || body.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch {
      done(new AppError(400, 'bad_request', 'The request body is not valid JSON'), undefined);
    }
  });

  app.decorateRequest('actor', null);

  // Authentication: a signed session cookie, re-validated against the database on every request.
  app.addHook('onRequest', (req, _reply, done) => {
    req.actor = null;
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const claims = verifySession(
        token,
        platform.config.sessionSecret,
        Math.floor(Date.now() / 1000),
      );
      if (claims) req.actor = platform.actorFor(claims.sub);
    }
    done();
  });

  // CSRF defence: mutating API calls must carry a custom header, which browsers cannot add cross-site without a CORS preflight (not granted).
  app.addHook('onRequest', (req, _reply, done) => {
    const mutating = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (mutating && req.url.startsWith('/api/') && req.headers['x-bigforge-client'] !== 'web') {
      done(new AppError(403, 'csrf', 'Missing X-BigForge-Client header'));
      return;
    }
    done();
  });

  app.addHook('onRequest', (req, _reply, done) => {
    const pathname = req.url.split('?')[0] ?? '';
    if (pathname.startsWith('/api/') && !PUBLIC_PATHS.has(pathname) && !req.actor) {
      done(new AppError(401, 'unauthenticated', 'Sign in to continue'));
      return;
    }
    done();
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      void reply
        .status(err.status)
        .send({
          error: {
            code: err.code,
            message: err.message,
            ...(err.details !== undefined ? { details: err.details } : {}),
          },
        });
      return;
    }
    if (err instanceof ZodError) {
      void reply
        .status(400)
        .send({
          error: { code: 'bad_request', message: 'The request did not match the expected shape' },
        });
      return;
    }
    const status =
      typeof (err as { statusCode?: number }).statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    if (status >= 500) req.log.error({ err }, 'Unhandled error');
    void reply
      .status(status)
      .send({
        error: {
          code: status >= 500 ? 'internal_error' : 'request_error',
          message: status >= 500 ? 'Something went wrong on the server' : (err instanceof Error ? err.message : 'Bad request'),
        },
      });
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      void reply.status(404).send({ error: { code: 'not_found', message: 'No such endpoint' } });
      return;
    }
    const webDir = options.webDir;
    if (req.method === 'GET' && webDir && existsSync(path.join(webDir, 'index.html'))) {
      void reply.type('text/html').sendFile('index.html');
      return;
    }
    void reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } });
  });

  app.get('/api/health', () => ({ status: 'ok', time: new Date().toISOString() }));
  app.get('/api/ready', (_req, reply) => {
    const r = platform.ready();
    void reply.status(r.ok ? 200 : 503);
    return { status: r.ok ? 'ready' : 'not_ready', checks: r.checks };
  });

  const secure = options.secureCookies ?? platform.config.mode === 'production';
  registerCoreRoutes(app, platform, secure);
  registerReflexRoutes(app, platform);
  registerOpsRoutes(app, platform);

  if (options.webDir && existsSync(options.webDir)) {
    await app.register(fastifyStatic, {
      root: options.webDir,
      wildcard: false,
      cacheControl: true,
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.header('Cache-Control', 'no-cache');
      },
    });
  }
  return app;
}
