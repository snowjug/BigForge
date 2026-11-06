import type { Provenance } from '@bigforge/schemas';
import type { Tone } from './tone';

export type ProvenanceKind = Provenance;

export interface ProvenanceInfo {
  label: string;
  tone: Tone;
  /** How the badge is drawn, so the kind is never conveyed by colour alone. */
  pattern: 'solid' | 'dashed' | 'hatched' | 'lock' | 'replay';
  /** What the label promises. Mirrors the contract in packages/schemas/src/common.ts. */
  summary: string;
}

/** Display order: observed first, then replayed, then stand-ins, then derived. */
export const PROVENANCE_ORDER: readonly ProvenanceKind[] = [
  'measured',
  'replay-measured',
  'synthetic',
  'simulated',
  'estimated',
];

export const PROVENANCE_INFO: Record<ProvenanceKind, ProvenanceInfo> = {
  measured: {
    label: 'Measured',
    tone: 'jade',
    pattern: 'lock',
    summary:
      'Observed from a real system, such as a local command duration or live provider usage.',
  },
  'replay-measured': {
    label: 'Replay-measured',
    tone: 'teal',
    pattern: 'replay',
    summary: 'Measured by re-running a recorded task against a Reflex.',
  },
  synthetic: {
    label: 'Synthetic',
    tone: 'steel',
    pattern: 'solid',
    summary:
      'Produced by the deterministic provider, a scripted stand-in for a model so the demo runs offline. Not the output of a real model.',
  },
  simulated: {
    label: 'Simulated',
    tone: 'ash',
    pattern: 'dashed',
    summary: 'Computed from a documented deterministic model, for example simulated model latency.',
  },
  estimated: {
    label: 'Estimated',
    tone: 'amber',
    pattern: 'hatched',
    summary: 'A counterfactual or projected value derived from other data. Not observed.',
  },
};

/** Normalises the one-or-many provenance prop and removes duplicates while keeping display order. */
export function provenanceList(
  value: ProvenanceKind | readonly ProvenanceKind[] | undefined,
): ProvenanceKind[] {
  if (value === undefined) return [];
  const wanted = new Set<ProvenanceKind>(typeof value === 'string' ? [value] : value);
  return PROVENANCE_ORDER.filter((kind) => wanted.has(kind));
}
