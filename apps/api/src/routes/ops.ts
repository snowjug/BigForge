import { type Platform, AppError, DEMO_TOTAL, SEED_STAGES, assertCan } from '@bigforge/platform';
import type {
  AuditEventDto,
  AuditVerifyDto,
  SecurityEvaluationDto,
  SettingsDto,
} from '@bigforge/schemas';
import { PageQuery, PromotionGate } from '@bigforge/schemas';
import { forgeCiPolicy } from '@bigforge/lab-monorepo';
import { PermissionGuard, parseCommandLine, validateCommand } from '@bigforge/security';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBody, requireActor } from '../app';

const AuditQuery = PageQuery.extend({ action: z.string().max(60).optional() });
const EvaluateBody = z.object({ command: z.string().min(1).max(2000) });
const SettingsBody = z.object({
  gate: PromotionGate,
  drift: z.object({
    minSamples: z.number().int().min(1).max(200),
    dropThreshold: z.number().min(0).max(1),
    floor: z.number().min(0).max(1),
    watchBelow: z.number().min(0).max(1),
  }),
  economics: z.object({
    reviewMinutes: z.number().min(0).max(600),
    reviewerUsdPerHour: z.number().min(0).max(1000),
    projectedExecutions: z.number().int().min(1).max(1_000_000),
    includeLearningInInvestment: z.boolean(),
  }),
});
const GotoBody = z.object({ step: z.number().int().min(1).max(DEMO_TOTAL) });
const StageBody = z.object({
  stage: z.enum(
    Object.keys(SEED_STAGES) as [keyof typeof SEED_STAGES, ...(keyof typeof SEED_STAGES)[]],
  ),
});

const VIRTUAL_ROOT = '/sandbox/repo';

export function registerOpsRoutes(app: FastifyInstance, platform: Platform): void {
  // ---- audit ----
  app.get('/api/audit', (req) => {
    const a = requireActor(req);
    assertCan(a, 'view_audit');
    const q = parseBody(AuditQuery, req.query);
    const page = platform.store.forTenant(a.tenantId).listAudit({
      limit: q.limit,
      ...(q.cursor ? { cursor: q.cursor } : {}),
      ...(q.action ? { action: q.action } : {}),
    });
    return {
      ...page,
      items: page.items.map<AuditEventDto>((e) => ({
        seq: e.seq,
        id: e.id,
        actor: e.actor,
        action: e.action,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        summary: e.summary,
        details: e.details,
        prevHash: e.prevHash,
        hash: e.hash,
        createdAt: e.createdAt,
      })),
    };
  });

  app.get('/api/audit/verify', (req): AuditVerifyDto => {
    const a = requireActor(req);
    assertCan(a, 'view_audit');
    return platform.store.forTenant(a.tenantId).verifyAudit();
  });

  app.get('/api/approvals', (req) => {
    const a = requireActor(req);
    const ts = platform.store.forTenant(a.tenantId);
    return { approvals: ts.approvals.all(ts.tenantId, { order: 'created_at DESC' }) };
  });

  // ---- command safety playground: evaluates policy, never executes ----
  app.post('/api/security/evaluate', (req): SecurityEvaluationDto => {
    const a = requireActor(req);
    assertCan(a, 'read');
    const { command } = parseBody(EvaluateBody, req.body);
    const parsed = parseCommandLine(command);
    if (!parsed.ok) {
      return {
        input: command,
        parsed: { ok: false, rule: parsed.rule, reason: parsed.reason },
        allowlist: {
          ok: false,
          rule: parsed.rule,
          reason: parsed.reason,
          destructive: parsed.destructive,
        },
        permission: null,
        verdict: 'blocked',
        executed: false,
        explanation: `Blocked before any policy lookup: ${parsed.reason}. BigForge never executes shell text; commands must be structured.`,
      };
    }
    const validation = validateCommand(parsed.spec, forgeCiPolicy(), VIRTUAL_ROOT);
    const guard = new PermissionGuard({
      read: ['**'],
      write: [],
      commands: [{ program: 'forge-ci', subcommands: ['build', 'test', 'graph'] }],
    });
    const permission = guard.canRun(parsed.spec);
    const ok = validation.ok && permission.allowed;
    return {
      input: command,
      parsed: { ok: true },
      allowlist: validation.ok
        ? { ok: true, normalized: validation.normalized }
        : {
            ok: false,
            rule: validation.rule,
            reason: validation.reason,
            destructive: validation.destructive,
          },
      permission,
      verdict: ok ? 'would_run' : 'blocked',
      executed: false,
      explanation: ok
        ? 'Allowlisted program, valid subcommand and flags, granted by the Reflex permissions. It would run with a scrubbed environment, a confined working directory, a timeout and an output cap. This playground never executes it.'
        : `Blocked: ${validation.ok ? permission.reason : validation.reason}.`,
    };
  });

  // ---- settings ----
  app.get('/api/settings', (req): SettingsDto => platform.settings(requireActor(req).tenantId));
  app.put('/api/settings', (req): SettingsDto => {
    const a = requireActor(req);
    assertCan(a, 'manage_settings');
    return platform.updateSettings(a, parseBody(SettingsBody, req.body));
  });

  // ---- jobs ----
  app.get('/api/jobs/:id', (req) => {
    const a = requireActor(req);
    const { id } = parseBody(z.object({ id: z.string().max(80) }), req.params);
    return platform.jobs.get(a, id);
  });

  // ---- guided demo ----
  app.get('/api/demo', (req) => platform.demo.state(requireActor(req)));
  app.post('/api/demo/goto', (req) =>
    platform.demo.goto(requireActor(req), parseBody(GotoBody, req.body).step),
  );
  app.post('/api/demo/steps/:n/perform', async (req) => {
    const { n } = parseBody(
      z.object({ n: z.coerce.number().int().min(1).max(DEMO_TOTAL) }),
      req.params,
    );
    return platform.demo.perform(requireActor(req), n);
  });
  app.post('/api/demo/seed', async (req) =>
    platform.demo.seed(requireActor(req), parseBody(StageBody, req.body).stage),
  );
  app.post('/api/demo/reset', async (req) => {
    const a = requireActor(req);
    assertCan(a, 'reset_demo');
    if (platform.config.mode !== 'demo')
      throw new AppError(403, 'forbidden', 'Demo reset is disabled outside demo mode');
    await platform.reset(a);
    return platform.demo.state(a);
  });
}
