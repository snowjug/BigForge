import type { ApiError as ApiErrorBody } from '@bigforge/schemas';

/** Thrown for every non-2xx response and for transport failures. `status` is 0 when the server was unreachable. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(init: { status: number; code: string; message: string; details?: unknown }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** A short, user-presentable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  query?: QueryParams;
  signal?: AbortSignal;
}

const CLIENT_HEADER = 'X-BigForge-Client';

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const inner = value.error;
  if (typeof inner !== 'object' || inner === null) return false;
  const { code, message } = inner as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string';
}

export function buildQuery(params: QueryParams | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

async function readJson(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) return undefined;
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', [CLIENT_HEADER]: 'web' };
  const init: RequestInit = {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(options.signal ? { signal: options.signal } : {}),
  };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body ?? {});
  }

  let response: Response;
  try {
    response = await fetch(`${path}${buildQuery(options.query)}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({
      status: 0,
      code: 'network_error',
      message: 'Could not reach the BigForge API. Check that the server is running.',
    });
  }

  const payload = await readJson(response);
  if (!response.ok) {
    if (isErrorBody(payload)) {
      throw new ApiError({
        status: response.status,
        code: payload.error.code,
        message: payload.error.message,
        ...(payload.error.details !== undefined ? { details: payload.error.details } : {}),
      });
    }
    throw new ApiError({
      status: response.status,
      code: 'http_error',
      message: `The server answered ${response.status} ${response.statusText}`.trim(),
    });
  }
  if (payload === undefined) {
    if (response.status === 204) return undefined as T;
    throw new ApiError({
      status: response.status,
      code: 'bad_response',
      message: 'The server did not return JSON',
    });
  }
  return payload as T;
}

/** The only way the app talks to the backend: JSON in, JSON out, errors normalised into ApiError. */
export const http = {
  get: <T>(path: string, options: RequestOptions = {}) =>
    request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
    request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown, options: RequestOptions = {}) =>
    request<T>('PUT', path, body, options),
};
