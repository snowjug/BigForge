import { estimateTokens } from '@bigforge/providers';
import type {
  BoundarySpec,
  Condition,
  DecisionEvent,
  EvidenceChunk,
  JsonValue,
  PermissionRequirement,
  ReflexPermissions,
  StepKind,
  ToolCallEvent,
} from '@bigforge/schemas';
import type { PermissionSet } from '@bigforge/security';
import type { Sandbox } from './sandbox';
import type { InstrumentedTools } from './tools';

/** Evidence the run has observed. The Token Firewall selects the minimum subset a call may carry. */
export class EvidencePool {
  private readonly chunks: EvidenceChunk[] = [];

  add(chunk: { source: string; text: string; tags: string[]; id?: string }): EvidenceChunk {
    const full: EvidenceChunk = {
      id: chunk.id ?? `ev${this.chunks.length + 1}`,
      source: chunk.source,
      text: chunk.text,
      tags: chunk.tags,
      tokens: estimateTokens(chunk.text),
    };
    this.chunks.push(full);
    return full;
  }

  all(): EvidenceChunk[] {
    return [...this.chunks];
  }
}

export interface OperatorContext {
  tools: InstrumentedTools;
  sandbox: Sandbox;
  evidence: EvidencePool;
  inputs: Record<string, JsonValue>;
  env: Record<string, JsonValue>;
}

export interface OperatorResult {
  output: Record<string, unknown>;
  /** 0..1. Operators that cannot be sure say so; the step may then cross its uncertainty boundary. */
  confidence?: number;
  summary: string;
}

/** What the baseline agent did in one recorded trace for the purposes an operator replaces. */
export interface RecordedBehaviour {
  purposes: string[];
  toolCalls: ToolCallEvent[];
  decisions: DecisionEvent[];
}

export interface Agreement {
  ok: boolean;
  detail: string;
}

export interface OperatorDefinition {
  id: string;
  version: string;
  stepId: string;
  intent: string;
  title: string;
  description: string;
  kind: StepKind;
  role: 'behavior' | 'infra' | 'verification';
  /** argument name -> data name. `input.<name>` refers to a Reflex input. */
  consumes: Record<string, string>;
  provides: string[];
  /** Baseline trace purposes this operator absorbs when it is selected. */
  replaces: string[];
  requires: PermissionRequirement;
  /** Simplicity rank for tie-breaking between equally consistent operators (lower = simpler). */
  cost: number;
  mutating: boolean;
  /** Step ids that must depend on this step (ordering constraint, e.g. snapshot before patch). */
  runsBefore?: string[];
  escalation?: { threshold: number; boundary: BoundarySpec };
  /** Conditions over `steps.$self.*` that must stop the Reflex. */
  stopWhen?: Condition[];
  run(ctx: OperatorContext, args: Record<string, unknown>): Promise<OperatorResult>;
  /** Compile-time consistency: does this operator reproduce what the baseline did in this trace? */
  agrees?(recorded: RecordedBehaviour, produced: OperatorResult): Agreement;
}

export class OperatorLibrary {
  private readonly operators = new Map<string, OperatorDefinition>();

  register(...ops: OperatorDefinition[]): this {
    for (const op of ops) {
      const key = `${op.id}@${op.version}`;
      if (this.operators.has(key)) throw new Error(`Operator already registered: ${key}`);
      this.operators.set(key, op);
    }
    return this;
  }

  get(id: string, version: string): OperatorDefinition | undefined {
    return this.operators.get(`${id}@${version}`);
  }

  all(): OperatorDefinition[] {
    return [...this.operators.values()];
  }
}

export function permissionSetFromSpec(p: ReflexPermissions): PermissionSet {
  return {
    read: p.read,
    write: p.write,
    commands: p.commands.map((c) => ({ program: c.program, subcommands: c.subcommands })),
  };
}

export const SELF = '$self';
export function substituteSelf<T>(value: T, stepId: string): T {
  return JSON.parse(JSON.stringify(value).split(`steps.${SELF}.`).join(`steps.${stepId}.`)) as T;
}
