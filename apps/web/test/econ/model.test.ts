import type { EconomicsReport } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  EXECUTIONS_MAX,
  EXECUTIONS_MIN,
  breakEvenAriaLabel,
  cachingSentence,
  clampExecutions,
  costRoi,
  deriveEconomics,
  describeBigforgeIncrement,
  describeVerdict,
  dollarProvenance,
  executionsError,
  explainBreakEvenGap,
  executionsToSlider,
  formatRoi,
  formatRoiRange,
  missingEvidence,
  parseExecutions,
  paybackShare,
  plottedBasisSentence,
  savingBasisInfo,
  sliderToExecutions,
  tokenProvenance,
} from '../../src/pages/economics/model';

/** The numbers of the real seeded `complete` snapshot (demo step 25, 200 projected executions). */
function complete(): EconomicsReport {
  return {
    generatedAt: '2026-11-06T09:59:29.386Z',
    pricing: {
      id: 'forge-sim-demo-2026-11',
      assumedAt: '2026-11-06T00:00:00Z',
      source: 'assumption',
      note: 'Synthetic demo prices for reproducible arithmetic. Not a vendor list price.',
    },
    baseline: {
      samples: 17,
      meanTokens: 34723,
      sdTokens: 5983,
      meanCostUsd: 0.02046,
      meanModelCalls: 10.2,
      meanUncachedTokens: 1211,
      provenance: 'synthetic',
    },
    reuse: {
      liveExecutions: 1,
      shadowExecutions: 12,
      verifiedLive: 1,
      meanTokens: 29,
      meanModelCalls: 0.08,
      meanCostUsd: 0.00003,
      verificationPassRate: 1,
      provenance: 'synthetic',
    },
    perExecution: {
      tokensAvoided: 42531,
      costAvoidedUsd: 0.02225,
      interval: { low: 39687, high: 45375 },
      basis: 'measured_reference',
      provenance: 'synthetic',
    },
    investment: {
      lines: [
        {
          id: 'shadow',
          label: 'Shadow reference runs',
          runs: 13,
          tokens: 457045,
          costUsd: 0.267136,
          provenance: 'synthetic',
          note: '',
          counted: true,
        },
        {
          id: 'canary',
          label: 'Drift canary reference runs',
          runs: 12,
          tokens: 413866,
          costUsd: 0.2444,
          provenance: 'synthetic',
          note: '',
          counted: true,
        },
        {
          id: 'compile',
          label: 'Compilation',
          runs: 1,
          tokens: 0,
          costUsd: 0,
          provenance: 'measured',
          note: '',
          counted: true,
        },
        {
          id: 'replay',
          label: 'Historical replay',
          runs: 22,
          tokens: 0,
          costUsd: 0,
          provenance: 'replay-measured',
          note: '',
          counted: true,
        },
        {
          id: 'review',
          label: 'Human review',
          runs: 1,
          tokens: 0,
          costUsd: 12.5,
          provenance: 'estimated',
          note: 'Assumption: 10 minutes at $75/hour.',
          counted: true,
        },
        {
          id: 'learning',
          label: 'Learning-task baseline runs',
          runs: 5,
          tokens: 176153,
          costUsd: 0.103411,
          provenance: 'synthetic',
          note: '',
          counted: false,
        },
      ],
      totalTokens: 870911,
      totalCostUsd: 0.51154,
      totalCostUsdWithReview: 13.01154,
    },
    realized: {
      avoidedTokens: 42531,
      avoidedCostUsd: 0.02225,
      netTokens: -828380,
      netCostUsd: -12.98928,
      roi: -0.951,
      provenance: 'synthetic',
    },
    projected: {
      executions: 200,
      avoidedTokens: 8506200,
      netTokens: 7635289,
      netCostUsd: -8.5611,
      roi: 8.767,
      roiInterval: { low: 8.11, high: 9.42 },
      breakEvenExecutions: 21,
      provenance: 'estimated',
      assumption: 'Assumes 200 future executions of this task family.',
    },
    crr: {
      value: 0.983,
      verificationPassRate: 1,
      runs: 13,
      provenance: 'replay-measured',
      note: 'Proposed metric. Read it beside the verification pass rate.',
    },
    series: [],
  };
}

