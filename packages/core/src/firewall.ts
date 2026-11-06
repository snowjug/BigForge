import { estimateTokens } from '@bigforge/providers';
import type {
  CallRecord,
  EvidenceChunk,
  EvidenceScreening,
  FirewallCheck,
  FirewallDecision,
  FirewallVerdict,
  ModelTier,
  RejectedEvidence,
  BoundarySpec,
} from '@bigforge/schemas';
import {
  contentHash,
  redactSecrets,
  screenForInstructions,
  stripInstructionLines,
} from '@bigforge/security';

const TIER_RANK: Record<ModelTier, number> = { small: 0, standard: 1, large: 2 };
const TIER_ORDER: ModelTier[] = ['small', 'standard', 'large'];
export const PROMPT_OVERHEAD_TOKENS = 160;

export interface FirewallPolicy {
  /** Tier an unconstrained agent would use. A boundary needing less is routed to a smaller model. */
  defaultTier: ModelTier;
  maxCallsPerRun: number;
  /** Evidence is "reduced" when the selected share of considered tokens is at or below this. */
  reduceThreshold: number;
  costCapUsd: number;
  protectedEnvironment: boolean;
  estimateCostUsd: (tier: ModelTier, inputTokens: number, outputTokens: number) => number;
}

export const DEFAULT_FIREWALL_POLICY: Omit<FirewallPolicy, 'estimateCostUsd'> = {
  defaultTier: 'large',
  maxCallsPerRun: 3,
  reduceThreshold: 0.8,
  costCapUsd: 0.25,
  protectedEnvironment: false,
};

export interface FirewallRequest {
  stepId: string;
  question: string;
  options: { id: string; label: string; detail: string }[];
  boundary: BoundarySpec;
  /** Everything the run has observed. The firewall decides what a call may carry. */
  pool: EvidenceChunk[];
  whyNotReflex: string;
  callsMade: number;
  priorCallHashes: string[];
  previousAttempt?: { tier: ModelTier; verified: boolean };
  sensitive?: boolean;
  callId: string;
}

export interface FirewallOutcome {
  record: CallRecord;
  decision: FirewallDecision;
  /** Sanitised evidence that may be sent (empty unless the verdict is ALLOW). */
  evidence: EvidenceChunk[];
  callHash: string;
}

/**
 * Token Firewall: no unexplained model calls.
 * Answers the seven call-record questions, selects the minimum relevant evidence,
 * screens it, and returns one verdict. Deterministic and side-effect free.
 */
export class TokenFirewall {
  private readonly policy: FirewallPolicy;

  constructor(policy: FirewallPolicy) {
    this.policy = policy;
  }

