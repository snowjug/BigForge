import type { Condition, Operand } from '@bigforge/schemas';

/**
 * Renders the closed expression language (refs, constants and the fixed operators) as readable sentences,
 * so a reviewer can read what makes a step escalate or stop without reading JSON.
 */

type TitleOf = (stepId: string) => string | undefined;

const humanise = (text: string): string => text.replaceAll('_', ' ');

/** `steps.decide.output.candidate_count` -> `the candidate count of "Select the remedy"`. */
export function describeRef(ref: string, titleOf: TitleOf): string {
  const parts = ref.split('.');
  const root = parts[0];
  if (root === 'steps' && parts.length >= 3) {
    const id = parts[1] as string;
    const title = titleOf(id);
    const subject = title ? `\u201c${title}\u201d` : `step ${id}`;
    if (parts[2] === 'confidence') return `the confidence of ${subject}`;
    if (parts[2] === 'output' && parts.length > 3) {
      return `the ${humanise(parts.slice(3).join(' '))} from ${subject}`;
    }
    if (parts[2] === 'output') return `the output of ${subject}`;
  }
  if (root === 'inputs' && parts.length > 1)
    return `the input ${humanise(parts.slice(1).join(' '))}`;
  if (root === 'env' && parts.length > 1)
    return `the environment ${humanise(parts.slice(1).join(' '))}`;
  return ref;
}

function constant(value: unknown): string {
  if (typeof value === 'string') return `\u201c${value}\u201d`;
  if (Array.isArray(value)) return `[${value.map(constant).join(', ')}]`;
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value);
}

export function describeOperand(operand: Operand, titleOf: TitleOf): string {
  return 'ref' in operand ? describeRef(operand.ref, titleOf) : constant(operand.const);
}

const COMPARATOR: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  lt: 'is below',
  lte: 'is at most',
  gt: 'is above',
  gte: 'is at least',
  contains: 'contains',
  in: 'is one of',
};

export function describeCondition(condition: Condition, titleOf: TitleOf): string {
  switch (condition.op) {
    case 'exists':
      return `${describeOperand(condition.left, titleOf)} exists`;
    case 'not_exists':
      return `${describeOperand(condition.left, titleOf)} does not exist`;
    case 'all':
    case 'any': {
      const joiner = condition.op === 'all' ? ' and ' : ' or ';
      const inner = condition.conditions.map((c) => describeCondition(c, titleOf));
      if (inner.length === 0) return condition.op === 'all' ? 'always' : 'never';
      return inner.length === 1 ? (inner[0] as string) : `(${inner.join(joiner)})`;
    }
    case 'not':
      return `not (${describeCondition(condition.condition, titleOf)})`;
    default:
      return `${describeOperand(condition.left, titleOf)} ${COMPARATOR[condition.op] ?? condition.op} ${describeOperand(condition.right, titleOf)}`;
  }
}

/** "Cross the boundary when X or Y." Empty list -> null (the step has no such guard). */
export function describeGuard(
  conditions: readonly Condition[],
  lead: string,
  titleOf: TitleOf,
): string | null {
  if (conditions.length === 0) return null;
  const parts = conditions.map((c) => describeCondition(c, titleOf));
  return `${lead} ${parts.join(', or when ')}.`;
}
