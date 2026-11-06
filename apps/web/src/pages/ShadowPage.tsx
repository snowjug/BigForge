import { ArrowRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  useInfiniteComparisons,
  useReflexVersion,
  useReflexes,
  useComparisons,
} from '../api/hooks';
import { flattenPages } from '../api/hooks';
import { useAuth } from '../auth/useAuth';
import { useDemoTarget } from '../demo/useDemo';
import { useShadowParams } from '../routeParams';
import { learnPath, reflexPath } from '../routes';
import {
  ButtonLink,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Provenance,
  Skeleton,
  SkeletonGroup,
  StatusChip,
  plural,
} from '../ui';
import { actionStates } from './reflexes/actions';
import { ConfidenceBar, GateChecklist, IntegrityChip } from './reflexes/parts';
import { defaultShadowVersion } from './reflexes/registry';
import { ValidationTable } from './reflexes/ValidationTable';
import { ComparisonTable } from './shadow/ComparisonTable';
import { useReplayRun, useShadowRun } from './shadow/hooks';
import { ReplayPanel, ShadowPanel } from './shadow/RunPanels';
import '../styles/reflexes.css';
import '../styles/shadow.css';

type Kind = 'replay' | 'shadow' | 'canary';
const KIND_LABEL: Record<Kind, string> = { replay: 'Replay', shadow: 'Shadow', canary: 'Canary' };

