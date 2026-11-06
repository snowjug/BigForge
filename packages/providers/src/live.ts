import { redactSecrets } from '@bigforge/security';
import type { ModelTier } from '@bigforge/schemas';
import {
  type ChatMessage,
  type Completion,
  type CompletionRequest,
  type Provider,
  ProviderError,
  type ToolCallRequest,
} from './types';

export interface LiveProviderConfig {
  id: 'openai-compatible' | 'azure-openai';
  /** OpenAI: https://api.openai.com/v1. Azure: https://{resource}.openai.azure.com/openai/deployments/{deployment} */
  baseUrl: string;
  /** Static API key. Prefer `getToken` (managed identity) on Azure. */
  apiKey?: string;
  /** Returns a bearer token (e.g. Microsoft Entra). Takes precedence over apiKey. */
  getToken?: () => Promise<string>;
  authScheme: 'bearer' | 'api-key';
  apiVersion?: string;
  models: Record<ModelTier, string>;
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
}

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiResponse {
  choices?: { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function toWire(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'assistant' && m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.args) },
      })),
    };
  }
  if (m.role === 'tool') return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
  return { role: m.role, content: m.content };
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MAX_RESPONSE_CHARS = 2_000_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Credentials only travel over TLS; plain http is accepted solely for a local protocol stub. */
function assertSafeBaseUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ProviderError('Live provider base URL is not a valid URL', { retryable: false });
  }
  const local = LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    throw new ProviderError(
      'Live provider base URL must use https (http is allowed only for localhost)',
      { retryable: false },
    );
}

/**
 * OpenAI-compatible / Azure OpenAI chat-completions adapter.
 * Usage and latency are provider-reported / wall-clock (`measured`).
 * Retries are bounded (maxRetries) and only for 429/5xx/network errors.
 */
export class LiveProvider implements Provider {
  readonly id: string;
  readonly mode = 'live' as const;
  private readonly config: LiveProviderConfig;

  constructor(config: LiveProviderConfig) {
    assertSafeBaseUrl(config.baseUrl);
    this.config = config;
    this.id = config.id;
  }

  modelFor(tier: ModelTier): string {
    return this.config.models[tier];
  }

