export type ClassValue = string | false | null | undefined;

/** Joins truthy class names. */
export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}
