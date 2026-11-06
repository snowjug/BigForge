import { randomUUID } from 'node:crypto';

export interface IdGenerator {
  next(prefix: string): string;
}

export function randomIds(): IdGenerator {
  return { next: (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}` };
}

/** Deterministic ids for tests and golden output. */
export function sequentialIds(start = 0): IdGenerator {
  let n = start;
  return {
    next: (prefix) => {
      n += 1;
      return `${prefix}_${String(n).padStart(5, '0')}`;
    },
  };
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}
