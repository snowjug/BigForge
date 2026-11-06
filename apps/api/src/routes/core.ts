import { type Platform } from '@bigforge/platform';
import {
  METRIC_DEFINITIONS,
  type ApiError,
  type RunSummaryDto,
  type TaskDto,
} from '@bigforge/schemas';
import { PageQuery } from '@bigforge/schemas';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SESSION_COOKIE, issueSession, parseBody, requireActor } from '../app';
import { AppError } from '@bigforge/platform';

const LoginBody = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
const IntakeBody = z.object({ scenarioId: z.string().min(1).max(40) });
const EnvBody = z.object({ toolchainVersion: z.string().min(1).max(20) });
const RunBody = z.object({ mode: z.enum(['baseline', 'auto', 'compare']) });
const MatchBody = z.object({
  prompt: z.string().min(1).max(2000),
  log: z.string().max(100_000).nullable().optional(),
});
const TaskListQuery = PageQuery.extend({
  status: z.enum(['received', 'solved', 'failed', 'observed']).optional(),
  origin: z.enum(['intake', 'noise', 'canary', 'reference']).optional(),
});
const RunListQuery = PageQuery.extend({
  taskId: z.string().max(80).optional(),
  kind: z.string().max(40).optional(),
});

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_TRACKED_MAX = 5_000;