/** `/shadow?version=<reflexVersionId>`: Does it agree with the AI? */
export default function ShadowPage() {
  const { version: versionParam, setVersion } = useShadowParams();
  const reflexes = useReflexes();
  const auth = useAuth();

  const list = reflexes.data?.reflexes;
  const all = useMemo(() => (list ?? []).flatMap((r) => r.versions), [list]);
  const fallback = defaultShadowVersion(list ?? []);
  const versionId =
    versionParam && all.some((v) => v.id === versionParam) ? versionParam : (fallback?.id ?? null);
  const unknownParam =
    Boolean(versionParam) && Boolean(list) && !all.some((v) => v.id === versionParam);

  const versionQuery = useReflexVersion(versionId);
  const version = versionQuery.data;
  const shadowRun = useShadowRun(versionId);
  const replayRun = useReplayRun(versionId);
  const replayRows = useComparisons(versionId, { kind: 'replay', limit: 100 });
  const [kind, setKind] = useState<Kind>('shadow');
  const shadowRows = useInfiniteComparisons(versionId, { kind: 'shadow', limit: 50 });
  const otherRows = useComparisons(versionId, {
    kind: kind === 'canary' ? 'canary' : 'replay',
    limit: 100,
  });
  const compareTarget = useDemoTarget('compare');

  // The canary tab only exists once the version has canary evidence; fall back if it disappears.
  const hasCanary = (version?.canary?.runs ?? 0) > 0;
  const shownKind: Kind = kind === 'canary' && !hasCanary ? 'shadow' : kind;

  const states = version
    ? actionStates({
        status: version.status,
        actions: version.actions,
        gate: version.gate,
        integrityOk: version.integrity.ok,
        role: auth.role,
      })
    : null;

  const shadowItems = flattenPages(shadowRows.data);
  const summary =
    shownKind === 'shadow'
      ? version?.shadow
      : shownKind === 'replay'
        ? version?.replay
        : version?.canary;

  return (
    <Page title="Shadow Brain">
      <PageHeader
        eyebrow="Validate"
        title="Shadow Brain"
        question="Does it agree with the AI?"
        meta="Decision: eligible for promotion? Evidence: replay and shadow comparisons, and the gate checklist."
      />

      {reflexes.isPending ? (
        <SkeletonGroup label="Loading Reflexes" className="shd-loading">
          <Skeleton height={44} radius={8} />
          <Skeleton height={220} radius={8} />
          <Skeleton height={320} radius={8} />
        </SkeletonGroup>
      ) : reflexes.isError ? (
        <ErrorState
          title="Could not load the Reflexes"
          error={reflexes.error}
          onRetry={() => {
            void reflexes.refetch();
          }}
        />
      ) : all.length === 0 ? (
        <EmptyState
          title="No Reflex to validate yet"
          description="Shadow Brain compares a candidate Reflex with the AI baseline. Compile a candidate from a task family first."
          action={
            <ButtonLink to={learnPath()} variant="primary">
              Open Learn
            </ButtonLink>
          }
        />
      ) : (
        <>
          <div className="shd-pickbar">
            <div className="shd-picker">
              <label className="bf-label" htmlFor="shd-version">
                Reflex version
              </label>
              <select
                id="shd-version"
                className="bf-select"
                value={versionId ?? ''}
                onChange={(event) => {
                  setVersion(event.target.value || null);
                }}
              >
                {(list ?? []).flatMap((r) =>
                  r.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {r.name} v{v.version} · {v.status}
                    </option>
                  )),
                )}
              </select>
            </div>
            {version ? (
              <div className="shd-pickbar__chips">
                <StatusChip status={version.status} />
                <IntegrityChip integrity={version.integrity} />
                <ConfidenceBar trust={version.trust} />
                <ButtonLink
                  to={reflexPath(version.id)}
                  variant="ghost"
                  size="sm"
                  iconRight={<ArrowRight size={14} />}
                >
                  Open the Reflex
                </ButtonLink>
              </div>
            ) : null}
          </div>
          {unknownParam ? (
            <p className="shd-note shd-note--warn" role="status">
              The version in the link does not exist, so the newest version is shown instead.
            </p>
          ) : null}
          <p className="shd-frame">
            Shadow runs use the held-out shadow scenarios on the synthetic lab. The Reflex works on
            a throwaway copy of each workspace and never acts on a real repository. Tokens and cost
            are <Provenance kind="synthetic" /> (the deterministic provider), model latency is{' '}
            <Provenance kind="simulated" />, commands and local time are{' '}
            <Provenance kind="measured" />.
          </p>

          {versionQuery.isPending ? (
            <SkeletonGroup label="Loading the Reflex version" className="shd-loading">
              <Skeleton height={220} radius={8} />
              <Skeleton height={320} radius={8} />
            </SkeletonGroup>
          ) : versionQuery.isError || !version || !states ? (
            <ErrorState
              title="Could not load this Reflex version"
              error={versionQuery.error}
              onRetry={() => {
                void versionQuery.refetch();
              }}
            />
          ) : (
            <>
              <div className="shd-runs">
                <ReplayPanel
                  version={version}
                  state={states.replay}
                  pending={replayRun.pending}
                  onRun={() => {
                    void replayRun.run();
                  }}
                  rows={replayRows.data?.items}
                  onShowResults={() => {
                    setKind('replay');
                    document
                      .getElementById('shd-compare-title')
                      ?.scrollIntoView({ block: 'start' });
                  }}
                />
                <ShadowPanel
                  version={version}
                  state={states.shadow}
                  starting={shadowRun.starting}
                  live={shadowRun.live}
                  job={shadowRun.job}
                  onRun={() => {
                    void shadowRun.run();
                  }}
                  rows={shadowItems}
                />
              </div>

              <section
                {...compareTarget}
                className="shd-compare"
                aria-labelledby="shd-compare-title"
              >
                <header className="shd-panel__head">
                  <div>
                    <p className="micro">Step 3 · Compare</p>
                    <h2 id="shd-compare-title" className="shd-h2">
                      Baseline against Reflex
                    </h2>
                    <p className="shd-sub">
                      Same task, same verifier. Select a row for every check and both traces.
                    </p>
                  </div>
                  <div className="shd-kinds" role="group" aria-label="Comparison kind">
                    {(
                      ['shadow', 'replay', ...(hasCanary ? (['canary'] as const) : [])] as Kind[]
                    ).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className="shd-kinds__btn"
                        aria-pressed={shownKind === k}
                        onClick={() => {
                          setKind(k);
                        }}
                      >
                        {KIND_LABEL[k]}
                      </button>
                    ))}
                  </div>
                </header>

                <div data-testid="shadow-table">
                  {shownKind === 'shadow' ? (
                    <ComparisonTable
                      rows={shadowRows.isPending ? undefined : shadowItems}
                      loading={shadowRows.isPending}
                      error={shadowRows.error}
                      onRetry={() => {
                        void shadowRows.refetch();
                      }}
                      caption="Shadow Brain comparisons of the baseline agent and the Reflex"
                      empty={
                        <EmptyState
                          compact
                          title="No shadow comparisons yet"
                          description={
                            version.status === 'shadow'
                              ? 'Run Shadow Brain above: each held-out task appears here as it finishes.'
                              : 'Shadow Brain runs once replay has passed and the Reflex is in Shadow.'
                          }
                        />
                      }
                      hasMore={Boolean(shadowRows.hasNextPage)}
                      loadingMore={shadowRows.isFetchingNextPage}
                      onLoadMore={() => {
                        void shadowRows.fetchNextPage();
                      }}
                      total={shadowRows.data?.pages[0]?.total ?? shadowItems.length}
                    />
                  ) : (
                    <ComparisonTable
                      rows={otherRows.data?.items}
                      loading={otherRows.isPending}
                      error={otherRows.error}
                      onRetry={() => {
                        void otherRows.refetch();
                      }}
                      caption={`${KIND_LABEL[shownKind]} comparisons of the baseline agent and the Reflex`}
                      empty={<EmptyState compact title={`No ${shownKind} comparisons yet`} />}
                    />
                  )}
                </div>

                {summary ? (
                  <div className="shd-summary" data-testid="shadow-summary">
                    <ValidationTable summary={summary} headingLevel={3} />
                  </div>
                ) : null}
              </section>

              <section className="shd-gate" aria-labelledby="shd-gate-title">
                <header className="shd-panel__head">
                  <div>
                    <p className="micro">Decision</p>
                    <h2 id="shd-gate-title" className="shd-h2">
                      {version.gate.eligible
                        ? 'Eligible for promotion'
                        : 'Not yet eligible for promotion'}
                    </h2>
                    <p className="shd-sub">
                      The gate is evaluated by the server. Even when every check passes, only a
                      reviewer can promote a Reflex, and the content hash is checked again at that
                      moment.
                    </p>
                  </div>
                  <ButtonLink
                    to={reflexPath(version.id)}
                    variant={version.gate.eligible ? 'primary' : 'ghost'}
                    iconRight={<ArrowRight size={14} />}
                  >
                    {version.gate.eligible ? 'Review and promote' : 'Open the Reflex'}
                  </ButtonLink>
                </header>
                <GateChecklist gate={version.gate} />
                <p className="shd-note">
                  {plural(version.shadow.runs, 'shadow run')} ·{' '}
                  {plural(version.replay.runs, 'replayed trace')} · confidence is estimated from the
                  most recent 12 comparisons.
                </p>
              </section>
            </>
          )}
        </>
      )}
    </Page>
  );
}
