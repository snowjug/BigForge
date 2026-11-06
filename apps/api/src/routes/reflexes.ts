import { type Platform, AppError } from '@bigforge/platform';
import { PageQuery } from '@bigforge/schemas';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody, requireActor } from '../app';

const Id = z.object({ id: z.string().min(1).max(80) });
const Comment = z.object({ comment: z.string().max(1000).default('') });
const ShadowBody = z.object({ scenarioIds: z.array(z.string().max(20)).max(30).optional() });
const CompQuery = PageQuery.extend({
  kind: z.enum(['replay', 'shadow', 'canary', 'live']).optional(),
});
const EconQuery = z.object({
  executions: z.coerce.number().int().min(1).max(100_000).optional(),
  conservative: z.enum(['true', 'false']).optional(),
});

export function registerReflexRoutes(app: FastifyInstance, platform: Platform): void {
  const tenant = (req: Parameters<typeof requireActor>[0]) => {
    const actor = requireActor(req);
    return { actor, ts: platform.store.forTenant(actor.tenantId) };
  };

  app.get('/api/reflexes', (req) => {
    const { ts } = tenant(req);
    return { reflexes: platform.validation.listReflexes(ts) };
  });

  app.get('/api/reflexes/versions/:id', (req) => {
    const { actor, ts } = tenant(req);
    const { id } = parseBody(Id, req.params);
    return platform.validation.versionDto(actor, ts, platform.validation.getVersion(ts, id));
  });

  app.post('/api/families/:id/compile', async (req, reply) => {
    const { actor, ts } = tenant(req);
    const { id } = parseBody(Id, req.params);
    const version = await platform.learning.compile(actor, id);
    void reply.status(201);
    return platform.validation.versionDto(actor, ts, version);
  });

  app.post('/api/reflexes/versions/:id/replay', async (req) => {
    const { actor } = tenant(req);
    const { id } = parseBody(Id, req.params);
    return platform.validation.replay(actor, id);
  });

  app.post('/api/reflexes/versions/:id/shadow', (req, reply) => {
    const { actor, ts } = tenant(req);
    const { id } = parseBody(Id, req.params);
    platform.validation.getVersion(ts, id);
    const body = parseBody(ShadowBody, req.body ?? {});
    const job = platform.jobs.enqueue(actor, 'shadow', {
      versionId: id,
      scenarioIds: body.scenarioIds,
    });
    platform.jobs.kick();
    void reply.status(202);
    return { job: platform.jobs.toDto(job) };
  });

  app.get('/api/reflexes/versions/:id/comparisons', (req) => {
    const { ts } = tenant(req);
    const { id } = parseBody(Id, req.params);
    const q = parseBody(CompQuery, req.query);
    platform.validation.getVersion(ts, id);
    return platform.validation.comparisonsPage(ts, id, q.kind, q.limit, q.cursor);
  });

  app.post('/api/reflexes/versions/:id/promote', (req) => {
    const { actor, ts } = tenant(req);
    const { id } = parseBody(Id, req.params);
    const { comment } = parseBody(Comment, req.body ?? {});
    return platform.validation.versionDto(
      actor,
      ts,
      platform.validation.promote(actor, id, comment),
    );
  });

  app.post('/api/reflexes/versions/:id/reject', (req) => {
    const { actor, ts } = tenant(req);
    const { id } = parseBody(Id, req.params);
    const { comment } = parseBody(Comment, req.body ?? {});
    return platform.validation.versionDto(
      actor,
      ts,
      platform.validation.reject(actor, id, comment),
    );
  });

  app.post('/api/reflexes/versions/:id/rollback', (req) => {
    const { actor, ts } = tenant(req);
    const { id } = parseBody(Id, req.params);
    const { comment } = parseBody(Comment, req.body ?? {});
    return platform.validation.versionDto(
      actor,
      ts,
      platform.validation.rollback(actor, id, comment),
    );
  });

  app.get('/api/reflexes/versions/:id/export', (req, reply) => {
    const { ts } = tenant(req);
    const { id } = parseBody(Id, req.params);
    const v = platform.validation.getVersion(ts, id);
    void reply
      .header(
        'content-disposition',
        `attachment; filename="${v.spec.name}-${v.version}.reflex.json"`,
      )
      .type('application/json');
    return { spec: v.spec, contentHash: v.contentHash };
  });

  // ---- drift and mutations ----
  app.get('/api/drift', (req) => {
    const { actor, ts } = tenant(req);
    return platform.drift.view(actor, ts);
  });

  app.post('/api/reflexes/versions/:id/canary', (req, reply) => {
    const { actor, ts } = tenant(req);
    const { id } = parseBody(Id, req.params);
    platform.validation.getVersion(ts, id);
    const job = platform.jobs.enqueue(actor, 'canary', { versionId: id });
    platform.jobs.kick();
    void reply.status(202);
    return { job: platform.jobs.toDto(job) };
  });

  app.post('/api/reflexes/versions/:id/mutations', (req, reply) => {
    const { actor, ts } = tenant(req);
    const { id } = parseBody(Id, req.params);
    platform.validation.getVersion(ts, id);
    const job = platform.jobs.enqueue(actor, 'mutation', { versionId: id });
    platform.jobs.kick();
    void reply.status(202);
    return { job: platform.jobs.toDto(job) };
  });

  app.get('/api/mutations', (req) => {
    const { ts } = tenant(req);
    return {
      mutations: ts.mutations
        .all(ts.tenantId, { order: 'created_at DESC' })
        .map((m) => platform.drift.mutationDto(ts, m)),
    };
  });

  app.post('/api/mutations/:id/approve', (req) => {
    const { actor } = tenant(req);
    const { id } = parseBody(Id, req.params);
    const { comment } = parseBody(Comment, req.body ?? {});
    return platform.drift.approveMutation(actor, id, comment);
  });

  app.post('/api/mutations/:id/reject', (req) => {
    const { actor } = tenant(req);
    const { id } = parseBody(Id, req.params);
    const { comment } = parseBody(Comment, req.body ?? {});
    return platform.drift.rejectMutation(actor, id, comment);
  });

  // ---- economics ----
  app.get('/api/economics', (req) => {
    const { ts } = tenant(req);
    const q = parseBody(EconQuery, req.query);
    return platform.economics.compute(ts, {
      ...(q.executions ? { projectedExecutions: q.executions } : {}),
      ...(q.conservative ? { includeLearningInInvestment: q.conservative === 'true' } : {}),
    });
  });
}

export { AppError };
