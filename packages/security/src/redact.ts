export interface RedactionResult {
  text: string;
  count: number;
  kinds: string[];
}

interface Rule {
  kind: string;
  re: RegExp;
  replace: string | ((...args: string[]) => string);
}

// Every quantifier below is bounded so adversarial input (logs are untrusted) cannot cause quadratic backtracking.
const SECRET_VALUE = '(?=[A-Za-z0-9/_+=.-]{0,256}\\d)[A-Za-z0-9/_+=.-]{16,256}[A-Za-z0-9/_+=.-]*';

const RULES: Rule[] = [
  {
    kind: 'private_key',
    re: /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----[\s\S]{0,8192}?-----END [A-Z ]{0,30}PRIVATE KEY-----/g,
    replace: '[REDACTED:private_key]',
  },
  {
    kind: 'bearer_token',
    re: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replace: '$1 [REDACTED:bearer_token]',
  },
  {
    kind: 'basic_auth',
    re: /\b(Basic)\s+[A-Za-z0-9+/]{12,}={0,2}/g,
    replace: '$1 [REDACTED:basic_auth]',
  },
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,2048}\.[A-Za-z0-9_-]{8,2048}\b/g,
    replace: '[REDACTED:jwt]',
  },
  {
    kind: 'cloud_access_key',
    re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replace: '[REDACTED:cloud_access_key]',
  },
  {
    kind: 'github_token',
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g,
    replace: '[REDACTED:github_token]',
  },
  {
    kind: 'api_key',
    re: /\b(?:sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,255}|xox[abprs]-[A-Za-z0-9-]{10,255})\b/g,
    replace: '[REDACTED:api_key]',
  },
  {
    kind: 'azure_key',
    re: /\b(AccountKey|SharedAccessKey|InstrumentationKey)=[A-Za-z0-9+/=-]{20,256}/g,
    replace: '$1=[REDACTED:azure_key]',
  },
  {
    kind: 'sas_signature',
    re: /([?&]sig=)[A-Za-z0-9%+/=]{20,512}/g,
    replace: '$1[REDACTED:sas_signature]',
  },
  {
    kind: 'forge_token',
    re: /\bfrg_(?:live|demo)_[A-Za-z0-9_]{8,}\b/g,
    replace: '[REDACTED:forge_token]',
  },
  {
    kind: 'url_credentials',
    re: /\b([a-z][a-z0-9+.-]{0,30}:\/\/)([^\s:@/]{1,128}):([^\s@/]{1,256})@/gi,
    replace: '$1$2:[REDACTED:url_password]@',
  },
  {
    kind: 'secret_assignment',
    re: new RegExp(
      `\\b([A-Za-z0-9_.-]{0,40}(?:api[_-]?key|token|secret|passw(?:or)?d|credential)[A-Za-z0-9_.-]{0,40})(\\s*[:=]\\s*)(["']?)${SECRET_VALUE}\\3`,
      'gi',
    ),
    replace: '$1$2$3[REDACTED:secret]$3',
  },
];

/** Redacts secrets from text. Applied at trace capture, before model calls, and in logs. */
export function redactSecrets(input: string): RedactionResult {
  let text = input;
  let count = 0;
  const kinds = new Set<string>();
  for (const rule of RULES) {
    text = text.replace(rule.re, (...args: unknown[]) => {
      count += 1;
      kinds.add(rule.kind);
      const groups = args.slice(0, -2).filter((a): a is string => typeof a === 'string');
      if (typeof rule.replace === 'function') return rule.replace(...groups);
      return rule.replace.replace(/\$(\d)/g, (_m, n: string) => groups[Number(n)] ?? '');
    });
  }
  return { text, count, kinds: [...kinds] };
}

export function containsSecret(input: string): boolean {
  return redactSecrets(input).count > 0;
}

/** Redacts every string inside a JSON-like value (used before persisting trace arguments). */
export function redactDeep<T>(value: T): { value: T; count: number } {
  let count = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = redactSecrets(v);
      count += r.count;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return { value: walk(value) as T, count };
}
