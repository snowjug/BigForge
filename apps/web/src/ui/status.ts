import type { ReflexStatus, Role } from '@bigforge/schemas';
import type { Tone } from './tone';

export interface StatusMeta {
  label: string;
  tone: Tone;
  /** Raw and pending states are dashed; validated and trusted states are solid. */
  dashed: boolean;
  description: string;
}

/**
 * Lifecycle language for Reflex versions (README: Candidate -> Replay -> Shadow -> Approval -> Active
 * -> Watch -> Recompile -> Deprecated -> Retired). Trust is jade, probation is amber/ember, end of
 * life is ash.
 */
export const REFLEX_STATUS: Record<ReflexStatus, StatusMeta> = {
  candidate: {
    label: 'Candidate',
    tone: 'ash',
    dashed: true,
    description: 'Compiled from traces. It cannot run live and has not been validated.',
  },
  replay: {
    label: 'Replay',
    tone: 'steel',
    dashed: true,
    description: 'Being replayed against the historical traces it was compiled from.',
  },
  shadow: {
    label: 'Shadow',
    tone: 'ember',
    dashed: true,
    description:
      'Running beside the baseline agent. Shadow runs spend tokens before they save any.',
  },
  approval: {
    label: 'Awaiting approval',
    tone: 'molten',
    dashed: false,
    description: 'Evidence gathered. A human reviewer decides whether it may run live.',
  },
  active: {
    label: 'Active',
    tone: 'jade',
    dashed: false,
    description: 'Promoted by a human. Known steps run locally; unknowns cross the Token Firewall.',
  },
  watch: {
    label: 'Watch',
    tone: 'amber',
    dashed: false,
    description: 'Trust is slipping. It still runs, under closer observation.',
  },
  recompile: {
    label: 'Recompile',
    tone: 'ember',
    dashed: true,
    description: 'Persistent disagreement: a new version must be compiled.',
  },
  deprecated: {
    label: 'Deprecated',
    tone: 'ash',
    dashed: false,
    description: 'Superseded or rejected. It will not run.',
  },
  retired: {
    label: 'Retired',
    tone: 'ash',
    dashed: true,
    description: 'End of life.',
  },
};

export interface RoleMeta {
  label: string;
  tone: Tone;
  summary: string;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  viewer: { label: 'Viewer', tone: 'ash', summary: 'Read-only: can browse everything.' },
  operator: {
    label: 'Operator',
    tone: 'steel',
    summary: 'Runs tasks, replays, Shadow Brain and canaries. Cannot approve.',
  },
  reviewer: {
    label: 'Reviewer',
    tone: 'jade',
    summary:
      'The human in the loop: promotes, rejects and rolls back Reflexes, approves mutations.',
  },
  admin: {
    label: 'Admin',
    tone: 'amber',
    summary: 'Everything a reviewer can do, plus settings and demo reset.',
  },
};
