import { rm } from 'node:fs/promises';
import path from 'node:path';
import { type IdGenerator, randomIds, systemClock } from '@bigforge/core';
import { type LabEnvironment, monorepoPolicies } from '@bigforge/lab-monorepo';
import {
  DEFAULT_PRICING,
  DeterministicProvider,
  type Provider,
  createLiveProviderFromEnv,
} from '@bigforge/providers';
import type { RunDetailDto, SessionUser, SettingsDto, SystemDto } from '@bigforge/schemas';
import { hashPassword, verifyPassword } from '@bigforge/security';
import { type Actor, AppError, SYSTEM_ACTOR_NAME } from './actor';
import { type BigForgeMetrics, createMetrics } from '@bigforge/observability';
import { type PlatformConfig } from './config';
import { toRunDetail, toRunSummary, toTaskDto } from './services/shared';
import { type Db, migrate, openDatabase } from './db/database';
import { type UserRow, Store } from './db/store';
import { createEngine } from './engine';
import type { EngineDeps } from './execution';
import { personas, seedBootstrapAdmin, seedDemoIdentities } from './seed';
import { DemoService } from './services/demo';
import { DriftService, DRIFT_SYSTEM_NAME } from './services/drift';
import { DEFAULT_ECONOMICS_ASSUMPTIONS, EconomicsService } from './services/economics';
import { JobService } from './services/jobs';
import { LearningService } from './services/learning';
import { TaskService } from './services/tasks';
import { ValidationService } from './services/validation';
import { DEFAULT_PROMOTION_GATE } from '@bigforge/schemas';
import { DEFAULT_DRIFT_CONFIG } from '@bigforge/core';

export const APP_VERSION = '0.1.0';

const DUMMY_HASH = hashPassword('not-a-real-password');

/**
 * Composition root: configuration, database, execution engine and every application service.
 * Services read `platform.store` on each call so a demo reset can replace the database.
 */
export class Platform {
  readonly config: PlatformConfig;
  readonly ids: IdGenerator = randomIds();
  readonly metrics: BigForgeMetrics = createMetrics();
  readonly systemName = SYSTEM_ACTOR_NAME;
  readonly driftName = DRIFT_SYSTEM_NAME;
  store!: Store;
  engine!: EngineDeps;
  readonly tasks: TaskService;
  readonly learning: LearningService;
  readonly validation: ValidationService;
  readonly drift: DriftService;
  readonly economics: EconomicsService;
  readonly jobs: JobService;
  readonly demo: DemoService;
  private providerNotes: string[] = [];
  private migrationVersion = 0;

  private constructor(config: PlatformConfig) {
    this.config = config;
    this.tasks = new TaskService(this);
    this.learning = new LearningService(this);
    this.validation = new ValidationService(this);
    this.drift = new DriftService(this);
    this.economics = new EconomicsService(this);
    this.jobs = new JobService(this);
    this.demo = new DemoService(this);
  }

  static async create(config: PlatformConfig): Promise<Platform> {
    const platform = new Platform(config);
    await platform.init();
    return platform;
  }

  private chooseProvider(): Provider {
    this.providerNotes = [];
    if (this.config.providerMode === 'live') {
      const live = createLiveProviderFromEnv(this.config.env);
      if (live) {
        this.providerNotes.push(
          'Live provider mode: model calls go to a real provider. Token counts and latency are provider-reported (measured).',
        );
        return live;
      }
      this.providerNotes.push(
        'Live provider requested but not configured; using the deterministic provider.',
      );
    }
    this.providerNotes.push(
      'Deterministic provider: a scripted stand-in for a model. Token counts are synthetic and latency is simulated. No model is called.',
    );
    return new DeterministicProvider(monorepoPolicies());
  }

  private async init(): Promise<void> {
    const db: Db = openDatabase(this.config.databaseFile);
    this.migrationVersion = migrate(db).current;
    this.store = new Store(db);
    const now = this.now();
    // Idempotent: restarting against an existing database must not re-seed identities.
    if (this.store.listTenants().length === 0) {
      if (this.config.mode === 'demo') seedDemoIdentities(this.store, now);
      else {
        const email = this.config.env.BIGFORGE_BOOTSTRAP_ADMIN_EMAIL;
        const password = this.config.env.BIGFORGE_BOOTSTRAP_ADMIN_PASSWORD;
        if (email && password && password.length >= 12)
          seedBootstrapAdmin(this.store, now, email, password);
      }
    }
    if (this.config.jobsMode === 'inline') {
      this.store.db
        .prepare(
          "UPDATE jobs SET status = 'failed', error = 'Interrupted by a server restart', finished_at = ? WHERE status = 'running'",
        )
        .run(now);
    }
    this.engine = await createEngine({
      dataDir: this.config.dataDir,
      provider: this.chooseProvider(),
      pricing: DEFAULT_PRICING,
      keepWorkspaces: this.config.keepWorkspaces,
    });
  }

  now(): string {
    return systemClock.now().toISOString();
  }

  // ---- audit ----
  audit(
    actor: Actor,
    action: string,
    subjectType: string,
    subjectId: string,
    summary: string,
    details: unknown,
  ): void {
    this.auditFor(actor.tenantId, actor.name, action, subjectType, subjectId, summary, details);
  }

