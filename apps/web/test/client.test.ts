import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, buildQuery, http } from '../src/api/client';

interface Captured {
  url: string;
  init: RequestInit;
}

/** Every call gets a fresh Response: a body can only be read once. */
function stubFetch(makeResponse: () => Response): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(makeResponse());
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildQuery', () => {
  it('skips empty values and encodes the rest', () => {
    expect(buildQuery({ limit: 25, cursor: undefined, action: '', kind: null })).toBe('?limit=25');
    expect(buildQuery({ q: 'a b&c', on: true })).toBe('?q=a+b%26c&on=true');
    expect(buildQuery(undefined)).toBe('');
    expect(buildQuery({})).toBe('');
  });
});

describe('http client', () => {
  it('sends the client header and same-origin credentials on reads and writes', async () => {
    const calls = stubFetch(() => json({ ok: true }));
    await http.get('/api/system');
    await http.post('/api/tasks', { scenarioId: 'L1' });
    for (const call of calls) {
      const headers = call.init.headers as Record<string, string>;
      expect(headers['X-BigForge-Client']).toBe('web');
      expect(headers.Accept).toBe('application/json');
      expect(call.init.credentials).toBe('same-origin');
    }
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.body).toBeUndefined();
    expect(calls[1]?.init.method).toBe('POST');
    expect((calls[1]?.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(calls[1]?.init.body).toBe('{"scenarioId":"L1"}');
  });

  it('puts query parameters on the URL', async () => {
    const calls = stubFetch(() => json({ items: [] }));
    await http.get('/api/audit', { query: { limit: 25, cursor: '40', action: undefined } });
    expect(calls[0]?.url).toBe('/api/audit?limit=25&cursor=40');
  });

  it('parses the {error:{code,message,details}} envelope into an ApiError', async () => {
    stubFetch(() =>
      json(
        { error: { code: 'forbidden', message: 'Not allowed', details: { action: 'promote' } } },
        403,
      ),
    );
    const error = await http.post('/api/reflexes/versions/x/promote').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const api = error as ApiError;
    expect(api.status).toBe(403);
    expect(api.code).toBe('forbidden');
    expect(api.message).toBe('Not allowed');
    expect(api.details).toEqual({ action: 'promote' });
    expect(api.isForbidden).toBe(true);
    expect(api.isUnauthenticated).toBe(false);
  });

  it('turns a non-JSON error, such as a proxy 502, into a readable ApiError', async () => {
    stubFetch(() => new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }));
    const error = (await http.get('/api/system').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('http_error');
    expect(error.message).toContain('502');
  });

  it('reports an unreachable server as a status-0 network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const error = (await http.get('/api/system').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe('network_error');
  });

  it('rejects a success answer that is not JSON and accepts 204', async () => {
    stubFetch(
      () =>
        new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    const error = (await http.get('/api/system').catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('bad_response');
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(http.post('/api/auth/logout')).resolves.toBeUndefined();
  });
});
