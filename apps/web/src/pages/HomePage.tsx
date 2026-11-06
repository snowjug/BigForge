import { FastForward, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { ReflexStatus } from '@bigforge/schemas';
import { errorMessage } from '../api/client';
import {
  useDemoState,
  useDrift,
  useEconomics,
  useFamilies,
  useReflexes,
  useRuns,
  useSystem,
} from '../api/hooks';
import { useAuth } from '../auth/useAuth';
import { JobProgress } from '../demo/PresenterBar';
import { ResetDemo } from '../demo/ResetDemo';
import { PROMOTE_STEP, groupScenes, seedBlockedReason } from '../demo/scenes';
import { useDemo } from '../demo/useDemo';
import { runPath, tracesPath } from '../routes';
import { FORGE_STAGES } from '../stages';
import {
  Button,
  ButtonLink,
  ErrorState,
  Metric,
  Page,
  Popover,
  Provenance,
  Skeleton,
  Sparkline,
  formatMultiple,
  formatPct,
  formatTokens,
  formatUsd,
  plural,
} from '../ui';
import { describeForge } from './forgeState';
import '../styles/home.css';

const hasNumber = (value: number | null | undefined): value is number => typeof value === 'number';

const SCENE_STORY: Record<string, string> = {
  'Cold start': 'No Reflex exists. The AI does everything and BigForge watches.',
  Learning: 'Variants of one failure reveal what repeats, and what never changes.',
  Validation: 'Replay, then Shadow Brain beside the AI, then a human decides.',
  'The killer moment': 'Known steps run locally. One decision crosses the Token Firewall.',
  Drift: 'The tool changes, the canary notices, trust expires.',
};

const FAST_FORWARD = [
  { stage: 'learned', label: 'Learned', detail: 'Family found, candidate compiled (step 7)' },
  { stage: 'validated', label: 'Validated', detail: 'Replay and Shadow Brain done (step 10)' },
  { stage: 'promoted', label: 'Promoted', detail: 'A simulated reviewer promotes it (step 11)' },
  { stage: 'killer', label: 'Killer moment', detail: 'Held-out task through the Reflex (step 20)' },
  { stage: 'drifted', label: 'Drifted', detail: 'Environment change and canary (step 24)' },
  { stage: 'complete', label: 'Complete', detail: 'Mutation proposed (step 25)' },
] as const;

function FastForwardMenu() {
  const demo = useDemo();
  const auth = useAuth();
  const access = {
    canRun: auth.can('run_task'),
    canPromote: auth.can('promote'),
    promotionDone: demo.state?.completed.includes(PROMOTE_STEP) ?? false,
  };
  const menuBlocked = seedBlockedReason('learned', access);
  return (
    <Popover
      label="Fast-forward the demo"
      side="bottom"
      align="start"
      className="home-confirm"
      content={({ close }) => (
        <div className="stack" style={{ '--gap': '10px' } as CSSProperties}>
          <p className="dim">
            Runs the real steps up to a stage. The human promotion is performed by a{' '}
            <strong>simulated reviewer</strong>, not a human decision.
          </p>
          <ul className="home-ff">
            {FAST_FORWARD.map((entry) => {
              const blocked = seedBlockedReason(entry.stage, access);
              return (
                <li key={entry.stage}>
                  <button
                    type="button"
                    className="home-ff__item"
                    data-testid={`fast-forward-${entry.stage}`}
                    disabled={demo.busy || blocked !== null}
                    onClick={() => {
                      close();
                      void demo.start();
                      void demo.seed(entry.stage);
                    }}
                  >
                    <span className="home-ff__label">{entry.label}</span>
                    <span className="home-ff__detail">{blocked ?? entry.detail}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    >
      <Button
        icon={<FastForward size={15} />}
        disabled={menuBlocked !== null}
        data-testid="fast-forward"
        {...(menuBlocked !== null ? { disabledReason: menuBlocked } : {})}
      >
        Fast-forward
      </Button>
    </Popover>
  );
}

function Hero({ headline, detail }: { headline: string; detail: string }) {
  const demo = useDemo();
  const system = useSystem();
  const resume = demo.state !== undefined && (demo.step > 1 || demo.state.completed.length > 0);
  const done = demo.state?.completed.length ?? 0;
  return (
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-hero__copy">
        <p className="micro">Forge Floor</p>
        <h1 id="home-title" className="home-hero__title">
          Forge reasoning once.
          <span>Reuse it without paying to rethink it.</span>
        </h1>
        <p className="home-hero__lede">
          BigForge learns executable <strong>Reflexes</strong> from repeated agent traces, validates
          them against the AI, has a human promote them, and calls a model only at the edge of
          uncertainty, through a Token Firewall.
        </p>
        {demo.available ? (
          <div className="home-hero__actions">
            <Button
              variant="forge"
              size="lg"
              icon={<Play size={16} />}
              loading={!demo.state && demo.isLoading}
              data-testid="start-demo"
              onClick={() => {
                void demo.start();
              }}
            >
              {resume ? `Continue demo · step ${demo.step}` : 'Start guided demo'}
            </Button>
            {resume ? (
              <Button
                icon={<RotateCcw size={15} />}
                disabled={demo.busy}
                data-testid="restart-demo"
                onClick={() => {
                  void demo.start(1);
                }}
              >
                Restart at step 1
              </Button>
            ) : null}
            <FastForwardMenu />
            <ResetDemo size="md" />
          </div>
        ) : (
          <div className="home-hero__actions">
            <ButtonLink variant="forge" size="lg" icon={<Play size={16} />} to={runPath()}>
              Open the Run Console
            </ButtonLink>
            <ButtonLink to={tracesPath()}>Browse traces</ButtonLink>
          </div>
        )}
        <JobProgress />
        {demo.error ? (
          <p className="home-hero__error" role="alert">
            <TriangleAlert size={14} aria-hidden="true" /> {errorMessage(demo.error)}
          </p>
        ) : null}
        <p className="home-hero__honesty">
          {system.data
            ? `${system.data.provider.label}. ${system.data.claims.note}`
            : 'Runs offline against a deterministic provider.'}
        </p>
      </div>

      <aside className="home-now" aria-label="Where the forge is right now">
        <p className="micro">Where the forge is right now</p>
        <p className="home-now__headline">{headline}</p>
        <p className="home-now__detail">{detail}</p>
        {demo.available && demo.state ? (
          <div className="home-now__demo">
            <div className="home-now__demo-head">
              <span className="micro">Guided demo</span>
              <span className="num">
                {done} of {demo.total} steps done
              </span>
            </div>
            <div className="home-now__bar" aria-hidden="true">
              <span style={{ width: `${(done / demo.total) * 100}%` }} />
            </div>
          </div>
        ) : null}
      </aside>
    </section>
  );
}

function ForgeLine({ hot }: { hot: string | null }) {
  const reflexes = useReflexes();
  const families = useFamilies();
  const runs = useRuns({ limit: 1 });
  const economics = useEconomics();
  const drift = useDrift();

  const versions = (reflexes.data?.reflexes ?? []).flatMap((reflex) => reflex.versions);
  const inValidation = versions.filter((version) =>
    (['candidate', 'replay', 'shadow', 'approval'] satisfies ReflexStatus[]).includes(
      version.status as 'candidate' | 'replay' | 'shadow' | 'approval',
    ),
  ).length;
  const e = economics.data;
  const live = e?.reuse.liveExecutions ?? 0;
  const shadowRuns = e?.reuse.shadowExecutions ?? 0;
  const matcher = families.data?.matcher ?? null;
  const noun = (count: number | undefined, singular: string, pluralForm = `${singular}s`) =>
    count === 1 ? singular : pluralForm;
  const familyCount = families.data?.families.length;

  const cells: Record<string, { value: string | null; caption: string; loading: boolean }> = {
    observe: {
      value: formatTokens(runs.data?.total),
      caption: `${noun(runs.data?.total, 'trace')} recorded`,
      loading: runs.isPending,
    },
    fingerprint: {
      value: formatTokens(familyCount),
      caption: matcher
        ? `${noun(familyCount, 'task family', 'task families')}, false-match rate ${formatPct(matcher.falseMatchRate)}`
        : noun(familyCount, 'task family', 'task families'),
      loading: families.isPending,
    },
    compile: {
      value: formatTokens(versions.length),
      caption: noun(versions.length, 'Reflex version'),
      loading: reflexes.isPending,
    },
    validate: {
      value: formatTokens(inValidation),
      caption: 'in validation',
      loading: reflexes.isPending,
    },
    execute: {
      value: formatTokens(live),
      caption:
        shadowRuns > 0
          ? `${noun(live, 'live execution')}, ${shadowRuns} shadow`
          : noun(live, 'live execution'),
      loading: economics.isPending,
    },
    escalate: {
      value:
        live + shadowRuns > 0 && e
          ? (Math.round(e.reuse.meanModelCalls * 10) / 10).toString()
          : '\u2014',
      caption: live + shadowRuns > 0 ? 'model calls per Reflex run' : 'no boundary crossed yet',
      loading: economics.isPending,
    },
    evolve: {
      value: formatTokens(drift.data?.checks.length),
      caption: plural(drift.data?.mutations.length ?? 0, 'mutation') + ' proposed',
      loading: drift.isPending,
    },
  };

  return (
    <section className="home-line-wrap" aria-labelledby="line-title">
      <header className="home-section-head">
        <h2 id="line-title" className="home-section-head__title">
          The loop, with what is in it
        </h2>
        <p className="home-section-head__note">
          <Provenance kind={['measured', 'synthetic']} /> Counts are read from this tenant’s
          records; model calls come from the deterministic provider.
        </p>
      </header>
      <ol className="home-line">
        {FORGE_STAGES.map((stage, index) => {
          const cell = cells[stage.id];
          const active = hot === stage.id || (hot === 'compile' && stage.id === 'compile');
          return (
            <li
              key={stage.id}
              className="home-line__stage"
              data-stage={stage.id}
              data-active={active ? 'true' : undefined}
            >
              <span className="home-line__bar" aria-hidden="true" />
              <span className="home-line__name">
                <span className="mono">{index + 1}</span> {stage.label}
              </span>
              <span className="home-line__value num">
                {cell?.loading ? <Skeleton width="2ch" height={26} /> : (cell?.value ?? '\u2014')}
              </span>
              <span className="home-line__caption">{cell?.caption}</span>
              <span className="home-line__about">{stage.summary}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function KeyFigures() {
  const economics = useEconomics();
  const drift = useDrift();
  const e = economics.data;
  const measured = (e?.baseline.samples ?? 0) > 0;
  const version = drift.data?.reflexVersion ?? null;
  const history = drift.data?.confidenceHistory ?? [];
  const latest = drift.data?.checks[0]?.verdict ?? null;
  const basis: Record<string, string> = {
    measured_reference: 'Against a measured baseline reference run.',
    counterfactual_estimate: 'A counterfactual estimate: what the baseline would have spent.',
    shadow_estimate: 'Estimated from Shadow Brain runs.',
    none: 'No basis yet.',
  };

  if (economics.isError) {
    return (
      <ErrorState
        title="Figures could not be loaded"
        error={economics.error}
        onRetry={() => {
          void economics.refetch();
        }}
        retrying={economics.isFetching}
      />
    );
  }

  const loading = economics.isPending;
  return (
    <section className="home-figures-wrap" aria-labelledby="figures-title">
      <header className="home-section-head">
        <h2 id="figures-title" className="home-section-head__title">
          Key figures
        </h2>
        <p className="home-section-head__note">
          {measured
            ? 'Every figure names how it was obtained.'
            : 'No measurements yet. These appear as soon as tasks have run.'}
        </p>
      </header>
      <div className="home-figures">
        <Metric
          label="Tokens avoided per run"
          value={measured && e ? formatTokens(e.perExecution.tokensAvoided) : null}
          unit="tokens"
          provenance={e?.perExecution.provenance ?? 'estimated'}
          loading={loading}
          hint={
            measured && e
              ? `${basis[e.perExecution.basis] ?? ''} Range ${formatTokens(e.perExecution.interval.low)} to ${formatTokens(e.perExecution.interval.high)}.`
              : 'Needs a Reflex and a baseline.'
          }
          tone="ember"
        />
        <Metric
          label="Cognitive reuse ratio"
          value={e && hasNumber(e.crr.value) ? formatPct(e.crr.value) : null}
          provenance={e?.crr.provenance ?? 'replay-measured'}
          definition="crr"
          loading={loading}
          hint="Only meaningful beside the verification pass rate."
        />
        <Metric
          label="Verification pass rate"
          value={
            e && hasNumber(e.reuse.verificationPassRate)
              ? formatPct(e.reuse.verificationPassRate)
              : null
          }
          provenance={e?.reuse.provenance ?? 'measured'}
          loading={loading}
          tone="jade"
          hint={
            e && e.reuse.liveExecutions + e.reuse.shadowExecutions > 0
              ? `Across ${plural(e.reuse.liveExecutions + e.reuse.shadowExecutions, 'Reflex run')}, live and shadow.`
              : 'No Reflex runs yet.'
          }
        />
        <Metric
          label="Projected cognitive ROI"
          value={e && hasNumber(e.projected.roi) ? formatMultiple(e.projected.roi) : null}
          provenance={e?.projected.provenance ?? 'estimated'}
          definition="cognitive_roi"
          loading={loading}
          hint={
            e?.projected.roiInterval
              ? `Range ${formatMultiple(e.projected.roiInterval.low)} to ${formatMultiple(e.projected.roiInterval.high)} over ${plural(e.projected.executions, 'execution')}. Net of build and review cost: ${formatUsd(e.projected.netCostUsd)}.`
              : 'An assumption, not a forecast. Change it on the Economics page.'
          }
        />
        <Metric
          label="Reflex confidence"
          value={version ? formatPct(version.trust.confidence) : null}
          provenance="estimated"
          definition="reflex_confidence"
          loading={drift.isPending}
          hint={
            version ? (
              <span className="home-figure-spark">
                <Sparkline
                  data={history.map((point) => point.confidence)}
                  label={`Confidence of ${version.name} ${version.version}`}
                  width={96}
                  height={26}
                  min={0}
                  max={1}
                  format={(value) => formatPct(value)}
                />
                <span>
                  {version.name} v{version.version}
                </span>
              </span>
            ) : (
              'No Reflex exists yet.'
            )
          }
        />
        <Metric
          label="Latest canary agreement"
          value={latest ? formatPct(latest.currentAgreement) : null}
          provenance="replay-measured"
          loading={drift.isPending}
          tone={latest?.drift ? 'crimson' : undefined}
          {...(latest
            ? {
                delta: {
                  text: `${formatPct(latest.currentAgreement - latest.historicAgreement, { signed: true })} vs history`,
                  direction:
                    latest.currentAgreement < latest.historicAgreement
                      ? ('down' as const)
                      : ('flat' as const),
                  sentiment: latest.drift ? ('bad' as const) : ('neutral' as const),
                },
              }
            : {})}
          hint={
            latest
              ? latest.drift
                ? 'Drift confirmed.'
                : 'Within tolerance of history.'
              : 'The Drift Canary has not run.'
          }
        />
      </div>
    </section>
  );
}

function DemoLadder() {
  const demo = useDemo();
  const query = useDemoState({ enabled: demo.available });
  const groups = groupScenes(demo.steps);

  if (!demo.available) return null;

  if (query.isError && !demo.state) {
    return (
      <ErrorState
        title="The guided demo could not be loaded"
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  return (
    <section className="home-ladder-wrap" aria-labelledby="ladder-title">
      <header className="home-section-head">
        <h2 id="ladder-title" className="home-section-head__title">
          The guided demo
        </h2>
        <p className="home-section-head__note">
          {demo.total} steps in {groups.length || 5} scenes. It runs the real services and works
          offline.
        </p>
      </header>
      {demo.state ? (
        <ol className="home-ladder">
          {groups.map((group) => (
            <li key={group.name} className="home-ladder__scene">
              <div className="home-ladder__text">
                <h3 className="home-ladder__name">{group.name}</h3>
                <p className="home-ladder__story">{SCENE_STORY[group.name] ?? ''}</p>
              </div>
              <div className="home-ladder__pips" aria-hidden="true">
                {group.steps.map((step) => (
                  <span
                    key={step.n}
                    className="bf-pip"
                    data-state={step.n === demo.step ? 'current' : step.done ? 'done' : 'todo'}
                  />
                ))}
              </div>
              <Button
                size="sm"
                disabled={demo.busy}
                aria-label={`Open the demo at ${group.name}, step ${group.first}`}
                onClick={() => {
                  void demo.start(group.first);
                }}
              >
                Steps {group.first}–{group.last}
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="home-ladder" aria-busy="true">
          {[0, 1, 2, 3, 4].map((key) => (
            <li key={key} className="home-ladder__scene">
              <Skeleton width="60%" height={16} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** `/`: the Forge Floor. Where is the forge right now? */
export default function HomePage() {
  const demo = useDemo();
  const reflexes = useReflexes();
  const families = useFamilies();
  const runs = useRuns({ limit: 1 });
  const economics = useEconomics();
  const drift = useDrift();

  const versions = (reflexes.data?.reflexes ?? []).flatMap((reflex) => reflex.versions);
  const forge = describeForge(
    {
      runs: runs.data?.total ?? 0,
      families: families.data?.families.length ?? 0,
      versionStatuses: versions.map((version) => version.status),
      liveExecutions: economics.data?.reuse.liveExecutions ?? 0,
      driftChecks: drift.data?.checks.length ?? 0,
      latestDriftDetected: drift.data?.checks[0]?.verdict.drift ?? null,
      proposedMutations: drift.data?.mutations.filter((m) => m.status === 'proposed').length ?? 0,
    },
    { demo: demo.available },
  );

  return (
    <Page title="Forge Floor">
      <Hero headline={forge.headline} detail={forge.detail} />
      <ForgeLine hot={forge.stage} />
      <KeyFigures />
      <DemoLadder />
    </Page>
  );
}
