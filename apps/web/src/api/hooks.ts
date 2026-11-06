import {
  type InfiniteData,
  type QueryClient,
  keepPreviousData,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  AuditEventDto,
  AuditVerifyDto,
  ComparisonDto,
  DemoStateDto,
  DriftViewDto,
  EconomicsReport,
  EnvironmentDto,
  FamiliesViewDto,
  JobDto,
  MutationDto,
  ReflexListDto,
  ReflexVersionDto,
  RunDetailDto,
  RunResultDto,
  RunSummaryDto,
  SecurityEvaluationDto,
  SettingsDto,
  SystemDto,
  TaskDetailDto,
  TaskDto,
} from '@bigforge/schemas';
import { http } from './client';
import { TENANT_DATA_ROOTS, keys } from './keys';
import type {
  ApprovalsResponse,
  AuditListParams,
  ComparisonListParams,
  EconomicsParams,
  HealthResponse,
  JobEnvelope,
  LoginResponse,
  MatchTaskResponse,
  MatchTextResponse,
  MatcherResponse,
  MeResponse,
  MetricDefinitionsResponse,
  Paged,
  PersonasResponse,
  ReadyResponse,
  ReflexExportResponse,
  RunListParams,
  RunMode,
  ScenariosResponse,
  TaskListParams,
} from './types';

/* -------------------------------------------------------------------------------------------------
 * Conventions
 *  - Every endpoint has exactly one hook here. Queries use the `queryOptions` factories below so
 *    non-hook code can reuse them (`queryClient.fetchQuery(systemQuery())`).
 *  - Mutations never retry. They invalidate the narrowest set of keys that their effect can change.
 *  - Ids may be null/undefined while a page is still resolving them: the query is then disabled.
 * ----------------------------------------------------------------------------------------------- */

type Key = readonly unknown[];

const enc = encodeURIComponent;

function invalidate(qc: QueryClient, ...groups: Key[]): Promise<void> {
  return Promise.all(groups.map((queryKey) => qc.invalidateQueries({ queryKey }))).then(
    () => undefined,
  );
}

/** Drops cached tenant data after the identity changed or ended. */
function dropTenantData(qc: QueryClient, refetchActive: boolean): Promise<void> | void {
  const predicate = (query: { queryKey: Key }) =>
    TENANT_DATA_ROOTS.includes(String(query.queryKey[0]));
  if (refetchActive) return qc.resetQueries({ predicate });
  qc.removeQueries({ predicate });
  return undefined;
}

function useApiMutation<TData, TVars = void>(options: {
  mutationFn: (vars: TVars) => Promise<TData>;
  invalidates?: readonly Key[];
  onData?: (data: TData, vars: TVars, qc: QueryClient) => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: options.mutationFn,
    retry: false,
    onSuccess: async (data: TData, vars: TVars) => {
      options.onData?.(data, vars, qc);
      if (options.invalidates?.length) await invalidate(qc, ...options.invalidates);
    },
  });
}

export function flattenPages<T>(data: InfiniteData<Paged<T>> | undefined): T[] {
  return data ? data.pages.flatMap((page) => page.items) : [];
}

/* ------------------------------------------------------------------------------------------------
 * Auth and system
 * ---------------------------------------------------------------------------------------------- */

export const meQuery = () =>
  queryOptions({
    queryKey: keys.auth.me,
    queryFn: ({ signal }) => http.get<MeResponse>('/api/auth/me', { signal }),
    staleTime: 5 * 60_000,
  });
/** `GET /api/auth/me`: the signed-in user (or null) and the deployment mode. */
export const useSession = () => useQuery(meQuery());

export const personasQuery = () =>
  queryOptions({
    queryKey: keys.auth.personas,
    queryFn: ({ signal }) => http.get<PersonasResponse>('/api/auth/personas', { signal }),
    staleTime: 5 * 60_000,
  });
/** `GET /api/auth/personas`: demo identities (empty outside demo mode) and the demo password hint. */
export const usePersonas = () => useQuery(personasQuery());

