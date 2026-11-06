import type { Condition, JsonValue, Operand } from '@bigforge/schemas';

/** Evaluation context for Reflex bindings and conditions. Data only; no code. */
export interface EvalContext {
  inputs: Record<string, JsonValue>;
  env: Record<string, JsonValue>;
  steps: Record<string, { output: unknown; confidence?: number }>;
}

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

/** Resolves a dotted reference such as `steps.locate.output.root_failure.workspace`. */
export function resolveRef(ctx: EvalContext, ref: string): unknown {
  const parts = ref.split('.');
  let current: unknown = ctx;
  for (const part of parts) {
    if (FORBIDDEN.has(part) || current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      const idx = Number(part);
      current = Number.isInteger(idx) ? current[idx] : undefined;
      continue;
    }
    if (!Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function resolveOperand(ctx: EvalContext, operand: Operand): unknown {
  return 'ref' in operand ? resolveRef(ctx, operand.ref) : operand.const;
}

function compare(a: unknown, b: unknown): number | null {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

export function evalCondition(cond: Condition, ctx: EvalContext): boolean {
  switch (cond.op) {
    case 'all':
      return cond.conditions.every((c) => evalCondition(c, ctx));
    case 'any':
      return cond.conditions.some((c) => evalCondition(c, ctx));
    case 'not':
      return !evalCondition(cond.condition, ctx);
    case 'exists':
      return (
        resolveOperand(ctx, cond.left) !== undefined && resolveOperand(ctx, cond.left) !== null
      );
    case 'not_exists':
      return (
        resolveOperand(ctx, cond.left) === undefined || resolveOperand(ctx, cond.left) === null
      );
    default: {
      const left = resolveOperand(ctx, cond.left);
      const right = resolveOperand(ctx, cond.right);
      switch (cond.op) {
        case 'eq':
          return JSON.stringify(left) === JSON.stringify(right);
        case 'neq':
          return JSON.stringify(left) !== JSON.stringify(right);
        case 'lt':
          return (compare(left, right) ?? NaN) < 0;
        case 'lte':
          return (compare(left, right) ?? NaN) <= 0;
        case 'gt':
          return (compare(left, right) ?? NaN) > 0;
        case 'gte':
          return (compare(left, right) ?? NaN) >= 0;
        case 'contains':
          if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
          return (
            Array.isArray(left) && left.some((x) => JSON.stringify(x) === JSON.stringify(right))
          );
        case 'in':
          return (
            Array.isArray(right) && right.some((x) => JSON.stringify(x) === JSON.stringify(left))
          );
        default:
          return false;
      }
    }
  }
}

/** Human-readable rendering of a condition (for the UI and audit trail). */
export function describeCondition(cond: Condition): string {
  const operand = (o: Operand) => ('ref' in o ? o.ref : JSON.stringify(o.const));
  switch (cond.op) {
    case 'all':
      return cond.conditions.map(describeCondition).join(' AND ');
    case 'any':
      return cond.conditions.map(describeCondition).join(' OR ');
    case 'not':
      return `NOT (${describeCondition(cond.condition)})`;
    case 'exists':
      return `${operand(cond.left)} exists`;
    case 'not_exists':
      return `${operand(cond.left)} is missing`;
    default: {
      const symbols = {
        eq: '==',
        neq: '!=',
        lt: '<',
        lte: '<=',
        gt: '>',
        gte: '>=',
        contains: 'contains',
        in: 'in',
      } as const;
      return `${operand(cond.left)} ${symbols[cond.op]} ${operand(cond.right)}`;
    }
  }
}
