import type { ModelTier, TokenUsage, Latency } from '@bigforge/schemas';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Assistant messages: tool calls requested. Tool messages: id of the call answered. */
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
  name?: string;
  /** Harness metadata (never sent to live providers): semantic label of the turn. */
  purpose?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxOutputTokens: number;
  tier: ModelTier;
  /** Deterministic provider: which scripted policy answers. Live providers ignore it. */
  policy?: string;
  /** Requests with the same key share a (simulated) prompt-cache prefix. */
  cacheKey?: string;
  /** Ask live providers for a JSON object response. */
  jsonResponse?: boolean;
}

export interface Completion {
  text: string;
  toolCalls: ToolCallRequest[];
  purpose?: string;
  usage: TokenUsage;
  latency: Latency;
  model: string;
  providerId: string;
  mode: 'deterministic' | 'live';
}

export interface Provider {
  readonly id: string;
  readonly mode: 'deterministic' | 'live';
  modelFor(tier: ModelTier): string;
  complete(request: CompletionRequest, signal?: AbortSignal): Promise<Completion>;
}

export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(message: string, options: { retryable: boolean; status?: number | null }) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}

export interface PolicyTurn {
  text: string;
  toolCalls?: ToolCallRequest[];
  purpose?: string;
}

/** A scripted stand-in for a model. Pure function of the conversation. */
export interface DeterministicPolicy {
  id: string;
  respond(request: CompletionRequest): PolicyTurn;
}
