import { ROUTES } from '../routes';

export type PageId =
  | 'home'
  | 'run'
  | 'traces'
  | 'learn'
  | 'reflexes'
  | 'shadow'
  | 'economics'
  | 'drift'
  | 'governance'
  | 'settings';

export interface PageMeta {
  id: PageId;
  /** Document and heading title. */
  title: string;
  /** Short label for the rail and tab bar. */
  navLabel: string;
  path: string;
  /** The question this page answers (docs/DESIGN_SYSTEM.md, "Pages"). */
  question: string;
  decision: string;
  evidence: string;
  action: string;
}

/** The page contract from the design brief. Every page leads with its question. */
export const PAGE_META: Record<PageId, PageMeta> = {
  home: {
    id: 'home',
    title: 'Forge Floor',
    navLabel: 'Forge Floor',
    path: ROUTES.home,
    question: 'Where is the forge right now?',
    decision: 'Start the guided demo or continue',
    evidence: 'Live pipeline stage, key figures with provenance',
    action: 'Start guided demo, Reset',
  },
  run: {
    id: 'run',
    title: 'Run Console',
    navLabel: 'Run',
    path: ROUTES.run,
    question: 'What happens to this task?',
    decision: 'Which path should it take?',
    evidence: 'Task and CI log, match decision with gates, execution playback',
    action: 'Send failure, Run baseline / auto / compare',
  },
  traces: {
    id: 'traces',
    title: 'Traces',
    navLabel: 'Traces',
    path: ROUTES.traces,
    question: 'What did the agent actually do?',
    decision: 'Is this trace safe to learn from?',
    evidence:
      'Trace timeline, tokens (synthetic), commands (measured), redactions, blocked actions',
    action: 'Inspect',
  },
  learn: {
    id: 'learn',
    title: 'Learn',
    navLabel: 'Learn',
    path: ROUTES.learn,
    question: 'What repeats?',
    decision: 'Compile a Reflex?',
    evidence: 'Families, matcher false-match rate, alignment and Reflex DNA',
    action: 'Discover, Compile',
  },
  reflexes: {
    id: 'reflexes',
    title: 'Reflexes',
    navLabel: 'Reflexes',
    path: ROUTES.reflexes,
    question: 'Is this Reflex trustworthy and what does it do?',
    decision: 'Promote, reject or roll back',
    evidence: 'Steps (Forge Graph), permissions, gate, evidence, lifecycle, audit',
    action: 'Replay, Shadow, Promote (reviewer)',
  },
  shadow: {
    id: 'shadow',
    title: 'Shadow Brain',
    navLabel: 'Shadow',
    path: ROUTES.shadow,
    question: 'Does it agree with the AI?',
    decision: 'Eligible for promotion?',
    evidence: 'Replay and shadow comparison table, gate checklist',
    action: 'Replay, Run Shadow Brain',
  },
  economics: {
    id: 'economics',
    title: 'Cognitive Economics',
    navLabel: 'Economics',
    path: ROUTES.economics,
    question: 'Is it worth it?',
    decision: 'Keep investing?',
    evidence: 'ROI, CRR, break-even with interval',
    action: 'Adjust assumptions',
  },
  drift: {
    id: 'drift',
    title: 'Drift Canary',
    navLabel: 'Drift',
    path: ROUTES.drift,
    question: 'Is the world still the same?',
    decision: 'Accept or reject a mutation',
    evidence: 'Canary grid, agreement, fracture, mutation diff',
    action: 'Update tool, Run canary, Propose / Approve mutation',
  },
  governance: {
    id: 'governance',
    title: 'Governance',
    navLabel: 'Governance',
    path: ROUTES.governance,
    question: 'Who did what, and what is blocked?',
    decision: 'Trust the system?',
    evidence: 'Audit chain verification, approvals, command-safety playground, roles',
    action: 'Verify chain, Try a command',
  },
  settings: {
    id: 'settings',
    title: 'Settings',
    navLabel: 'Settings',
    path: ROUTES.settings,
    question: 'What is configured and what is real?',
    decision: 'Change thresholds',
    evidence: 'Provider honesty panel, gate / drift / economics settings',
    action: 'Save (admin), Reset demo (admin)',
  },
};

export const PAGE_ORDER: readonly PageId[] = [
  'home',
  'run',
  'traces',
  'learn',
  'reflexes',
  'shadow',
  'drift',
  'economics',
  'governance',
  'settings',
];