/** `POST /api/auth/login`: replaces the session cookie and resets every tenant-scoped cache. */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      http.post<LoginResponse>('/api/auth/login', credentials),
    retry: false,
    onSuccess: async (data) => {
      const previous = qc.getQueryData<MeResponse>(keys.auth.me);
      qc.setQueryData<MeResponse>(keys.auth.me, {
        user: data.user,
        mode: previous?.mode ?? 'demo',
      });
      await dropTenantData(qc, true);
    },
  });
}

/** `POST /api/auth/logout`. */
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post<{ ok: boolean }>('/api/auth/logout'),
    retry: false,
    onSuccess: () => {
      const previous = qc.getQueryData<MeResponse>(keys.auth.me);
      qc.setQueryData<MeResponse>(keys.auth.me, { user: null, mode: previous?.mode ?? 'demo' });
      void dropTenantData(qc, false);
    },
  });
}

export const healthQuery = () =>
  queryOptions({
    queryKey: keys.health,
    queryFn: ({ signal }) => http.get<HealthResponse>('/api/health', { signal }),
    staleTime: 15_000,
  });
/** `GET /api/health` (public). */
export const useHealth = () => useQuery(healthQuery());

export const readyQuery = () =>
  queryOptions({
    queryKey: keys.ready,
    queryFn: ({ signal }) => http.get<ReadyResponse>('/api/ready', { signal }),
    staleTime: 15_000,
  });
/** `GET /api/ready` (public). A 503 surfaces as an ApiError with code `http_error`. */
export const useReady = () => useQuery(readyQuery());

export const systemQuery = () =>
  queryOptions({
    queryKey: keys.system,
    queryFn: ({ signal }) => http.get<SystemDto>('/api/system', { signal }),
    staleTime: 60_000,
  });
/** `GET /api/system`: provider honesty, pricing assumption, environment, Azure claims. */
export const useSystem = () => useQuery(systemQuery());

export const metricDefinitionsQuery = () =>
  queryOptions({
    queryKey: keys.metricDefinitions,
    queryFn: ({ signal }) =>
      http.get<MetricDefinitionsResponse>('/api/metrics/definitions', { signal }),
    staleTime: Infinity,
  });
/** `GET /api/metrics/definitions`: definition, source, formula and limitation per metric id. */
export const useMetricDefinitions = (enabled = true) =>
  useQuery({ ...metricDefinitionsQuery(), enabled });

/* ------------------------------------------------------------------------------------------------
 * Lab: scenarios and environment
 * ---------------------------------------------------------------------------------------------- */

export const scenariosQuery = () =>
  queryOptions({
    queryKey: keys.lab.scenarios,
    queryFn: ({ signal }) => http.get<ScenariosResponse>('/api/lab/scenarios', { signal }),
    staleTime: 10_000,
  });
/** `GET /api/lab/scenarios`: the synthetic scenario catalogue with the task each one produced. */
export const useScenarios = () => useQuery(scenariosQuery());

export const environmentQuery = () =>
  queryOptions({
    queryKey: keys.lab.environment,
    queryFn: ({ signal }) => http.get<EnvironmentDto>('/api/lab/environment', { signal }),
    staleTime: 10_000,
  });
/** `GET /api/lab/environment`: the current forge-ci toolchain version. */
export const useEnvironment = () => useQuery(environmentQuery());

/** `POST /api/lab/environment` (operator+): introduces a synthetic environment change (drift trigger). */
export function useSetEnvironment() {
  return useApiMutation({
    mutationFn: (toolchainVersion: string) =>
      http.post<EnvironmentDto>('/api/lab/environment', { toolchainVersion }),
    invalidates: [keys.lab.all, keys.system, keys.drift, keys.audit.all, keys.demo],
  });
}

/* ------------------------------------------------------------------------------------------------
 * Tasks and runs
 * ---------------------------------------------------------------------------------------------- */

const fetchTasks = (params: TaskListParams, signal?: AbortSignal) =>
  http.get<Paged<TaskDto>>('/api/tasks', {
    query: { ...params },
    ...(signal ? { signal } : {}),
  });

/** `GET /api/tasks`: one page of tasks. */
export const useTasks = (params: TaskListParams = {}) =>
  useQuery({
    queryKey: keys.tasks.list(params),
    queryFn: ({ signal }) => fetchTasks(params, signal),
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });

