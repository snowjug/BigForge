import type { ReflexStep } from '@bigforge/schemas';

/** Runtime state of one step. A missing entry in `states` means `idle`. */
export type NodeState =
  'idle' | 'running' | 'done' | 'boundary' | 'verified' | 'stopped' | 'skipped';

/** Where trust cracks: a fracture is drawn across this step and everything downstream is dimmed. */
export interface GraphFracture {
  stepId: string;
  label?: string;
}

/** A small caption under a node, e.g. "2,140 tok replaced" or "371 tok". */
export interface NodeBadge {
  text: string;
  tone?: 'ember' | 'molten' | 'steel' | 'jade' | 'crimson' | 'teal' | 'amber' | 'ash';
}

export interface ForgeGraphProps {
  /** From ReflexVersionDto.spec.steps. Order is not significant: `dependsOn` defines the DAG. */
  steps: readonly ReflexStep[];
  /** By step id. Missing entries are `idle`. */
  states?: Readonly<Record<string, NodeState>>;
  selectedId?: string | null;
  /** Fired on click, Enter or Space on a node. */
  onSelect?: (stepId: string) => void;
  /** Draws a crimson hairline fracture across that node and dims everything downstream (drift view). */
  fracture?: GraphFracture | null;
  /** Small caption under a node. */
  badges?: Readonly<Record<string, NodeBadge>>;
  /** Shows rationale.baselineTokens (SYNTHETIC) as a thin bar and a caption on each node. */
  showTokens?: boolean;
  /** Default `LR`. */
  direction?: 'LR' | 'TB';
  /** Default `comfortable`; `compact` suits ~460px inspector drawers. */
  density?: 'comfortable' | 'compact';
  /** Required: describes the graph for assistive technology. */
  ariaLabel: string;
  className?: string;
}