function fresh(): EconomicsReport {
  const base = complete();
  return {
    ...base,
    baseline: {
      ...base.baseline,
      samples: 0,
      meanTokens: 0,
      sdTokens: 0,
      meanCostUsd: 0,
      meanUncachedTokens: 0,
      provenance: 'measured',
    },
    reuse: {
      ...base.reuse,
      liveExecutions: 0,
      shadowExecutions: 0,
      verifiedLive: 0,
      meanTokens: 0,
      verificationPassRate: null,
    },
    perExecution: {
      tokensAvoided: 0,
      costAvoidedUsd: 0,
      interval: { low: 0, high: 0 },
      basis: 'none',
      provenance: 'estimated',
    },
    realized: { ...base.realized, avoidedTokens: 0, netCostUsd: -12.5, roi: null },
    projected: {
      ...base.projected,
      avoidedTokens: 0,
      netTokens: 0,
      netCostUsd: -12.5,
      roi: null,
      roiInterval: null,
      breakEvenExecutions: null,
    },
  };
}

describe('projected executions input', () => {
  it('parses what a person types and rejects the rest', () => {
    expect(parseExecutions('1,000')).toBe(1000);
    expect(parseExecutions(' 250 ')).toBe(250);
    expect(parseExecutions('1 000')).toBe(1000);
    expect(parseExecutions('12.5')).toBeNull();
    expect(parseExecutions('-3')).toBeNull();
    expect(parseExecutions('')).toBeNull();
    expect(parseExecutions('1e3')).toBeNull();
  });

  it('bounds the count to 1..100,000 and says so', () => {
    expect(executionsError('200')).toBeNull();
    expect(executionsError('0')).toContain('1 to 100,000');
    expect(executionsError('100001')).toContain('1 to 100,000');
    expect(executionsError('abc')).toContain('whole number');
    expect(clampExecutions(0.4)).toBe(EXECUTIONS_MIN);
    expect(clampExecutions(2e6)).toBe(EXECUTIONS_MAX);
  });

  it('maps a log slider onto the full range and back', () => {
    expect(sliderToExecutions(0)).toBe(1);
    expect(sliderToExecutions(100)).toBe(100_000);
    expect(sliderToExecutions(46)).toBe(200);
    expect(executionsToSlider(1)).toBe(0);
    expect(executionsToSlider(100_000)).toBe(100);
    expect(executionsToSlider(200)).toBe(46);
    for (let position = 0; position <= 100; position += 7) {
      const executions = sliderToExecutions(position);
      expect(Math.abs(executionsToSlider(executions) - position)).toBeLessThanOrEqual(1);
    }
    // a slider position can never produce an out-of-range count
    expect(sliderToExecutions(-5)).toBe(1);
    expect(sliderToExecutions(500)).toBe(100_000);
  });
});

describe('ROI wording', () => {
  it('signs positive and negative ratios and leaves a missing one empty', () => {
    expect(formatRoi(8.767)).toEqual({ text: '+8.8\u00d7', sign: 'positive', words: 'positive' });
    expect(formatRoi(-0.951)).toEqual({
      text: '\u22120.95\u00d7',
      sign: 'negative',
      words: 'negative',
    });
    expect(formatRoi(17.611).text).toBe('+17.6\u00d7');
    expect(formatRoi(0.004)).toMatchObject({ sign: 'zero', words: 'break-even' });
    expect(formatRoi(null)).toEqual({ text: '\u2014', sign: 'none', words: 'not available' });
    expect(formatRoi(Number.NaN).sign).toBe('none');
  });

  it('formats an interval and the share of the investment recovered', () => {
    expect(formatRoiRange({ low: 8.11, high: 9.42 })).toBe('8.1\u00d7 to 9.4\u00d7');
    expect(formatRoiRange(null)).toBeNull();
    expect(paybackShare(-0.951)).toBeCloseTo(0.049, 3);
    expect(paybackShare(-1.4)).toBe(0);
    expect(paybackShare(null)).toBeNull();
  });

  it('applies the ROI formula to dollars and refuses to divide by nothing', () => {
    expect(costRoi(-8.5611, 13.01154)).toBe(-0.658);
    expect(costRoi(5, 0)).toBeNull();
  });
});

