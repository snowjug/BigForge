import { createHash } from 'node:crypto';

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .filter((k) => obj[k] !== undefined)
        .map((k) => [k, sortKeys(obj[k])]),
    );
  }
  return value;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function contentHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export const GENESIS_HASH = '0'.repeat(64);

/** Hash-chain link: sha256(prevHash + canonical(payload)). Tamper-evident, append-only history. */
export function chainHash(prevHash: string, payload: unknown): string {
  return sha256Hex(`${prevHash}\n${canonicalJson(payload)}`);
}
