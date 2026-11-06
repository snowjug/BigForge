import { PathViolationError, resolveInside } from './paths';

export interface FlagSpec {
  type: 'bool' | 'path' | 'enum' | 'string';
  values?: readonly string[];
  pattern?: RegExp;
  maxLength?: number;
}

export interface SubcommandPolicy {
  flags: Record<string, FlagSpec>;
  positionals?: { max: number; pattern?: RegExp };
}

export interface ProgramPolicy {
  /** Fixed argv prefix, e.g. [process.execPath, "/abs/path/forge-ci.mjs"]. Never model-controlled. */
  argvPrefix: readonly string[];
  subcommands: Record<string, SubcommandPolicy>;
}

export interface CommandPolicy {
  programs: Record<string, ProgramPolicy>;
  maxArgs: number;
  maxArgLength: number;
}

/** Structured command. Programs are allowlist identifiers, never executable paths or shell text. */
export interface CommandSpec {
  program: string;
  args: string[];
}

export type CommandValidation =
  | { ok: true; argv: string[]; subcommand: string; normalized: string }
  | { ok: false; rule: string; reason: string; destructive: boolean };

const DESTRUCTIVE: { rule: string; re: RegExp }[] = [
  { rule: 'rm_recursive', re: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i },
  { rule: 'git_reset_hard', re: /\bgit\s+reset\s+--hard\b/i },
  { rule: 'git_clean', re: /\bgit\s+clean\b/i },
  { rule: 'git_force_push', re: /\bgit\s+push\b.*(--force|-f\b)/i },
  { rule: 'disk_overwrite', re: /\b(dd\s+if=|mkfs(\.\w+)?\b|>\s*\/dev\/sd)/i },
  { rule: 'recursive_chmod', re: /\bchmod\s+-R\b/i },
  { rule: 'pipe_to_shell', re: /\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/i },
  { rule: 'privilege_escalation', re: /\b(sudo|su\s+-)\b/i },
  { rule: 'sql_drop', re: /\bdrop\s+(table|database)\b/i },
  { rule: 'system_shutdown', re: /\b(shutdown|reboot|halt)\b/i },
];

/** Names every destructive pattern found in free-form text. Used to label blocked proposals. */
export function classifyDestructive(text: string): string[] {
  return DESTRUCTIVE.filter((d) => d.re.test(text)).map((d) => d.rule);
}

const SHELL_META = /[;&|<>\n\r`]|\$\(|\$\{/;

export type ParsedCommandLine =
  | { ok: true; spec: CommandSpec }
  | { ok: false; rule: string; reason: string; destructive: boolean };

/**
 * Splits a command line into program + args WITHOUT any shell semantics.
 * Shell control characters are rejected outright: BigForge never executes shell text.
 */
export function parseCommandLine(line: string): ParsedCommandLine {
  const destructive = classifyDestructive(line);
  if (line.length > 2000) {
    return {
      ok: false,
      rule: 'line_too_long',
      reason: 'Command line is too long',
      destructive: destructive.length > 0,
    };
  }
  if (SHELL_META.test(line)) {
    return {
      ok: false,
      rule: 'shell_metacharacters',
      reason: 'Shell control characters are not allowed; commands must be structured',
      destructive: destructive.length > 0,
    };
  }
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || current) tokens.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (quote) {
    return {
      ok: false,
      rule: 'unterminated_quote',
      reason: 'Unterminated quote',
      destructive: destructive.length > 0,
    };
  }
  if (started || current) tokens.push(current);
  const [program, ...args] = tokens;
  if (!program) {
    return { ok: false, rule: 'empty_command', reason: 'Empty command', destructive: false };
  }
  return { ok: true, spec: { program, args } };
}

/**
 * Validates a structured command against the policy. Returns the final argv on success.
 * Allowlist semantics: anything not explicitly permitted is denied.
 */
export function validateCommand(
  spec: CommandSpec,
  policy: CommandPolicy,
  root: string,
): CommandValidation {
  const destructive = classifyDestructive([spec.program, ...spec.args].join(' ')).length > 0;
  const deny = (rule: string, reason: string): CommandValidation => ({
    ok: false,
    rule,
    reason,
    destructive,
  });

  if (!Array.isArray(spec.args) || spec.args.some((a) => typeof a !== 'string')) {
    return deny('invalid_args', 'Arguments must be an array of strings');
  }
  if (spec.args.length > policy.maxArgs) return deny('too_many_args', 'Too many arguments');
  if (spec.args.some((a) => a.length > policy.maxArgLength || a.includes('\0'))) {
    return deny('invalid_arg_value', 'An argument is too long or contains a NUL byte');
  }
  // Object.hasOwn: a model-chosen program name like "constructor" must not hit the prototype.
  if (!Object.hasOwn(policy.programs, spec.program)) {
    return deny('program_not_allowed', `Program "${spec.program}" is not on the allowlist`);
  }
  const program = policy.programs[spec.program] as ProgramPolicy;
  const [sub, ...rest] = spec.args;
  if (!sub || !Object.hasOwn(program.subcommands, sub)) {
    return deny(
      'subcommand_not_allowed',
      `Subcommand "${sub ?? ''}" is not allowed for ${spec.program}`,
    );
  }
  const subPolicy = program.subcommands[sub] as SubcommandPolicy;
  const normalized: string[] = [sub];
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] as string;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    if (!Object.hasOwn(subPolicy.flags, name)) {
      return deny('flag_not_allowed', `Flag "${name}" is not allowed for ${spec.program} ${sub}`);
    }
    const flag = subPolicy.flags[name] as FlagSpec;
    if (flag.type === 'bool') {
      if (eq !== -1) return deny('flag_value_invalid', `Flag "${name}" takes no value`);
      normalized.push(name);
      continue;
    }
    let value: string | undefined;
    if (eq !== -1) {
      value = token.slice(eq + 1);
    } else {
      value = rest[i + 1];
      i += 1;
    }
    if (value === undefined || value.length === 0) {
      return deny('flag_value_missing', `Flag "${name}" requires a value`);
    }
    if (flag.maxLength !== undefined && value.length > flag.maxLength) {
      return deny('flag_value_invalid', `Value for "${name}" is too long`);
    }
    if (flag.type === 'enum' && !flag.values?.includes(value)) {
      return deny('flag_value_invalid', `Value "${value}" is not allowed for "${name}"`);
    }
    if (flag.type === 'string' && flag.pattern && !flag.pattern.test(value)) {
      return deny('flag_value_invalid', `Value for "${name}" does not match the allowed pattern`);
    }
    if (flag.type === 'path') {
      try {
        resolveInside(root, value);
      } catch (err) {
        if (err instanceof PathViolationError) return deny(err.rule, err.message);
        throw err;
      }
    }
    normalized.push(name, value);
  }

  const maxPositionals = subPolicy.positionals?.max ?? 0;
  if (positionals.length > maxPositionals) {
    return deny(
      'positional_not_allowed',
      `Unexpected positional argument for ${spec.program} ${sub}`,
    );
  }
  for (const p of positionals) {
    if (subPolicy.positionals?.pattern && !subPolicy.positionals.pattern.test(p)) {
      return deny('positional_invalid', `Positional "${p}" does not match the allowed pattern`);
    }
    normalized.push(p);
  }

  return {
    ok: true,
    argv: [...program.argvPrefix, ...normalized],
    subcommand: sub,
    normalized: [spec.program, ...normalized].join(' '),
  };
}