  private async headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    const token = this.config.getToken ? await this.config.getToken() : this.config.apiKey;
    if (!token)
      throw new ProviderError('Live provider has no credentials configured', { retryable: false });
    if (this.config.getToken || this.config.authScheme === 'bearer')
      h.authorization = `Bearer ${token}`;
    else h['api-key'] = token;
    return h;
  }

  async complete(request: CompletionRequest, signal?: AbortSignal): Promise<Completion> {
    const model = this.modelFor(request.tier);
    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map(toWire),
      [this.config.maxTokensParam]: request.maxOutputTokens,
    };
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (request.jsonResponse) body.response_format = { type: 'json_object' };

    const url = `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions${
      this.config.apiVersion ? `?api-version=${encodeURIComponent(this.config.apiVersion)}` : ''
    }`;
    const doFetch = this.config.fetchImpl ?? fetch;
    const started = performance.now();

    for (let attempt = 0; ; attempt += 1) {
      const timeout = AbortSignal.timeout(this.config.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: await this.headers(),
          body: JSON.stringify(body),
          signal: combined,
          // The API key must never follow a redirect to another host.
          redirect: 'error',
        });
        if (!res.ok) {
          const detail = redactSecrets((await res.text()).slice(0, 300)).text;
          const retryable = res.status === 429 || res.status >= 500;
          throw new ProviderError(`Provider returned HTTP ${res.status}: ${detail}`, {
            retryable,
            status: res.status,
          });
        }
        const rawBody = await res.text();
        if (rawBody.length > MAX_RESPONSE_CHARS)
          throw new ProviderError('Provider response exceeded the size limit', {
            retryable: false,
          });
        const json = JSON.parse(rawBody) as OpenAiResponse;
        const message = json.choices?.[0]?.message;
        if (!message)
          throw new ProviderError('Provider response had no choices', { retryable: false });
        const toolCalls: ToolCallRequest[] = (message.tool_calls ?? []).map((c, i) => ({
          id: c.id ?? `call_${i}`,
          name: c.function?.name ?? '',
          args: parseArgs(c.function?.arguments),
        }));
        const usage = json.usage ?? {};
        return {
          text: message.content ?? '',
          toolCalls,
          usage: {
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
            cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
            provenance: 'measured',
          },
          latency: { ms: Math.round(performance.now() - started), provenance: 'measured' },
          model,
          providerId: this.id,
          mode: 'live',
        };
      } catch (err) {
        const retryable =
          err instanceof ProviderError
            ? err.retryable
            : !(err instanceof Error && err.name === 'AbortError' && signal?.aborted);
        if (!retryable || attempt >= this.config.maxRetries) {
          if (err instanceof ProviderError) throw err;
          throw new ProviderError(
            `Provider request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
            {
              retryable: false,
            },
          );
        }
        await sleep(200 * 2 ** attempt);
      }
    }
  }
}

export interface LiveEnv {
  [key: string]: string | undefined;
}

/**
 * Builds a live provider from environment variables, or returns null when none is configured.
 * Live mode is optional: the product is fully usable without it.
 */
export function createLiveProviderFromEnv(env: LiveEnv): LiveProvider | null {
  const kind = env.BIGFORGE_LIVE_PROVIDER;
  if (kind === 'azure-openai') {
    const endpoint = env.AZURE_OPENAI_ENDPOINT;
    const deployment = env.AZURE_OPENAI_DEPLOYMENT;
    if (!endpoint || !deployment) return null;
    const apiKey = env.AZURE_OPENAI_API_KEY;
    const useEntra = env.AZURE_OPENAI_AUTH === 'entra';
    if (!apiKey && !useEntra) return null;
    return new LiveProvider({
      id: 'azure-openai',
      baseUrl: `${endpoint.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(deployment)}`,
      ...(apiKey ? { apiKey } : {}),
      ...(useEntra ? { getToken: entraTokenProvider() } : {}),
      authScheme: 'api-key',
      apiVersion: env.AZURE_OPENAI_API_VERSION ?? '2024-10-21',
      models: {
        large: env.AZURE_OPENAI_DEPLOYMENT_LARGE ?? deployment,
        standard: env.AZURE_OPENAI_DEPLOYMENT_STANDARD ?? deployment,
        small: env.AZURE_OPENAI_DEPLOYMENT_SMALL ?? deployment,
      },
      maxTokensParam: 'max_completion_tokens',
      timeoutMs: 30_000,
      maxRetries: 2,
    });
  }
  if (kind === 'openai-compatible') {
    const baseUrl = env.OPENAI_BASE_URL;
    const apiKey = env.OPENAI_API_KEY;
    const model = env.OPENAI_MODEL;
    if (!baseUrl || !apiKey || !model) return null;
    return new LiveProvider({
      id: 'openai-compatible',
      baseUrl,
      apiKey,
      authScheme: 'bearer',
      models: {
        large: env.OPENAI_MODEL_LARGE ?? model,
        standard: env.OPENAI_MODEL_STANDARD ?? model,
        small: env.OPENAI_MODEL_SMALL ?? model,
      },
      maxTokensParam: 'max_tokens',
      timeoutMs: 30_000,
      maxRetries: 2,
    });
  }
  return null;
}

/**
 * Microsoft Entra (managed identity) token provider. `@azure/identity` is an optional
 * dependency, loaded only when AZURE_OPENAI_AUTH=entra.
 */
function entraTokenProvider(): () => Promise<string> {
  let credential: { getToken(scope: string): Promise<{ token: string } | null> } | undefined;
  return async () => {
    if (!credential) {
      const moduleName = '@azure/identity';
      const mod = (await import(/* @vite-ignore */ moduleName).catch(() => null)) as {
        DefaultAzureCredential: new () => {
          getToken(scope: string): Promise<{ token: string } | null>;
        };
      } | null;
      if (!mod) {
        throw new ProviderError(
          'AZURE_OPENAI_AUTH=entra requires the optional @azure/identity package',
          { retryable: false },
        );
      }
      credential = new mod.DefaultAzureCredential();
    }
    const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
    if (!token) throw new ProviderError('Could not acquire an Entra token', { retryable: false });
    return token.token;
  };
}