  evaluate(req: FirewallRequest): FirewallOutcome {
    const { boundary } = req;
    const screening: EvidenceScreening[] = [];
    const sanitised: EvidenceChunk[] = req.pool.map((chunk) => {
      let text = chunk.text;
      let finding: EvidenceScreening['finding'] = 'clean';
      let detail = 'no findings';
      const injected = screenForInstructions(text);
      if (injected.length > 0) {
        const stripped = stripInstructionLines(text);
        text = stripped.text;
        finding = 'instruction_like';
        detail = `treated as data; ${stripped.removed} instruction-like line(s) withheld (${injected.map((f) => f.rule).join(', ')})`;
      }
      const redacted = redactSecrets(text);
      if (redacted.count > 0) {
        text = redacted.text;
        if (finding === 'clean') {
          finding = 'redacted';
          detail = `${redacted.count} secret(s) redacted (${redacted.kinds.join(', ')})`;
        }
      }
      screening.push({ chunkId: chunk.id, finding, detail });
      return text === chunk.text ? chunk : { ...chunk, text, tokens: estimateTokens(text) };
    });

    const considered = sanitised;
    const tokensConsidered = considered.reduce((n, c) => n + c.tokens, 0);

    // Select the minimum evidence: only chunks a selector asks for.
    const selectedIds = new Set<string>();
    const reasonFor = new Map<string, string>();
    const protectedIds = new Set<string>();
    const missingRequired: string[] = [];
    for (const selector of boundary.evidenceSelectors) {
      const matches = considered.filter((c) => c.tags.some((t) => selector.tags.includes(t)));
      if (matches.length === 0 && selector.required) missingRequired.push(selector.id);
      for (const c of matches) {
        selectedIds.add(c.id);
        reasonFor.set(c.id, `satisfies selector "${selector.id}"`);
        if (selector.required) protectedIds.add(c.id);
      }
    }

    const optionTokens = estimateTokens(
      req.options.map((o) => `${o.id} ${o.label} ${o.detail}`).join('\n'),
    );
    const available = boundary.budgetTokens - PROMPT_OVERHEAD_TOKENS - optionTokens;
    const rejected: RejectedEvidence[] = [];
    let selected = considered.filter((c) => selectedIds.has(c.id));
    let selectedTokens = selected.reduce((n, c) => n + c.tokens, 0);
    // Trim optional evidence, largest first, until the call fits its budget.
    const droppable = selected
      .filter((c) => !protectedIds.has(c.id))
      .sort((a, b) => b.tokens - a.tokens);
    while (selectedTokens > available && droppable.length > 0) {
      const drop = droppable.shift();
      if (!drop) break;
      selectedIds.delete(drop.id);
      rejected.push({
        chunkId: drop.id,
        source: drop.source,
        tokens: drop.tokens,
        reason: 'dropped to fit the token budget (optional evidence)',
      });
      selected = selected.filter((c) => c.id !== drop.id);
      selectedTokens -= drop.tokens;
    }
    for (const c of considered) {
      if (!selectedIds.has(c.id) && !rejected.some((r) => r.chunkId === c.id)) {
        rejected.push({
          chunkId: c.id,
          source: c.source,
          tokens: c.tokens,
          reason: `not needed by the open question (tags: ${c.tags.join(', ') || 'none'})`,
        });
      }
    }

    const record: CallRecord = {
      id: req.callId,
      stepId: req.stepId,
      unknown: req.question,
      whyNotReflex: req.whyNotReflex,
      minimumContext: selected.map((c) => ({
        chunkId: c.id,
        reason: reasonFor.get(c.id) ?? 'selected',
      })),
      capability: boundary.minCapability,
      maxBudgetTokens: boundary.budgetTokens,
      evidenceRequired: boundary.evidenceRequired,
      verifyBy: boundary.verifyBy,
      options: req.options,
    };

    const callHash = contentHash({
      q: req.question,
      o: req.options.map((o) => o.id),
      e: selected.map((c) => c.text),
    });

    const path: FirewallVerdict[] = [];
    const reasons: string[] = [];
    let verdict: FirewallVerdict = 'ALLOW';
    let tier: ModelTier = boundary.minCapability;

    const fail = (v: FirewallVerdict, reason: string) => {
      verdict = v;
      reasons.push(reason);
    };

    const explained =
      req.question.trim().length > 0 &&
      req.whyNotReflex.trim().length > 0 &&
      boundary.evidenceRequired.trim().length > 0 &&
      boundary.verifyBy.trim().length > 0;

    if (!explained) {
      fail(
        'DENY',
        'The call record is incomplete: every one of the seven questions must be answered',
      );
    } else if (missingRequired.length > 0) {
      fail('DENY', `Required evidence is unavailable: ${missingRequired.join(', ')}`);
    } else if (req.priorCallHashes.includes(callHash)) {
      fail(
        'DENY',
        'Duplicate call: an identical question with identical evidence was already answered in this run',
      );
    } else if (req.callsMade >= this.policy.maxCallsPerRun) {
      fail(
        'DENY',
        `Call budget exhausted: ${req.callsMade} of ${this.policy.maxCallsPerRun} calls already made`,
      );
    } else if (req.options.length <= 1) {
      fail(
        'USE_EXISTING_REFLEX',
        'Only one viable option remains; the Reflex can proceed without a model',
      );
    } else if (selectedTokens > available) {
      fail(
        'DENY',
        `Required evidence (${selectedTokens} tokens) exceeds the budget (${available} tokens available)`,
      );
    } else if (req.previousAttempt && !req.previousAttempt.verified) {
      const next = TIER_ORDER[TIER_RANK[req.previousAttempt.tier] + 1];
      if (next) {
        tier = next;
        fail(
          'ESCALATE',
          `A cheaper attempt failed verification; escalating from ${req.previousAttempt.tier} to ${next}`,
        );
      } else {
        fail(
          'REQUEST_HUMAN_APPROVAL',
          'The strongest model already failed verification; a person must decide',
        );
      }
    } else {
      if (
        tokensConsidered > 0 &&
        selectedTokens / tokensConsidered <= this.policy.reduceThreshold
      ) {
        path.push('REDUCE_CONTEXT');
        reasons.push(
          `Context reduced from ${tokensConsidered} to ${selectedTokens} tokens (${considered.length - selected.length} chunks withheld)`,
        );
      }
      if (TIER_RANK[boundary.minCapability] < TIER_RANK[this.policy.defaultTier]) {
        path.push('USE_SMALLER_MODEL');
        reasons.push(
          `The open question needs "${boundary.minCapability}" capability; routing there instead of "${this.policy.defaultTier}"`,
        );
      }
      const projected = selectedTokens + optionTokens + PROMPT_OVERHEAD_TOKENS;
      const cost = this.policy.estimateCostUsd(
        tier,
        projected,
        Math.min(300, boundary.budgetTokens),
      );
      if (req.sensitive || this.policy.protectedEnvironment || cost > this.policy.costCapUsd) {
        fail(
          'REQUEST_HUMAN_APPROVAL',
          req.sensitive
            ? 'The call touches sensitive data'
            : this.policy.protectedEnvironment
              ? 'The environment is protected'
              : `Estimated cost $${cost.toFixed(4)} exceeds the cap $${this.policy.costCapUsd}`,
        );
      } else {
        reasons.push('The call is justified, minimal and within budget');
      }
    }

    if (verdict === 'ALLOW') path.push('ALLOW');
    else path.push(verdict);

    const checks: FirewallCheck[] = [
      {
        id: 'unknown',
        question: 'What remains unknown?',
        passed: req.question.trim().length > 0,
        detail: req.question,
      },
      {
        id: 'why_not_reflex',
        question: "Why can't an existing Reflex handle it?",
        passed: req.whyNotReflex.trim().length > 0,
        detail: req.whyNotReflex,
      },
      {
        id: 'minimum_context',
        question: 'What minimum context is required?',
        passed: missingRequired.length === 0 && selected.length > 0,
        detail: `${selected.length} of ${considered.length} chunks (${selectedTokens} of ${tokensConsidered} tokens)`,
      },
      {
        id: 'capability',
        question: 'Which model capability is necessary?',
        passed: true,
        detail: `${boundary.minCapability} (routed to ${tier})`,
      },
      {
        id: 'budget',
        question: 'What is the maximum permitted token budget?',
        passed: selectedTokens <= available,
        detail: `${boundary.budgetTokens} tokens (evidence ${selectedTokens}, options ${optionTokens}, overhead ${PROMPT_OVERHEAD_TOKENS})`,
      },
      {
        id: 'evidence_back',
        question: 'What evidence must come back?',
        passed: boundary.evidenceRequired.trim().length > 0,
        detail: boundary.evidenceRequired,
      },
      {
        id: 'verify',
        question: 'How will the result be verified?',
        passed: boundary.verifyBy.trim().length > 0,
        detail: boundary.verifyBy,
      },
    ];

    const decision: FirewallDecision = {
      verdict,
      path,
      reasons,
      checks,
      tier,
      budgetTokens: boundary.budgetTokens,
      considered,
      selected,
      rejected,
      screening,
      tokensConsidered,
      tokensSelected: selectedTokens,
    };
    return { record, decision, evidence: verdict === 'ALLOW' ? selected : [], callHash };
  }
}
