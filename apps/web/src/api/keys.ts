import type {
  AuditListParams,
  ComparisonListParams,
  EconomicsParams,
  RunListParams,
  TaskListParams,
} from './types';

/**
 * Query key factory. Every key starts with a stable root so a whole area can be invalidated with
 * `queryClient.invalidateQueries({ queryKey: keys.reflexes.all })`.
 */
export const keys = {
  auth: {
    all: ['auth'] as const,
    me: ['auth', 'me'] as const,
    personas: ['auth', 'personas'] as const,
  },
  health: ['health'] as const,
  ready: ['ready'] as const,
  system: ['system'] as const,
  metricDefinitions: ['metrics', 'definitions'] as const,
  settings: ['settings'] as const,
  lab: {
    all: ['lab'] as const,
    scenarios: ['lab', 'scenarios'] as const,
    environment: ['lab', 'environment'] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    list: (params: TaskListParams = {}) => ['tasks', 'list', params] as const,
    infinite: (params: TaskListParams = {}) => ['tasks', 'infinite', params] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
  },
  runs: {
    all: ['runs'] as const,
    list: (params: RunListParams = {}) => ['runs', 'list', params] as const,
    infinite: (params: RunListParams = {}) => ['runs', 'infinite', params] as const,
    detail: (id: string) => ['runs', 'detail', id] as const,
  },
  families: {
    all: ['families'] as const,
    matcher: ['families', 'matcher'] as const,
  },
  reflexes: {
    all: ['reflexes'] as const,
    list: ['reflexes', 'list'] as const,
    version: (id: string) => ['reflexes', 'version', id] as const,
    comparisons: (id: string, params: ComparisonListParams = {}) =>
      ['reflexes', 'version', id, 'comparisons', params] as const,
    comparisonsInfinite: (id: string, params: ComparisonListParams = {}) =>
      ['reflexes', 'version', id, 'comparisons-infinite', params] as const,
    export: (id: string) => ['reflexes', 'version', id, 'export'] as const,
  },
  drift: ['drift'] as const,
  mutations: ['mutations'] as const,
  economics: {
    all: ['economics'] as const,
    report: (params: EconomicsParams = {}) => ['economics', params] as const,
  },
  audit: {
    all: ['audit'] as const,
    list: (params: AuditListParams = {}) => ['audit', 'list', params] as const,
    infinite: (params: AuditListParams = {}) => ['audit', 'infinite', params] as const,
    verify: ['audit', 'verify'] as const,
  },
  approvals: ['approvals'] as const,
  jobs: {
    all: ['jobs'] as const,
    detail: (id: string) => ['jobs', id] as const,
  },
  demo: ['demo'] as const,
} as const;

/** Roots that hold tenant data. Cleared when the signed-in identity changes. */
export const TENANT_DATA_ROOTS: readonly string[] = [
  'tasks',
  'runs',
  'families',
  'reflexes',
  'drift',
  'mutations',
  'economics',
  'audit',
  'approvals',
  'jobs',
  'demo',
  'lab',
  'system',
  'settings',
];