export function registerCoreRoutes(
  app: FastifyInstance,
  platform: Platform,
  secureCookies: boolean,
): void {
  const attempts = new Map<string, { count: number; resetAt: number }>();

  /** Keeps the limiter's memory bounded: drops expired windows, then the oldest entries. */
  const prune = (now: number): void => {
    if (attempts.size < LOGIN_TRACKED_MAX) return;
    for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);
    for (const key of attempts.keys()) {
      if (attempts.size < LOGIN_TRACKED_MAX) break;
      attempts.delete(key);
    }
  };

  // ---- auth ----
  app.get('/api/auth/personas', () => ({
    personas: platform.personas(),
    passwordHint: platform.config.mode === 'demo' ? 'forge-demo' : null,
  }));

  app.post('/api/auth/login', (req, reply) => {
    const body = parseBody(LoginBody, req.body);
    const key = `${req.ip}|${body.email.toLowerCase()}`;
    const now = Date.now();
    prune(now);
    const entry = attempts.get(key);
    if (entry && entry.resetAt > now && entry.count >= LOGIN_MAX_ATTEMPTS) {
      throw new AppError(429, 'rate_limited', 'Too many sign-in attempts. Try again in a minute.');
    }
    try {
      const user = platform.login(body.email, body.password);
      attempts.delete(key);
      issueSession(platform, reply, user, secureCookies);
      platform.auditFor(
        user.tenant.id,
        user.displayName,
        'auth.login',
        'user',
        user.id,
        `${user.displayName} signed in (${user.role})`,
        { role: user.role },
      );
      return { user };
    } catch (err) {
      attempts.set(key, {
        count: (entry && entry.resetAt > now ? entry.count : 0) + 1,
        resetAt: entry && entry.resetAt > now ? entry.resetAt : now + LOGIN_WINDOW_MS,
      });
      throw err;
    }
  });

  app.post('/api/auth/logout', (_req, reply) => {
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', (req) => {
    const user = req.actor ? platform.store.getUser(req.actor.userId) : null;
    return { user: user ? platform.sessionUser(user) : null, mode: platform.config.mode };
  });

  // ---- system ----
  app.get('/api/system', (req) => platform.system(requireActor(req).tenantId));
  app.get('/api/metrics/definitions', () => METRIC_DEFINITIONS);

  // ---- lab ----
  app.get('/api/lab/scenarios', (req) => {
    const a = requireActor(req);
    return { scenarios: platform.tasks.scenarios(platform.store.forTenant(a.tenantId)) };
  });
  app.get('/api/lab/environment', (req) =>
    platform.tasks.environmentDto(platform.store.forTenant(requireActor(req).tenantId)),
  );
  app.post('/api/lab/environment', (req) =>
    platform.tasks.setEnvironment(requireActor(req), parseBody(EnvBody, req.body).toolchainVersion),
  );

  // ---- tasks ----
  app.post('/api/tasks', async (req, reply) => {
    const a = requireActor(req);
    const task = await platform.tasks.intake(a, parseBody(IntakeBody, req.body).scenarioId);
    void reply.status(201);
    const ts = platform.store.forTenant(a.tenantId);
    return platform.tasks.detail(ts, task);
  });

  app.get('/api/tasks', (req) => {
    const a = requireActor(req);
    const q = parseBody(TaskListQuery, req.query);
    const ts = platform.store.forTenant(a.tenantId);
    const where: Record<string, string> = {};
    if (q.status) where.status = q.status;
    if (q.origin) where.origin = q.origin;
    const page = ts.tasks.list(ts.tenantId, {
      where,
      limit: q.limit,
      ...(q.cursor ? { cursor: q.cursor } : {}),
      fields: [
        'id',
        'scenarioId',
        'variantKey',
        'scenarioRole',
        'title',
        'prompt',
        'envVersion',
        'status',
        'origin',
        'fingerprint',
        'match',
        'familyId',
        'createdAt',
      ],
    });
    return { ...page, items: page.items.map<TaskDto>((t) => platform.taskDto(t)) };
  });

  app.get('/api/tasks/:id', (req) => {
    const a = requireActor(req);
    const { id } = parseBody(z.object({ id: z.string().max(80) }), req.params);
    const ts = platform.store.forTenant(a.tenantId);
    const task = ts.tasks.get(ts.tenantId, id);
    if (!task) throw new AppError(404, 'not_found', 'Task not found');
    return platform.tasks.detail(ts, task);
  });

  app.post('/api/tasks/:id/match', (req) => {
    const a = requireActor(req);
    const { id } = parseBody(z.object({ id: z.string().max(80) }), req.params);
    return platform.tasks.matchTask(a, id);
  });

  app.post('/api/tasks/:id/run', async (req) => {
    const a = requireActor(req);
    const { id } = parseBody(z.object({ id: z.string().max(80) }), req.params);
    const { mode } = parseBody(RunBody, req.body);
    return platform.tasks.run(a, id, mode);
  });

  /** Ad-hoc matcher playground: fingerprints text, never executes anything. */
  app.post('/api/match', (req) => {
    const a = requireActor(req);
    const body = parseBody(MatchBody, req.body);
    const ts = platform.store.forTenant(a.tenantId);
    return platform.tasks.matchText(ts, body.prompt, body.log ?? null);
  });

  // ---- runs ----
  app.get('/api/runs', (req) => {
    const a = requireActor(req);
    const q = parseBody(RunListQuery, req.query);
    const ts = platform.store.forTenant(a.tenantId);
    const where: Record<string, string> = {};
    if (q.taskId) where.taskId = q.taskId;
    if (q.kind) where.kind = q.kind;
    const page = ts.runs.list(ts.tenantId, {
      where,
      limit: q.limit,
      ...(q.cursor ? { cursor: q.cursor } : {}),
      fields: [
        'id',
        'taskId',
        'kind',
        'status',
        'reflexVersionId',
        'groupId',
        'createdAt',
        'usage',
        'trace',
      ],
    });
    return { ...page, items: page.items.map<RunSummaryDto>((r) => platform.runSummary(r)) };
  });

  app.get('/api/runs/:id', (req) => {
    const a = requireActor(req);
    const { id } = parseBody(z.object({ id: z.string().max(80) }), req.params);
    return platform.runDetail(a.tenantId, id);
  });

  // ---- families ----
  app.get('/api/families', (req) => {
    const a = requireActor(req);
    const ts = platform.store.forTenant(a.tenantId);
    return platform.learning.view(ts, null);
  });
  app.post('/api/families/discover', async (req) =>
    platform.learning.discoverFamilies(requireActor(req)),
  );
  app.get('/api/matcher/evaluation', async (req) => {
    const a = requireActor(req);
    const evaluation = await platform.learning.measureMatcher(platform.store.forTenant(a.tenantId));
    return { evaluation };
  });
}

export type { ApiError };