describe('derived economics (from the report only)', () => {
  const report = complete();
  const derived = deriveEconomics(report);

  it('derives a negative dollar ROI beside a positive token ROI', () => {
    expect(derived.tokens.projectedRoi).toBe(8.767);
    expect(derived.dollars.projectedRoi).toBe(-0.658);
    expect(derived.dollars.realizedRoi).toBe(-0.998);
    expect(derived.dollars.projectedAvoided).toBeCloseTo(4.4504, 3);
  });

  it('shows that the assumed review time drives the dollar result', () => {
    expect(derived.dollars.review).toBe(12.5);
    expect(derived.dollars.reviewShare).toBeCloseTo(0.961, 3);
    expect(derived.dollars.projectedRoiWithoutReview).toBeGreaterThan(7);
    expect(derived.dollars.breakEven).toBe(585);
  });

  it('describes the prompt-cache effect with the report numbers', () => {
    expect(derived.caching.hitShare).toBeCloseTo(0.965, 3);
    expect(derived.caching.usdPerMillionTokens).toBeCloseTo(0.589, 2);
    expect(cachingSentence(report, derived)).toContain('96.5%');
  });

  it('notices when the saving is not simply the difference of the means', () => {
    expect(derived.meansGap.differs).toBe(true);
    expect(derived.meansGap.differenceOfMeans).toBe(34694);
  });

  it('counts the review line only when it is counted', () => {
    const noReview = complete();
    noReview.investment.lines = noReview.investment.lines.map((line) =>
      line.id === 'review' ? { ...line, counted: false } : line,
    );
    expect(deriveEconomics(noReview).dollars.review).toBe(0);
  });

  it('labels every component of a composite figure', () => {
    expect(new Set(tokenProvenance(report))).toEqual(new Set(['estimated', 'synthetic']));
    expect(new Set(dollarProvenance(report))).toEqual(new Set(['estimated', 'synthetic']));
  });
});

describe('verdict', () => {
  it('says tokens pay back and dollars do not, with the break-even and the realized shortfall', () => {
    const report = complete();
    const verdict = describeVerdict(report, deriveEconomics(report));
    expect(verdict.kind).toBe('tokens_only');
    expect(verdict.headline).toBe('Worth it in tokens. Not yet in dollars.');
    const [projection, dollars, realized] = verdict.facts;
    expect(projection?.text).toContain('+8.8\u00d7');
    expect(projection?.text).toContain('8.1\u00d7 to 9.4\u00d7');
    expect(projection?.text).toContain('after 21 executions');
    expect(dollars?.text).toContain('\u22120.66\u00d7');
    expect(dollars?.text).toContain('$12.50');
    expect(dollars?.text).toContain('96%');
    expect(realized?.text).toContain('1 live execution');
    expect(realized?.text).toContain('\u22120.95\u00d7');
    expect(realized?.text).toContain('not a forecast');
  });

  it('is worth it in both when dollars also turn positive', () => {
    const report = complete();
    report.investment.lines = report.investment.lines.map((line) =>
      line.id === 'review' ? { ...line, costUsd: 0.25 } : line,
    );
    report.investment.totalCostUsdWithReview = 0.76154;
    report.projected.netCostUsd = 3.68886;
    expect(describeVerdict(report, deriveEconomics(report)).kind).toBe('both');
  });

  it('says so when the investment cannot be recovered in the projected volume', () => {
    const report = complete();
    report.projected.breakEvenExecutions = 500;
    const verdict = describeVerdict(report, deriveEconomics(report));
    expect(verdict.facts[0]?.text).toContain('more than the 200 projected');
  });

  it('refuses to judge an empty report and says what is missing', () => {
    const report = fresh();
    const derived = deriveEconomics(report);
    expect(derived.empty).toBe(true);
    expect(describeVerdict(report, derived)).toEqual({
      kind: 'empty',
      headline: 'Nothing to judge yet.',
      facts: [],
    });
    const missing = missingEvidence(report);
    expect(missing).toHaveLength(3);
    expect(missing[0]?.produced).toContain('Demo steps 2 and 4');
    expect(missing[1]?.produced).toContain('Demo steps 9 and 10');
    expect(missing[2]?.produced).toContain('Demo step 14');
  });

  it('shows no realized ROI before a live execution, whatever the report carries', () => {
    const report = complete();
    report.reuse.liveExecutions = 0;
    report.perExecution.basis = 'shadow_estimate';
    report.realized.roi = -1;
    const derived = deriveEconomics(report);
    expect(derived.tokens.realizedRoi).toBeNull();
    expect(derived.tokens.realizedPayback).toBeNull();
    expect(derived.dollars.realizedRoi).toBeNull();
    expect(derived.tokens.projectedRoi).toBe(8.767);
  });

  it('asks only for the live execution once shadow evidence exists', () => {
    const report = complete();
    report.reuse.liveExecutions = 0;
    report.perExecution.basis = 'shadow_estimate';
    const verdict = describeVerdict(report, deriveEconomics(report));
    expect(verdict.facts[2]?.text).toContain('No live execution yet');
    expect(missingEvidence(report)).toHaveLength(1);
  });
});

describe('basis wording', () => {
  it('states every basis in plain words and marks the estimates', () => {
    expect(savingBasisInfo('measured_reference').tone).toBe('steel');
    expect(savingBasisInfo('counterfactual_estimate').words).toContain('estimate');
    expect(savingBasisInfo('shadow_estimate').tone).toBe('amber');
    expect(savingBasisInfo('none').tone).toBe('ash');
  });
});

