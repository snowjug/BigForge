/**
 * Route and query-string convention for the whole app. Pure functions: import these instead of building
 * URLs by hand, and see routes.md for the contract between pages.
 *
 *   /                          Forge Floor
 *   /login                     ?next=<path to return to>
 *   /run                       ?task=<taskId>&run=<runId>
 *   /traces                    list
 *   /traces/:runId             one run's trace
 *   /learn                     ?family=<familyId>
 *   /reflexes                  registry
 *   /reflexes/:versionId       one Reflex version
 *   /shadow                    ?version=<reflexVersionId>
 *   /economics
 *   /drift                     ?version=<reflexVersionId>
 *   /governance                ?tab=audit|approvals|roles|safety
 *   /settings
 */

type Id = string | null | undefined;

export const ROUTES = {
  home: '/',
  login: '/login',
  run: '/run',
  traces: '/traces',
  learn: '/learn',
  reflexes: '/reflexes',
  shadow: '/shadow',
  economics: '/economics',
  drift: '/drift',
  governance: '/governance',
  settings: '/settings',
} as const;

/** react-router path patterns for the route table. */
export const ROUTE_PATTERNS = {
  ...ROUTES,
  trace: '/traces/:runId',
  reflex: '/reflexes/:versionId',
} as const;

export const GOVERNANCE_TABS = ['audit', 'approvals', 'roles', 'safety'] as const;
export type GovernanceTab = (typeof GOVERNANCE_TABS)[number];

function withQuery(path: string, params: Record<string, Id>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

const segment = (id: string): string => encodeURIComponent(id);

export const homePath = (): string => ROUTES.home;
/** `next` must be an in-app path; anything else is dropped (open-redirect guard). */
export const loginPath = (next?: Id): string => withQuery(ROUTES.login, { next: safeNext(next) });
export const runPath = (params: { task?: Id; run?: Id } = {}): string =>
  withQuery(ROUTES.run, { task: params.task, run: params.run });
export const tracesPath = (): string => ROUTES.traces;
export const tracePath = (runId: string): string => `${ROUTES.traces}/${segment(runId)}`;
export const learnPath = (params: { family?: Id } = {}): string =>
  withQuery(ROUTES.learn, { family: params.family });
export const reflexesPath = (): string => ROUTES.reflexes;
export const reflexPath = (versionId: string): string => `${ROUTES.reflexes}/${segment(versionId)}`;
export const shadowPath = (params: { version?: Id } = {}): string =>
  withQuery(ROUTES.shadow, { version: params.version });
export const driftPath = (params: { version?: Id } = {}): string =>
  withQuery(ROUTES.drift, { version: params.version });
export const economicsPath = (): string => ROUTES.economics;
export const governancePath = (params: { tab?: GovernanceTab } = {}): string =>
  withQuery(ROUTES.governance, { tab: params.tab });
export const settingsPath = (): string => ROUTES.settings;

/** Accepts only in-app absolute paths such as "/run?task=x". Rejects "//host", "http:", "javascript:" and "". */
export function safeNext(next: Id): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  if (next === ROUTES.login || next.startsWith(`${ROUTES.login}?`)) return null;
  return next;
}

type SearchInput = URLSearchParams | string;
const toSearch = (input: SearchInput): URLSearchParams =>
  typeof input === 'string' ? new URLSearchParams(input) : input;
const read = (search: URLSearchParams, key: string): string | null => {
  const value = search.get(key);
  return value ? value : null;
};

export interface RunParams {
  task: string | null;
  run: string | null;
}
export const parseRunParams = (input: SearchInput): RunParams => {
  const search = toSearch(input);
  return { task: read(search, 'task'), run: read(search, 'run') };
};

export const parseLearnParams = (input: SearchInput): { family: string | null } => ({
  family: read(toSearch(input), 'family'),
});

export const parseShadowParams = (input: SearchInput): { version: string | null } => ({
  version: read(toSearch(input), 'version'),
});

export const parseDriftParams = (input: SearchInput): { version: string | null } => ({
  version: read(toSearch(input), 'version'),
});

export function parseGovernanceParams(input: SearchInput): { tab: GovernanceTab } {
  const tab = read(toSearch(input), 'tab');
  return { tab: GOVERNANCE_TABS.find((entry) => entry === tab) ?? 'audit' };
}

export const parseLoginParams = (input: SearchInput): { next: string | null } => ({
  next: safeNext(read(toSearch(input), 'next')),
});
