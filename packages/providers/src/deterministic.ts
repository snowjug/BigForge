import type { ModelTier } from '@bigforge/schemas';
import { estimateTokens } from './tokens';
import type {
  ChatMessage,
  Completion,
  CompletionRequest,
  DeterministicPolicy,
  Provider,
  ToolCallRequest,
} from './types';

export const DETERMINISTIC_PROVIDER_ID = 'bigforge-deterministic';

const MODELS: Record<ModelTier, string> = {
  small: 'forge-sim-small',
  standard: 'forge-sim-standard',
  large: 'forge-sim-large',
};

const PER_MESSAGE_OVERHEAD_TOKENS = 4;

function messageTokens(m: ChatMessage): number {
  const calls = m.toolCalls
    ? estimateTokens(JSON.stringify(m.toolCalls.map((c) => [c.name, c.args])))
    : 0;
  return estimateTokens(m.content) + calls + PER_MESSAGE_OVERHEAD_TOKENS;
}

function sameMessage(a: ChatMessage, b: ChatMessage): boolean {
  return (
    a.role === b.role &&
    a.content === b.content &&
    JSON.stringify(a.toolCalls ?? null) === JSON.stringify(b.toolCalls ?? null)
  );
}

export interface SimulatedLatencyModel {
  baseMs: number;
  perUncachedInputTokenMs: number;
  perCachedInputTokenMs: number;
  perOutputTokenMs: number;
}

export const DEFAULT_LATENCY_MODEL: SimulatedLatencyModel = {
  baseMs: 250,
  perUncachedInputTokenMs: 0.28,
  perCachedInputTokenMs: 0.06,
  perOutputTokenMs: 14,
};

/**
 * Offline stand-in for a model. A scripted policy answers; token counts are computed
 * deterministically from the conversation (labelled `synthetic`), latency from a documented
 * model (labelled `simulated`), and prompt-cache reuse from the shared message prefix
 * between consecutive requests with the same cache key (labelled `synthetic`).
 *
 * It is never a live model call and must never be presented as one.
 */
export class DeterministicProvider implements Provider {
  readonly id = DETERMINISTIC_PROVIDER_ID;
  readonly mode = 'deterministic' as const;
  private readonly policies: Map<string, DeterministicPolicy>;
  private readonly lastPrefix = new Map<string, ChatMessage[]>();
  private readonly latencyModel: SimulatedLatencyModel;
  private callCount = 0;

  constructor(
    policies: DeterministicPolicy[],
    latencyModel: SimulatedLatencyModel = DEFAULT_LATENCY_MODEL,
  ) {
    this.policies = new Map(policies.map((p) => [p.id, p]));
    this.latencyModel = latencyModel;
  }

  get calls(): number {
    return this.callCount;
  }

  modelFor(tier: ModelTier): string {
    return MODELS[tier];
  }

  complete(request: CompletionRequest): Promise<Completion> {
    const policyId = request.policy;
    const policy = policyId ? this.policies.get(policyId) : undefined;
    if (!policy) {
      return Promise.reject(new Error(`Deterministic provider has no policy "${policyId ?? ''}"`));
    }
    this.callCount += 1;
    const turn = policy.respond(request);
    const toolCalls: ToolCallRequest[] = turn.toolCalls ?? [];

    const toolSpecTokens = request.tools ? estimateTokens(JSON.stringify(request.tools)) : 0;
    const perMessage = request.messages.map(messageTokens);
    const inputTokens = perMessage.reduce((a, b) => a + b, 0) + toolSpecTokens;

    let cachedInputTokens = 0;
    const key = request.cacheKey;
    if (key) {
      const previous = this.lastPrefix.get(key) ?? [];
      let shared = 0;
      while (shared < previous.length && shared < request.messages.length) {
        const a = previous[shared];
        const b = request.messages[shared];
        if (!a || !b || !sameMessage(a, b)) break;
        shared += 1;
      }
      cachedInputTokens =
        perMessage.slice(0, shared).reduce((a, b) => a + b, 0) + (shared > 0 ? toolSpecTokens : 0);
      this.lastPrefix.set(key, request.messages);
    }

    const outputTokens = Math.min(
      request.maxOutputTokens,
      estimateTokens(turn.text) +
        estimateTokens(JSON.stringify(toolCalls.map((c) => [c.name, c.args]))),
    );
    const uncached = Math.max(0, inputTokens - cachedInputTokens);
    const m = this.latencyModel;
    const latencyMs = Math.round(
      m.baseMs +
        uncached * m.perUncachedInputTokenMs +
        cachedInputTokens * m.perCachedInputTokenMs +
        outputTokens * m.perOutputTokenMs,
    );

    return Promise.resolve({
      text: turn.text,
      toolCalls,
      ...(turn.purpose !== undefined ? { purpose: turn.purpose } : {}),
      usage: { inputTokens, outputTokens, cachedInputTokens, provenance: 'synthetic' },
      latency: { ms: latencyMs, provenance: 'simulated' },
      model: MODELS[request.tier],
      providerId: this.id,
      mode: 'deterministic',
    });
  }
}
