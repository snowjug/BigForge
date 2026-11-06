import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DETERMINISTIC_PROVIDER_ID,
  DeterministicProvider,
  LiveProvider,
  ProviderError,
  createLiveProviderFromEnv,
  estimateTokens,
} from '../src';

let server: Server;
let baseUrl: string;
let handler: (req: IncomingMessage, body: string, res: ServerResponse) => void = () => undefined;
const seen: { url?: string; headers: IncomingMessage['headers']; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body });
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const reply = (res: ServerResponse, status: number, json: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(json));
};
const ok = {
  choices: [
    {
      message: {
        content: '{"choiceId":"a"}',
        tool_calls: [{ id: 'c1', function: { name: 'read_file', arguments: '{"path":"x"}' } }],
      },
    },
  ],
  usage: {
    prompt_tokens: 120,
    completion_tokens: 15,
    prompt_tokens_details: { cached_tokens: 100 },
  },
};

const live = (over: Partial<ConstructorParameters<typeof LiveProvider>[0]> = {}) =>
  new LiveProvider({
    id: 'openai-compatible',
    baseUrl,
    apiKey: 'sk-test-0000',
    authScheme: 'bearer',
    models: { large: 'big', standard: 'mid', small: 'tiny' },
    maxTokensParam: 'max_tokens',
    timeoutMs: 2000,
    maxRetries: 2,
    ...over,
  });
const req = {
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxOutputTokens: 50,
  tier: 'standard' as const,
};

describe('live provider adapter (validated against a local protocol stub only)', () => {
  it('parses provider-reported usage as measured and maps tool calls', async () => {
    handler = (_r, _b, res) => reply(res, 200, ok);
    const c = await live().complete({ ...req, jsonResponse: true });
    expect(c.usage).toEqual({
      inputTokens: 120,
      outputTokens: 15,
      cachedInputTokens: 100,
      provenance: 'measured',
    });
    expect(c.latency.provenance).toBe('measured');
    expect(c.mode).toBe('live');
    expect(c.model).toBe('mid');
    expect(c.toolCalls).toEqual([{ id: 'c1', name: 'read_file', args: { path: 'x' } }]);
    const last = seen[seen.length - 1];
    expect(last?.headers.authorization).toBe('Bearer sk-test-0000');
    expect(JSON.parse(last?.body ?? '{}')).toMatchObject({
      model: 'mid',
      max_tokens: 50,
      response_format: { type: 'json_object' },
    });
  });

  it('retries 429 and 5xx a bounded number of times, then fails without leaking the key', async () => {
    let calls = 0;
    handler = (_r, _b, res) => {
      calls += 1;
      reply(
        res,
        calls < 3 ? 429 : 200,
        calls < 3 ? { error: 'rate limited sk-test-0000-abcdefghijklmnop1234' } : ok,
      );
    };
    await expect(live({ maxRetries: 2 }).complete(req)).resolves.toBeDefined();
    expect(calls).toBe(3);

    calls = 0;
    handler = (_r, _b, res) => {
      calls += 1;
      reply(res, 503, { error: 'Authorization: Bearer abcdefghijklmnop1234567890' });
    };
    const err = await live({ maxRetries: 1 })
      .complete(req)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(calls).toBe(2);
    expect((err as Error).message).not.toContain('abcdefghijklmnop1234567890');
  });

  it('does not retry client errors and uses the Azure api-key header and api-version', async () => {
    let calls = 0;
    handler = (_r, _b, res) => {
      calls += 1;
      reply(res, 400, { error: 'bad' });
    };
    await expect(live().complete(req)).rejects.toMatchObject({ retryable: false, status: 400 });
    expect(calls).toBe(1);

    handler = (_r, _b, res) => reply(res, 200, ok);
    await live({
      id: 'azure-openai',
      authScheme: 'api-key',
      apiVersion: '2024-10-21',
      maxTokensParam: 'max_completion_tokens',
    }).complete(req);
    const last = seen[seen.length - 1];
    expect(last?.url).toContain('api-version=2024-10-21');
    expect(last?.headers['api-key']).toBe('sk-test-0000');
    expect(JSON.parse(last?.body ?? '{}')).toHaveProperty('max_completion_tokens', 50);
  });

  it('times out slow providers', async () => {
    handler = () => undefined;
    await expect(live({ timeoutMs: 100, maxRetries: 0 }).complete(req)).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it('is only created from complete configuration', () => {
    expect(createLiveProviderFromEnv({})).toBeNull();
    expect(
      createLiveProviderFromEnv({
        BIGFORGE_LIVE_PROVIDER: 'azure-openai',
        AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com',
      }),
    ).toBeNull();
    expect(
      createLiveProviderFromEnv({
        BIGFORGE_LIVE_PROVIDER: 'openai-compatible',
        OPENAI_BASE_URL: baseUrl,
        OPENAI_API_KEY: 'k',
        OPENAI_MODEL: 'm',
      })?.id,
    ).toBe('openai-compatible');
    expect(
      createLiveProviderFromEnv({
        BIGFORGE_LIVE_PROVIDER: 'azure-openai',
        AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com',
        AZURE_OPENAI_DEPLOYMENT: 'd',
        AZURE_OPENAI_API_KEY: 'k',
      })?.id,
    ).toBe('azure-openai');
  });
});

describe('deterministic provider', () => {
  const policy = { id: 'p', respond: () => ({ text: 'ok', purpose: 'x' }) };
  it('labels everything synthetic/simulated and simulates prompt-cache reuse by shared prefix', async () => {
    const p = new DeterministicProvider([policy]);
    expect(p.id).toBe(DETERMINISTIC_PROVIDER_ID);
    const m1 = { role: 'system' as const, content: 'a'.repeat(400) };
    const m2 = { role: 'user' as const, content: 'b'.repeat(400) };
    const first = await p.complete({
      messages: [m1, m2],
      maxOutputTokens: 100,
      tier: 'large',
      policy: 'p',
      cacheKey: 'k',
    });
    expect(first.usage.provenance).toBe('synthetic');
    expect(first.latency.provenance).toBe('simulated');
    expect(first.usage.cachedInputTokens).toBe(0);
    const second = await p.complete({
      messages: [m1, m2, { role: 'user', content: 'c'.repeat(80) }],
      maxOutputTokens: 100,
      tier: 'large',
      policy: 'p',
      cacheKey: 'k',
    });
    expect(second.usage.cachedInputTokens).toBe(first.usage.inputTokens);
    expect(second.usage.inputTokens).toBeGreaterThan(first.usage.inputTokens);
    expect(p.modelFor('small')).toBe('forge-sim-small');
  });

  it('refuses unknown policies and estimates deterministically', async () => {
    const p = new DeterministicProvider([policy]);
    await expect(
      p.complete({ messages: [], maxOutputTokens: 1, tier: 'small', policy: 'nope' }),
    ).rejects.toThrow(/no policy/);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});
