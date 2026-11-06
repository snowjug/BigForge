import { Sparkles } from 'lucide-react';
import { useDriftParams } from '../routeParams';
import { driftPath, learnPath } from '../routes';
import { useAuth } from '../auth/useAuth';
import {
  ButtonLink,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Skeleton,
  SkeletonGroup,
  StatusChip,
  formatPct,
} from '../ui';
import { ReflexGlyph } from '../viz';
import { CanaryPanel } from './drift/CanaryPanel';
import { ConfidencePanel } from './drift/ConfidencePanel';
import { EnvironmentPanel } from './drift/EnvironmentPanel';
import { FracturePanel } from './drift/FracturePanel';
import { LifecyclePanel } from './drift/LifecyclePanel';
import { MutationPanel } from './drift/MutationPanel';
import { StoryStrip } from './drift/StoryStrip';
import { confidenceFall, driftStatus, storyStages } from './drift/model';
import { useDriftWorkspace } from './drift/useDriftWorkspace';
import { PAGE_META } from './pageMeta';
import '../styles/drift.css';

const META = PAGE_META.drift;

function DriftSkeleton() {
  return (
    <SkeletonGroup label="Loading the drift view" className="drift">
      <Skeleton height={56} radius={8} />
      <Skeleton height={180} radius={8} />
      <Skeleton height={320} radius={8} />
    </SkeletonGroup>
  );
}

/**
 * Is the world still the same? The five beats of drift, in order: the environment changes, the canary
 * notices, confidence falls, the Reflex returns to Shadow by itself, and a mutation waits for a human.
 * The mechanism is real; the scenario is designed.
 */
export default function DriftPage() {
  const params = useDriftParams();
  const workspace = useDriftWorkspace(params.version);
  const auth = useAuth();
  const { drift, version, versionId, latest, checks, proposal, origin, changes, canary } =
    workspace;
  const view = drift.data;

  const header = (
    <PageHeader
      eyebrow="Evolve"
      title={META.title}
      question={META.question}
      meta={
        <span>
          Decision: {META.decision} &middot; Evidence: {META.evidence} &middot; Action:{' '}
          {META.action}
        </span>
      }
    />
  );

  if (drift.isPending) {
    return (
      <Page title={META.title}>
        {header}
        <DriftSkeleton />
      </Page>
    );
  }
  if (!view) {
    return (
      <Page title={META.title}>
        {header}
        <ErrorState
          title="The drift view could not be loaded"
          error={drift.error}
          retrying={drift.isFetching}
          onRetry={() => {
            void drift.refetch();
          }}
        />
      </Page>
    );
  }

  const tracked = view.reflexVersion;
  if (versionId === null) {
    return (
      <Page title={META.title}>
        {header}
        <div className="drift">
          <EmptyState
            icon={<Sparkles size={18} />}
            title="No Reflex to watch yet"
            description="Drift watches a Reflex: the canary compares it with the baseline after the world changes. Learn a Reflex first, promote it, then come back to change the environment (demo steps 5 to 11)."
            action={<ButtonLink to={learnPath()}>Go to Learn</ButtonLink>}
          />
          <EnvironmentPanel environment={view.environment} changes={changes} lastChange={null} />
        </div>
      </Page>
    );
  }

  if (version.isError && !version.data) {
    return (
      <Page title={META.title}>
        {header}
        <ErrorState
          title={
            params.version
              ? 'That Reflex version could not be loaded'
              : 'The Reflex could not be loaded'
          }
          error={version.error}
          retrying={version.isFetching}
          onRetry={() => {
            void version.refetch();
          }}
        />
        {params.version ? (
          <p className="drift-back">
            <ButtonLink to={driftPath()}>Back to the tracked Reflex</ButtonLink>
          </p>
        ) : null}
      </Page>
    );
  }

  const detail = version.data ?? null;
  const summary = versionId === tracked?.id ? tracked : detail;
  // The drift view refreshes with the checks, so it is the freshest source of the status right after a job.
  const status = summary?.status ?? detail?.status ?? null;
  const history =
    detail?.confidenceHistory ?? (versionId === tracked?.id ? view.confidenceHistory : []);
  const newestChange = changes[changes.length - 1] ?? null;
  const lastChange = newestChange
    ? { from: newestChange.from, to: newestChange.to }
    : (latest?.detail.environmentChange ?? null);
  const verdictStatus = driftStatus(latest?.verdict ?? null, view.config);
  const confidence = summary
    ? confidenceFall(latest, summary.confidence, view.config.watchBelow)
    : confidenceFall(null, 0, view.config.watchBelow);
  const demoted = Boolean(latest && latest.detail.transitions.length > 0);
  const stages = storyStages({
    environmentChange: lastChange,
    status: verdictStatus,
    confidence,
    demoted,
    mutation: proposal,
  });
  const versions = (workspace.reflexes.data?.reflexes ?? []).flatMap((reflex) => reflex.versions);

  return (
    <Page title={META.title}>
      <PageHeader
        eyebrow="Evolve"
        title={META.title}
        question={META.question}
        meta={
          summary ? (
            <span className="drift-reflex">
              <ReflexGlyph hash={summary.contentHash} size={20} />
              <strong>{summary.name}</strong> <span className="mono">v{summary.version}</span>
              <StatusChip status={summary.status} />
              <span className="faint">
                confidence {formatPct(summary.confidence, { digits: 0 })}
              </span>
              {versions.length > 1 ? (
                <label className="drift-picker">
                  <span className="sr-only">Reflex version</span>
                  <select
                    className="bf-select"
                    value={versionId}
                    onChange={(event) => {
                      params.setVersion(event.target.value);
                    }}
                  >
                    {versions.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name} v{entry.version} ({entry.status})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </span>
          ) : null
        }
      />
      <p className="drift-note">
        The drift in this demo is a designed scenario in a synthetic lab: a toolchain upgrade that
        reorders build logs. The mechanism is real; the magnitude is tuned.
      </p>

      <div className="drift">
        <StoryStrip stages={stages} />
        <EnvironmentPanel
          environment={view.environment}
          changes={changes}
          lastChange={lastChange}
        />
        <CanaryPanel
          versionId={versionId}
          status={status}
          check={latest}
          config={view.config}
          comparisons={canary.data?.items ?? []}
          serverAllowsCanary={detail ? detail.actions.canary : null}
        />
        {detail ? (
          <FracturePanel
            spec={detail.spec}
            check={latest}
            comparisons={canary.data?.items ?? []}
            environment={view.environment}
          />
        ) : (
          <Skeleton height={260} radius={8} />
        )}
        <ConfidencePanel
          version={summary}
          history={history}
          checks={checks}
          latest={latest}
          config={view.config}
        />
        <LifecyclePanel check={latest} transitions={detail?.transitions ?? []} status={status} />
        <MutationPanel
          versionId={versionId}
          status={status}
          versionLabel={summary ? `v${summary.version}` : 'This version'}
          proposal={proposal}
          origin={origin}
          hasCheck={latest !== null}
        />
        {auth.role === 'viewer' ? (
          <p className="drift-note drift-note--role">
            You are signed in as a viewer: every action on this page is disabled with its reason,
            and everything is readable.
          </p>
        ) : null}
      </div>
    </Page>
  );
}