/** `GET /api/tasks`: cursor-paged "load more" list. */
export const useInfiniteTasks = (params: Omit<TaskListParams, 'cursor'> = {}) =>
  useInfiniteQuery({
    queryKey: keys.tasks.infinite(params),
    queryFn: ({ pageParam, signal }) =>
      fetchTasks({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 5_000,
  });

/** `GET /api/tasks/:id`: task, fingerprint, match decision, original CI log and its runs. */
export const useTask = (taskId: string | null | undefined) =>
  useQuery({
    queryKey: keys.tasks.detail(taskId ?? ''),
    queryFn: ({ signal }) => http.get<TaskDetailDto>(`/api/tasks/${enc(taskId ?? '')}`, { signal }),
    enabled: Boolean(taskId),
    staleTime: 10_000,
  });

/** `POST /api/tasks` (operator+): receive a synthetic failure by scenario id. */
export function useIntakeTask() {
  return useApiMutation({
    mutationFn: (scenarioId: string) => http.post<TaskDetailDto>('/api/tasks', { scenarioId }),
    invalidates: [keys.tasks.all, keys.lab.scenarios, keys.audit.all, keys.demo],
  });
}

/** `POST /api/tasks/:id/match`: re-evaluate the family match for a task. */
export function useMatchTask() {
  return useApiMutation({
    mutationFn: (taskId: string) => http.post<MatchTaskResponse>(`/api/tasks/${enc(taskId)}/match`),
    invalidates: [keys.tasks.all],
  });
}

/** `POST /api/tasks/:id/run` (operator+): run the baseline agent, the Reflex path, or both to compare. */
export function useRunTask() {
  return useApiMutation({
    mutationFn: ({ taskId, mode }: { taskId: string; mode: RunMode }) =>
      http.post<RunResultDto>(`/api/tasks/${enc(taskId)}/run`, { mode }),
    invalidates: [
      keys.tasks.all,
      keys.runs.all,
      keys.lab.scenarios,
      keys.reflexes.all,
      keys.economics.all,
      keys.drift,
      keys.audit.all,
      keys.demo,
    ],
  });
}

/** `POST /api/match`: matcher playground. Fingerprints text and never executes anything. */
export function useMatchText() {
  return useApiMutation({
    mutationFn: (input: { prompt: string; log?: string | null }) =>
      http.post<MatchTextResponse>('/api/match', input),
  });
}

const fetchRuns = (params: RunListParams, signal?: AbortSignal) =>
  http.get<Paged<RunSummaryDto>>('/api/runs', {
    query: { ...params },
    ...(signal ? { signal } : {}),
  });

/** `GET /api/runs`: one page of run summaries. */
export const useRuns = (params: RunListParams = {}) =>
  useQuery({
    queryKey: keys.runs.list(params),
    queryFn: ({ signal }) => fetchRuns(params, signal),
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });

/** `GET /api/runs`: cursor-paged "load more" list. */
export const useInfiniteRuns = (params: Omit<RunListParams, 'cursor'> = {}) =>
  useInfiniteQuery({
    queryKey: keys.runs.infinite(params),
    queryFn: ({ pageParam, signal }) =>
      fetchRuns({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 5_000,
  });

/** `GET /api/runs/:id`: the full trace, file changes and execution summary. */
export const useRun = (runId: string | null | undefined) =>
  useQuery({
    queryKey: keys.runs.detail(runId ?? ''),
    queryFn: ({ signal }) => http.get<RunDetailDto>(`/api/runs/${enc(runId ?? '')}`, { signal }),
    enabled: Boolean(runId),
    staleTime: 30_000,
  });

/* ------------------------------------------------------------------------------------------------
 * Families and the matcher
 * ---------------------------------------------------------------------------------------------- */

/** `GET /api/families`: families, the fingerprint graph and discovery thresholds. */
export const useFamilies = () =>
  useQuery({
    queryKey: keys.families.all,
    queryFn: ({ signal }) => http.get<FamiliesViewDto>('/api/families', { signal }),
    staleTime: 10_000,
  });

/** `POST /api/families/discover` (operator+). */
export function useDiscoverFamilies() {
  return useApiMutation({
    mutationFn: () => http.post<FamiliesViewDto>('/api/families/discover'),
    onData: (data, _vars, qc) => qc.setQueryData(keys.families.all, data),
    invalidates: [keys.families.matcher, keys.tasks.all, keys.audit.all, keys.demo],
  });
}

/** `GET /api/matcher/evaluation`: measured false-match rate on the labelled synthetic corpus. */
export const useMatcherEvaluation = () =>
  useQuery({
    queryKey: keys.families.matcher,
    queryFn: ({ signal }) => http.get<MatcherResponse>('/api/matcher/evaluation', { signal }),
    staleTime: 30_000,
  });

/* ------------------------------------------------------------------------------------------------
 * Reflexes: registry, validation, promotion
 * ---------------------------------------------------------------------------------------------- */

/** `GET /api/reflexes`: every Reflex with its versions. */
export const useReflexes = () =>
  useQuery({
    queryKey: keys.reflexes.list,
    queryFn: ({ signal }) => http.get<{ reflexes: ReflexListDto[] }>('/api/reflexes', { signal }),
    staleTime: 5_000,
  });

/** `GET /api/reflexes/versions/:id`: spec, gate, evidence, transitions and `actions` the caller may take. */
export const useReflexVersion = (versionId: string | null | undefined) =>
  useQuery({
    queryKey: keys.reflexes.version(versionId ?? ''),
    queryFn: ({ signal }) =>
      http.get<ReflexVersionDto>(`/api/reflexes/versions/${enc(versionId ?? '')}`, { signal }),
    enabled: Boolean(versionId),
    staleTime: 5_000,
  });

/** `GET /api/reflexes/versions/:id/export`: the immutable spec and its content hash. */
export const useReflexExport = (versionId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.reflexes.export(versionId ?? ''),
    queryFn: ({ signal }) =>
      http.get<ReflexExportResponse>(`/api/reflexes/versions/${enc(versionId ?? '')}/export`, {
        signal,
      }),
    enabled: Boolean(versionId) && enabled,
    staleTime: Infinity,
  });

const fetchComparisons = (id: string, params: ComparisonListParams, signal?: AbortSignal) =>
  http.get<Paged<ComparisonDto>>(`/api/reflexes/versions/${enc(id)}/comparisons`, {
    query: { ...params },
    ...(signal ? { signal } : {}),
  });

/** `GET /api/reflexes/versions/:id/comparisons`: replay / shadow / canary / live comparison pages. */
export const useComparisons = (
  versionId: string | null | undefined,
  params: ComparisonListParams = {},
) =>
  useQuery({
    queryKey: keys.reflexes.comparisons(versionId ?? '', params),
    queryFn: ({ signal }) => fetchComparisons(versionId ?? '', params, signal),
    enabled: Boolean(versionId),
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });

/** `GET /api/reflexes/versions/:id/comparisons`: cursor-paged "load more" list. */
export const useInfiniteComparisons = (
  versionId: string | null | undefined,
  params: Omit<ComparisonListParams, 'cursor'> = {},
) =>
  useInfiniteQuery({
    queryKey: keys.reflexes.comparisonsInfinite(versionId ?? '', params),
    queryFn: ({ pageParam, signal }) =>
      fetchComparisons(
        versionId ?? '',
        { ...params, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      ),
    enabled: Boolean(versionId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 5_000,
  });

const REFLEX_CHANGED: readonly Key[] = [
  keys.reflexes.all,
  keys.families.all,
  keys.economics.all,
  keys.audit.all,
  keys.approvals,
  keys.demo,
];

/** `POST /api/families/:id/compile` (operator+): compile a candidate Reflex from a family. */
export function useCompileFamily() {
  return useApiMutation({
    mutationFn: (familyId: string) =>
      http.post<ReflexVersionDto>(`/api/families/${enc(familyId)}/compile`),
    invalidates: REFLEX_CHANGED,
  });
}

/** `POST /api/reflexes/versions/:id/replay` (operator+): replay historical traces (candidate only). */
export function useReplayVersion() {
  return useApiMutation({
    mutationFn: (versionId: string) =>
      http.post<ReflexVersionDto>(`/api/reflexes/versions/${enc(versionId)}/replay`),
    invalidates: [...REFLEX_CHANGED, keys.runs.all],
  });
}

/** Reads a `{ job }` envelope: use `useJob(result.job.id)` to follow progress. */
const JOB_STARTED: readonly Key[] = [keys.audit.all, keys.demo];

/** `POST /api/reflexes/versions/:id/shadow` (operator+): starts Shadow Brain as a background job (202). */
export function useStartShadow() {
  return useApiMutation({
    mutationFn: ({ versionId, scenarioIds }: { versionId: string; scenarioIds?: string[] }) =>
      http.post<JobEnvelope>(
        `/api/reflexes/versions/${enc(versionId)}/shadow`,
        scenarioIds ? { scenarioIds } : {},
      ),
    invalidates: JOB_STARTED,
  });
}

/** `POST /api/reflexes/versions/:id/canary` (operator+): starts the Drift Canary job (202). */
export function useStartCanary() {
  return useApiMutation({
    mutationFn: (versionId: string) =>
      http.post<JobEnvelope>(`/api/reflexes/versions/${enc(versionId)}/canary`),
    invalidates: JOB_STARTED,
  });
}

/** `POST /api/reflexes/versions/:id/mutations` (operator+): proposes a mutation as a job (202). */
export function useProposeMutation() {
  return useApiMutation({
    mutationFn: (versionId: string) =>
      http.post<JobEnvelope>(`/api/reflexes/versions/${enc(versionId)}/mutations`),
    invalidates: JOB_STARTED,
  });
}

interface DecisionVars {
  versionId: string;
  comment?: string;
}

const decision = (action: 'promote' | 'reject' | 'rollback') => (vars: DecisionVars) =>
  http.post<ReflexVersionDto>(`/api/reflexes/versions/${enc(vars.versionId)}/${action}`, {
    comment: vars.comment ?? '',
  });

/** `POST /api/reflexes/versions/:id/promote` (reviewer/admin; the server enforces role, gate and hash). */
export function usePromoteVersion() {
  return useApiMutation({
    mutationFn: decision('promote'),
    invalidates: [...REFLEX_CHANGED, keys.drift],
  });
}

/** `POST /api/reflexes/versions/:id/reject` (reviewer/admin): returns an awaiting-approval Reflex to shadow. */
export function useRejectVersion() {
  return useApiMutation({ mutationFn: decision('reject'), invalidates: REFLEX_CHANGED });
}

/** `POST /api/reflexes/versions/:id/rollback` (reviewer/admin): rolls an active Reflex back. */
export function useRollbackVersion() {
  return useApiMutation({
    mutationFn: decision('rollback'),
    invalidates: [...REFLEX_CHANGED, keys.drift],
  });
}

/* ------------------------------------------------------------------------------------------------
 * Drift and mutations
 * ---------------------------------------------------------------------------------------------- */

/** `GET /api/drift`: environment, checks, confidence history, mutations and drift configuration. */
export const useDrift = () =>
  useQuery({
    queryKey: keys.drift,
    queryFn: ({ signal }) => http.get<DriftViewDto>('/api/drift', { signal }),
    staleTime: 5_000,
  });

/** `GET /api/mutations`: all mutation proposals, newest first. */
export const useMutations = () =>
  useQuery({
    queryKey: keys.mutations,
    queryFn: ({ signal }) => http.get<{ mutations: MutationDto[] }>('/api/mutations', { signal }),
    staleTime: 5_000,
  });

const MUTATION_DECIDED: readonly Key[] = [
  keys.mutations,
  keys.drift,
  keys.reflexes.all,
  keys.approvals,
  keys.audit.all,
  keys.demo,
];

interface MutationDecision {
  mutationId: string;
  comment?: string;
}

/** `POST /api/mutations/:id/approve` (reviewer/admin): enters the mutated version into shadow validation. */
export function useApproveMutation() {
  return useApiMutation({
    mutationFn: ({ mutationId, comment }: MutationDecision) =>
      http.post<MutationDto>(`/api/mutations/${enc(mutationId)}/approve`, {
        comment: comment ?? '',
      }),
    invalidates: MUTATION_DECIDED,
  });
}

/** `POST /api/mutations/:id/reject` (reviewer/admin). */
export function useRejectMutation() {
  return useApiMutation({
    mutationFn: ({ mutationId, comment }: MutationDecision) =>
      http.post<MutationDto>(`/api/mutations/${enc(mutationId)}/reject`, {
        comment: comment ?? '',
      }),
    invalidates: MUTATION_DECIDED,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Economics
 * ---------------------------------------------------------------------------------------------- */

/** `GET /api/economics`: ROI, CRR, investment ledger and break-even series; assumptions are query params. */
export const useEconomics = (params: EconomicsParams = {}) =>
  useQuery({
    queryKey: keys.economics.report(params),
    queryFn: ({ signal }) =>
      http.get<EconomicsReport>('/api/economics', {
        signal,
        query: {
          executions: params.executions,
          conservative: params.conservative === undefined ? undefined : String(params.conservative),
        },
      }),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
  });

/* ------------------------------------------------------------------------------------------------
 * Governance: audit, approvals, command safety
 * ---------------------------------------------------------------------------------------------- */

const fetchAudit = (params: AuditListParams, signal?: AbortSignal) =>
  http.get<Paged<AuditEventDto>>('/api/audit', {
    query: { ...params },
    ...(signal ? { signal } : {}),
  });

/** `GET /api/audit`: one page of the hash-chained audit log (newest first). */
export const useAudit = (params: AuditListParams = {}) =>
  useQuery({
    queryKey: keys.audit.list(params),
    queryFn: ({ signal }) => fetchAudit(params, signal),
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });

/** `GET /api/audit`: cursor-paged "load more" list; optionally filtered by `action`. */
export const useInfiniteAudit = (params: Omit<AuditListParams, 'cursor'> = {}) =>
  useInfiniteQuery({
    queryKey: keys.audit.infinite(params),
    queryFn: ({ pageParam, signal }) =>
      fetchAudit({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 5_000,
    placeholderData: keepPreviousData,
  });

/** `GET /api/audit/verify`: recomputes the whole chain. A mutation because it is user-triggered each time. */
export function useVerifyAudit() {
  return useMutation({
    mutationFn: () => http.get<AuditVerifyDto>('/api/audit/verify'),
    retry: false,
  });
}

/** `GET /api/approvals`: promotion, rejection, rollback and mutation decisions. */
export const useApprovals = () =>
  useQuery({
    queryKey: keys.approvals,
    queryFn: ({ signal }) => http.get<ApprovalsResponse>('/api/approvals', { signal }),
    staleTime: 10_000,
  });

/** `POST /api/security/evaluate`: evaluates a command line against policy. Never executes it. */
export function useEvaluateCommand() {
  return useApiMutation({
    mutationFn: (command: string) =>
      http.post<SecurityEvaluationDto>('/api/security/evaluate', { command }),
  });
}

/* ------------------------------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------------------------------- */

/** `GET /api/settings`: promotion gate, drift thresholds and economics assumptions. */
export const useSettings = () =>
  useQuery({
    queryKey: keys.settings,
    queryFn: ({ signal }) => http.get<SettingsDto>('/api/settings', { signal }),
    staleTime: 30_000,
  });

/** `PUT /api/settings` (admin). Thresholds feed gates, drift checks and the economics report. */
export function useUpdateSettings() {
  return useApiMutation({
    mutationFn: (settings: SettingsDto) => http.put<SettingsDto>('/api/settings', settings),
    onData: (data, _vars, qc) => qc.setQueryData(keys.settings, data),
    invalidates: [keys.economics.all, keys.reflexes.all, keys.drift, keys.audit.all],
  });
}

/* ------------------------------------------------------------------------------------------------
 * Jobs
 * ---------------------------------------------------------------------------------------------- */

export const isJobTerminal = (job: JobDto): boolean =>
  job.status === 'succeeded' || job.status === 'failed';

/** What a finished job can have changed. Invalidated once when a polled job reaches a terminal state. */
const JOB_FINISHED: readonly Key[] = [
  keys.reflexes.all,
  keys.runs.all,
  keys.tasks.all,
  keys.families.all,
  keys.economics.all,
  keys.drift,
  keys.mutations,
  keys.audit.all,
  keys.demo,
];

/**
 * `GET /api/jobs/:id`: polls (default every 600 ms) until the job succeeds or fails, then stops and
 * refreshes everything the job may have changed.
 */
export function useJob(jobId: string | null | undefined, options: { intervalMs?: number } = {}) {
  const qc = useQueryClient();
  const intervalMs = options.intervalMs ?? 600;
  return useQuery({
    queryKey: keys.jobs.detail(jobId ?? ''),
    enabled: Boolean(jobId),
    queryFn: async ({ signal }) => {
      const job = await http.get<JobDto>(`/api/jobs/${enc(jobId ?? '')}`, { signal });
      if (isJobTerminal(job)) void invalidate(qc, ...JOB_FINISHED);
      return job;
    },
    refetchInterval: (query) => {
      const job = query.state.data;
      return job && isJobTerminal(job) ? false : intervalMs;
    },
    staleTime: 0,
  });
}

/* ------------------------------------------------------------------------------------------------
 * Guided demo
 * ---------------------------------------------------------------------------------------------- */

/** `GET /api/demo`. Pass `poll: true` while a perform call is pending to read `activeJob` progress. */
export const useDemoState = (
  options: { poll?: boolean; intervalMs?: number; enabled?: boolean } = {},
) =>
  useQuery({
    queryKey: keys.demo,
    queryFn: ({ signal }) => http.get<DemoStateDto>('/api/demo', { signal }),
    staleTime: 2_000,
    enabled: options.enabled ?? true,
    refetchInterval: options.poll ? (options.intervalMs ?? 400) : false,
  });

const DEMO_CHANGED: readonly Key[] = [
  keys.tasks.all,
  keys.runs.all,
  keys.lab.all,
  keys.system,
  keys.families.all,
  keys.reflexes.all,
  keys.drift,
  keys.mutations,
  keys.economics.all,
  keys.audit.all,
  keys.approvals,
  // A final authoritative read of the presenter state once the action has settled.
  keys.demo,
];

/**
 * Replaces the cached demo state and cancels any in-flight poll first: a poll that left before the server saved
 * the step could otherwise resolve later and overwrite this fresher state with an older one.
 */
function setDemoState(qc: QueryClient, data: DemoStateDto): void {
  void qc.cancelQueries({ queryKey: keys.demo });
  qc.setQueryData(keys.demo, data);
}

/** `POST /api/demo/goto`: moves the presenter cursor only. */
export function useDemoGoto() {
  return useApiMutation({
    mutationFn: (step: number) => http.post<DemoStateDto>('/api/demo/goto', { step }),
    onData: (data, _vars, qc) => setDemoState(qc, data),
  });
}

/**
 * `POST /api/demo/steps/:n/perform`: runs the real work for step n (and any earlier steps not yet
 * done). Idempotent. Can take ~15 s: poll `useDemoState({ poll: true })` meanwhile.
 */
export function useDemoPerform() {
  return useApiMutation({
    mutationFn: (step: number) => http.post<DemoStateDto>(`/api/demo/steps/${step}/perform`),
    onData: (data, _vars, qc) => setDemoState(qc, data),
    invalidates: DEMO_CHANGED,
  });
}

export type DemoSeedStage =
  'learned' | 'validated' | 'promoted' | 'killer' | 'drifted' | 'complete';

/** `POST /api/demo/seed`: fast-forwards to a stage (a simulated reviewer performs the human step). */
export function useDemoSeed() {
  return useApiMutation({
    mutationFn: (stage: DemoSeedStage) => http.post<DemoStateDto>('/api/demo/seed', { stage }),
    onData: (data, _vars, qc) => setDemoState(qc, data),
    invalidates: DEMO_CHANGED,
  });
}

/** `POST /api/demo/reset` (admin, demo mode only): recreates the database and starts a new audit chain. */
export function useDemoReset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post<DemoStateDto>('/api/demo/reset'),
    retry: false,
    onSuccess: async (data) => {
      await dropTenantData(qc, true);
      setDemoState(qc, data);
    },
  });
}
