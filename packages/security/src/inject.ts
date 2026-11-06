export interface InjectionFinding {
  rule: string;
  excerpt: string;
}

const RULES: { rule: string; re: RegExp }[] = [
  {
    rule: 'ignore_instructions',
    re: /\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules|messages)\b/i,
  },
  {
    rule: 'override_system',
    re: /\b(?:disregard|override|forget)\s+(?:the\s+)?(?:system|developer)\s+(?:prompt|message|instructions)\b/i,
  },
  {
    rule: 'run_this_command',
    re: /\b(?:run|execute)\s+(?:the\s+following|this)\s+(?:command|script|code)\b/i,
  },
  { rule: 'pipe_to_shell', re: /\b(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:ba|z)?sh\b/i },
  {
    rule: 'reveal_secrets',
    re: /\b(?:reveal|print|exfiltrate|send)\s+(?:your|the|all)\s+(?:system\s+prompt|secrets?|api\s*keys?|credentials|tokens?)\b/i,
  },
  {
    rule: 'role_markers',
    re: /(?:<\|im_start\|>|<\|system\|>|^\s*#{2,3}\s*(?:system|assistant)\b)/im,
  },
];

/**
 * Screens untrusted evidence (logs, repository text, tool output) for instruction-like content.
 * Evidence is data. Findings are surfaced and the matching line is withheld from model context.
 */
export function screenForInstructions(text: string): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const { rule, re } of RULES) {
    const m = re.exec(text);
    if (m) findings.push({ rule, excerpt: m[0].slice(0, 120) });
  }
  return findings;
}

/** Drops lines that match instruction-like rules. Returns the cleaned text and removed line count. */
export function stripInstructionLines(text: string): { text: string; removed: number } {
  let removed = 0;
  const kept = text.split('\n').filter((line) => {
    if (screenForInstructions(line).length > 0) {
      removed += 1;
      return false;
    }
    return true;
  });
  return { text: kept.join('\n'), removed };
}
