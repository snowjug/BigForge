/** Safe string view of an arbitrary JSON-ish value (never "[object Object]"). */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}
