import { Eye, Radar } from 'lucide-react';
import { useRef } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { useReflexVersion } from '../api/hooks';
import { useDemoTarget } from '../demo/useDemo';
import { driftPath, reflexesPath, shadowPath } from '../routes';
import {
  ButtonLink,
  Chip,
  ErrorState,
  Page,
  PageHeader,
  Skeleton,
  SkeletonGroup,
  StatusChip,
  TabPanel,
  Tabs,
  shortHash,
  formatTimestamp,
  plural,
} from '../ui';
import { ReflexGlyph } from '../viz';
import { DecisionStrip } from './reflexes/detail/DecisionStrip';
import { EvidenceTab, LifecycleTab } from './reflexes/detail/EvidenceTab';
import { OverviewTab } from './reflexes/detail/OverviewTab';
import {
  AssumptionsTab,
  MutationsTab,
  PermissionsTab,
  SpecTab,
} from './reflexes/detail/ProfileTabs';
import { IntegrityChip } from './reflexes/parts';
import { StatusRibbon } from './reflexes/StatusRibbon';
import '../styles/reflexes.css';

const TABS = [
  'overview',
  'evidence',
  'lifecycle',
  'permissions',
  'assumptions',
  'spec',
  'mutations',
] as const;
type TabId = (typeof TABS)[number];
const ID_PREFIX = 'rfx';

const isTab = (value: string | null): value is TabId => TABS.some((t) => t === value);

function Loading() {
  return (
    <SkeletonGroup label="Loading the Reflex" className="rfx-loading">
      <Skeleton height={56} width="60%" radius={8} />
      <Skeleton height={36} radius={8} />
      <Skeleton height={110} radius={8} />
      <Skeleton height={360} radius={8} />
    </SkeletonGroup>
  );
}

/** `/reflexes/:versionId`: Is this Reflex trustworthy and what does it do? */
export default function ReflexDetailPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const query = useReflexVersion(versionId);
  const [search, setSearch] = useSearchParams();
  const candidateTarget = useDemoTarget('candidate');
  const shadowTarget = useDemoTarget('back_to_shadow');
  const statusFocus = useRef<HTMLDivElement | null>(null);

  const version = query.data;
  const tabParam = search.get('tab');
  const tab: TabId = isTab(tabParam) ? tabParam : 'overview';
  const hybrid = version?.spec.steps.find((s) => s.kind === 'hybrid' || s.kind === 'boundary');
  const stepParam = search.get('step');
  const selectedStepId =
    stepParam && version?.spec.steps.some((s) => s.id === stepParam)
      ? stepParam
      : (hybrid?.id ?? version?.spec.steps[0]?.id ?? null);

  const update = (patch: Record<string, string | null>) => {
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  };

  const notFound = query.error instanceof ApiError && query.error.status === 404;

  return (
    <Page title={version ? `${version.name} v${version.version}` : 'Reflex'}>
      {query.isPending ? (
        <Loading />
      ) : query.isError || !version ? (
        <div className="rfx-error">
          <ErrorState
            title={notFound ? 'This Reflex version does not exist' : 'Could not load this Reflex'}
            error={query.error}
            {...(notFound
              ? {}
              : {
                  onRetry: () => {
                    void query.refetch();
                  },
                })}
          />
          <ButtonLink to={reflexesPath()} variant="ghost">
            Back to all Reflexes
          </ButtonLink>
        </div>
      ) : (
        <>
          <div {...candidateTarget} className="rfx-head" data-testid="reflex-header">
            <PageHeader
              eyebrow="Reflex"
              title={
                <span className="rfx-title">
                  <ReflexGlyph
                    hash={version.contentHash}
                    size={52}
                    title={`Identity glyph of ${version.name}`}
                  />
                  <span className="rfx-title__text">
                    {version.name}{' '}
                    <span className="rfx-title__version mono">v{version.version}</span>
                  </span>
                </span>
              }
              question={version.spec.description}
              meta={
                <span className="rfx-meta">
                  <StatusChip status={version.status} />
                  <IntegrityChip integrity={version.integrity} />
                  <Chip
                    tone="neutral"
                    variant="outline"
                    mono
                    title={`Content hash sha256 ${version.contentHash}`}
                  >
                    sha256 {shortHash(version.contentHash, 12)}
                  </Chip>
                  <Chip tone="neutral" variant="outline" mono>
                    {version.compileReport.compilerVersion}
                  </Chip>
                  <span className="faint">
                    {plural(version.stepCount, 'step')} · created{' '}
                    {formatTimestamp(version.createdAt)}
                  </span>
                </span>
              }
              actions={
                <>
                  <ButtonLink
                    to={shadowPath({ version: version.id })}
                    variant="ghost"
                    icon={<Eye size={15} />}
                  >
                    Shadow Lab
                  </ButtonLink>
                  <ButtonLink
                    to={driftPath({ version: version.id })}
                    variant="ghost"
                    icon={<Radar size={15} />}
                  >
                    Drift
                  </ButtonLink>
                </>
              }
            />
          </div>

          <div {...shadowTarget} className="rfx-ribbon-region">
            <div
              ref={statusFocus}
              tabIndex={-1}
              className="rfx-ribbon-focus"
              aria-label="Lifecycle status"
            >
              <StatusRibbon
                status={version.status}
                transitions={version.transitions}
                variant="full"
              />
            </div>
          </div>

          <DecisionStrip
            version={version}
            onDecided={() => {
              statusFocus.current?.focus({ preventScroll: false });
            }}
          />

          <Tabs
            label="Reflex sections"
            idPrefix={ID_PREFIX}
            value={tab}
            onValueChange={(next) => {
              update({ tab: next === 'overview' ? null : next });
            }}
            className="rfx-tabs"
            items={[
              { id: 'overview', label: 'Overview' },
              {
                id: 'evidence',
                label: 'Evidence',
                count: `${version.gate.checks.filter((c) => c.passed).length}/${version.gate.checks.length}`,
              },
              { id: 'lifecycle', label: 'Lifecycle', count: version.transitions.length },
              { id: 'permissions', label: 'Permissions' },
              {
                id: 'assumptions',
                label: 'Assumptions',
                count: version.spec.provenance.assumptions.length,
              },
              { id: 'spec', label: 'Spec' },
              { id: 'mutations', label: 'Mutations', count: version.mutations.length },
            ]}
          />
          <TabPanel idPrefix={ID_PREFIX} id="overview" value={tab}>
            <OverviewTab
              version={version}
              selectedStepId={selectedStepId}
              onSelectStep={(id) => {
                update({ step: id });
              }}
            />
          </TabPanel>
          <TabPanel idPrefix={ID_PREFIX} id="evidence" value={tab}>
            <EvidenceTab version={version} />
          </TabPanel>
          <TabPanel idPrefix={ID_PREFIX} id="lifecycle" value={tab}>
            <LifecycleTab version={version} />
          </TabPanel>
          <TabPanel idPrefix={ID_PREFIX} id="permissions" value={tab}>
            <PermissionsTab spec={version.spec} />
          </TabPanel>
          <TabPanel idPrefix={ID_PREFIX} id="assumptions" value={tab}>
            <AssumptionsTab version={version} />
          </TabPanel>
          <TabPanel idPrefix={ID_PREFIX} id="spec" value={tab}>
            <SpecTab version={version} />
          </TabPanel>
          <TabPanel idPrefix={ID_PREFIX} id="mutations" value={tab}>
            <MutationsTab version={version} />
          </TabPanel>
        </>
      )}
    </Page>
  );
}