  auditFor(
    tenantId: string,
    actorName: string,
    action: string,
    subjectType: string,
    subjectId: string,
    summary: string,
    details: unknown,
  ): void {
    this.store.forTenant(tenantId).appendAudit({
      id: this.ids.next('aud'),
      actor: actorName,
      action,
      subjectType,
      subjectId,
      summary: summary.slice(0, 500),
      details,
      createdAt: this.now(),
    });
  }

  // ---- identity ----
  login(email: string, password: string): SessionUser {
    const user = this.store.findUserByEmail(email);
    const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
    return this.sessionUser(user);
  }

  sessionUser(user: UserRow): SessionUser {
    const tenant = this.store.getTenant(user.tenantId);
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      tenant: { id: user.tenantId, slug: tenant?.slug ?? '', name: tenant?.name ?? '' },
    };
  }

  actorFor(userId: string): Actor | null {
    const user = this.store.getUser(userId);
    return user
      ? { userId: user.id, name: user.displayName, role: user.role, tenantId: user.tenantId }
      : null;
  }

  reviewerActor(tenantId: string): Actor {
    const u =
      this.store.listUsers().find((x) => x.tenantId === tenantId && x.role === 'reviewer') ??
      this.store.listUsers().find((x) => x.tenantId === tenantId && x.role === 'admin');
    if (!u) throw new AppError(409, 'conflict', 'No reviewer identity exists for this tenant');
    return { userId: u.id, name: u.displayName, role: u.role, tenantId };
  }

  personas() {
    return this.config.mode === 'demo' ? personas() : [];
  }

  // ---- views ----
  taskDto = toTaskDto;
  runSummary = toRunSummary;

  runDetail(tenantId: string, id: string): RunDetailDto {
    const ts = this.store.forTenant(tenantId);
    const run = ts.runs.get(tenantId, id);
    if (!run) throw new AppError(404, 'not_found', 'Run not found');
    const task = ts.tasks.get(tenantId, run.taskId, ['id', 'title', 'scenarioId', 'variantKey']);
    if (!task) throw new AppError(404, 'not_found', 'Task not found');
    return toRunDetail(run, task);
  }

  // ---- settings ----
  settings(tenantId: string): SettingsDto {
    const ts = this.store.forTenant(tenantId);
    return {
      gate: ts.getSetting('gate', DEFAULT_PROMOTION_GATE),
      drift: ts.getSetting('drift', DEFAULT_DRIFT_CONFIG),
      economics: ts.getSetting('economics', DEFAULT_ECONOMICS_ASSUMPTIONS),
    };
  }

  updateSettings(actor: Actor, next: SettingsDto): SettingsDto {
    const ts = this.store.forTenant(actor.tenantId);
    ts.setSetting('gate', next.gate);
    ts.setSetting('drift', next.drift);
    ts.setSetting('economics', next.economics);
    this.audit(actor, 'settings.updated', 'settings', actor.tenantId, 'Settings updated', next);
    return this.settings(actor.tenantId);
  }

  system(tenantId: string): SystemDto {
    const ts = this.store.forTenant(tenantId);
    const provider = this.engine.provider;
    const liveConfigured = createLiveProviderFromEnv(this.config.env) !== null;
    return {
      name: 'BigForge',
      version: APP_VERSION,
      mode: this.config.mode,
      node: process.version,
      provider: {
        id: provider.id,
        mode: provider.mode,
        label:
          provider.mode === 'deterministic'
            ? 'Deterministic provider (synthetic, offline)'
            : `Live provider: ${provider.id}`,
        liveConfigured,
        liveKind: this.config.env.BIGFORGE_LIVE_PROVIDER ?? null,
        notes: this.providerNotes,
      },
      pricing: {
        id: this.engine.pricing.id,
        assumedAt: this.engine.pricing.assumedAt,
        source: this.engine.pricing.source,
        note: this.engine.pricing.note,
      },
      environment: this.tasks.environmentDto(ts),
      migrations: { current: this.migrationVersion },
      claims: {
        azureDeployed: false,
        note: 'No Azure resources are deployed by this application. Templates are validated locally only.',
      },
    };
  }

  ready(): { ok: boolean; checks: Record<string, boolean> } {
    let db: boolean;
    try {
      db = (this.store.db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
    } catch {
      db = false;
    }
    const checks = {
      database: db,
      migrations: this.migrationVersion > 0,
      engine: this.engine !== undefined,
    };
    return { ok: Object.values(checks).every(Boolean), checks };
  }

  /** Drops all state and re-seeds. Starts a new audit chain that records the previous chain heads. */
  async reset(actor: Actor): Promise<void> {
    const heads = this.store
      .listTenants()
      .map((t) => ({ tenantId: t.id, head: this.store.forTenant(t.id).verifyAudit().headHash }));
    this.store.db.close();
    if (this.config.databaseFile !== ':memory:') {
      for (const suffix of ['', '-wal', '-shm'])
        await rm(`${this.config.databaseFile}${suffix}`, { force: true });
    }
    await rm(path.join(this.config.dataDir, 'workspaces'), { recursive: true, force: true });
    await this.init();
    for (const h of heads) {
      if (this.store.getTenant(h.tenantId)) {
        this.auditFor(
          h.tenantId,
          actor.name,
          'demo.reset',
          'system',
          'demo',
          'Demo reset: database recreated and a new audit chain started',
          {
            previousChainHead: h.head,
            note: 'The previous chain is discarded with the database; its head is recorded here.',
          },
        );
      }
    }
  }

  close(): void {
    this.store.db.close();
  }
}

export type { LabEnvironment };