describe('break-even chart wording follows the plotted series', () => {
  /** What `series` gives on the real snapshot: the measured execution's baseline and Reflex tokens, per execution. */
  const plotted = { baseline: 42_902, bigforge: 371 };

  it('describes the BigForge line from its increment, not from the Reflex mean tokens', () => {
    expect(describeBigforgeIncrement(0)).toBe('and then stays flat');
    expect(describeBigforgeIncrement(0.4)).toBe('and then stays flat');
    expect(describeBigforgeIncrement(4_723.4)).toBe('and then adds 4,723 tokens per execution');
    expect(describeBigforgeIncrement(1)).toBe('and then adds 1 token per execution');
    expect(describeBigforgeIncrement(null)).toBe('and continues');
  });

  it('labels the chart with the plotted increments and the crossing rounded up', () => {
    const report = complete();
    const label = breakEvenAriaLabel(report, 20.477, 200, plotted);
    expect(label).toContain('the baseline rises by 42,902 tokens per execution');
    expect(label).toContain('870,911-token investment and then adds 371 tokens per execution');
    expect(label).toContain('cross at about 21 executions');
    // the all-sample mean (34,723) and the Reflex mean (29) describe other things than the plotted lines
    expect(label).not.toContain('34,723');
    const flat = breakEvenAriaLabel(report, 20.477, 200, { baseline: 42_902, bigforge: 0 });
    expect(flat).toContain('and then stays flat');
    const unknown = breakEvenAriaLabel(report, null, 50, null);
    expect(unknown).toContain('the baseline rises with every execution');
    expect(unknown).toContain('and continues');
    expect(unknown).toContain('do not cross within the visible range');
  });

  it('explains once what the plotted lines are made of', () => {
    expect(plottedBasisSentence(complete(), plotted)).toBe(
      'Both lines use the same measured executions as the headline saving (1 execution: the baseline spent 42,902 tokens where the Reflex spent 371); the mean over all 17 baseline samples (34,723 tokens) is in the saving panel.',
    );
  });

  it('words the basis sentence for several executions, estimates and the shadow-only case', () => {
    const several = complete();
    several.reuse.verifiedLive = 3;
    expect(plottedBasisSentence(several, plotted)).toContain(
      '(3 executions: the baseline averaged 42,902 tokens where the Reflex averaged 371)',
    );

    const estimate = complete();
    estimate.perExecution.basis = 'counterfactual_estimate';
    const estimated = plottedBasisSentence(estimate, plotted);
    expect(estimated).toContain('live executions (the baseline estimated where no reference ran)');
    expect(estimated).not.toContain('measured executions');

    const shadow = complete();
    shadow.perExecution.basis = 'shadow_estimate';
    shadow.reuse.verifiedLive = 0;
    const shadowText = plottedBasisSentence(shadow, { baseline: 34_723, bigforge: 29 });
    expect(shadowText).toContain('no live execution yet');
    expect(shadowText).toContain('34,723 baseline tokens against 29 through the Reflex');
    expect(shadowText).toContain('shadow estimate');

    const none = complete();
    none.perExecution.basis = 'none';
    expect(plottedBasisSentence(none, null)).toBe('');
    // without increments the sentence still says which executions the lines use
    expect(plottedBasisSentence(complete(), null)).toBe(
      'Both lines use the same measured executions as the headline saving (1 execution); the mean over all 17 baseline samples (34,723 tokens) is in the saving panel.',
    );
  });

  it('says nothing when the plotted crossing and the report agree', () => {
    const report = complete();
    expect(
      explainBreakEvenGap(report, { differs: false, crossing: 20.48, reported: 21 }),
    ).toBeNull();
    expect(explainBreakEvenGap(report, { differs: true, crossing: null, reported: 21 })).toBeNull();
    expect(explainBreakEvenGap(report, { differs: true, crossing: 25, reported: null })).toBeNull();
  });

  it('only when the two really differ by more than the rounding does it call them two estimates', () => {
    const text = explainBreakEvenGap(complete(), { differs: true, crossing: 24.2, reported: 21 });
    expect(text).toContain('The report says 21');
    expect(text).toContain(
      'the investment divided by the per-execution saving (42,531 tokens, measured reference), rounded up',
    );
    expect(text).toContain('cross at about 25');
    expect(text).toContain('more than that rounding explains');
    expect(text).toContain('Treat them as two estimates');
    // no claims about why: the plotted lines normally share the saving's basis
    expect(text).not.toContain('below flat');
    expect(text).not.toContain('34,723');
  });
});
