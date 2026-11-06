import type { FamiliesViewDto } from '@bigforge/schemas';
import { Network, Terminal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { errorMessage } from '../api/client';
import {
  useDiscoverFamilies,
  useFamilies,
  useMatcherEvaluation,
  useReflexes,
  useScenarios,
} from '../api/hooks';
import { useAuth } from '../auth/useAuth';
import { useDemoTarget } from '../demo/useDemo';
import { useLearnParams } from '../routeParams';
import { runPath } from '../routes';
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Skeleton,
  SkeletonGroup,
  plural,
  useToast,
} from '../ui';
import { type MapNode, layoutFamilyMap } from './learn/clusterLayout';
import { DnaSection } from './learn/DnaSection';
import { FamilyInspector } from './learn/FamilyInspector';
import { FamilyMap } from './learn/FamilyMap';
import { type ScenarioRole, discoveryGap, learnState } from './learn/familyView';
import { MatcherPanel } from './learn/MatcherPanel';
import '../styles/learn.css';

function roleReason(role: string | null): string {
  return `Discovering families is limited to operators, reviewers and admins.${role ? ` You are signed in as a${role === 'admin' ? 'n' : ''} ${role}.` : ''}`;
}

function LoadingBody() {
  return (
    <SkeletonGroup label="Loading task families" className="learn-loading">
      <Skeleton height={96} radius={8} />
      <div className="learn-loading__row">
        <Skeleton height={380} radius={8} />
        <Skeleton height={380} radius={8} />
      </div>
      <Skeleton height={320} radius={8} />
    </SkeletonGroup>
  );
}

function Families({
  view,
  matcherLoading,
  matcherError,
  onRetryMatcher,
  matcher,
}: {
  view: FamiliesViewDto;
  matcherLoading: boolean;
  matcherError: unknown;
  onRetryMatcher: () => void;
  matcher: FamiliesViewDto['matcher'];
}) {
  const target = useDemoTarget('family_found');
  const { family: familyParam, setFamily } = useLearnParams();
  const [taskId, setTaskId] = useState<string | null>(null);
  const reflexes = useReflexes();
  const scenarios = useScenarios();

  const state = learnState(view);
  const family = view.families.find((f) => f.id === familyParam) ?? view.families[0] ?? null;
  const nodes = useMemo(() => layoutFamilyMap(view).nodes, [view]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.taskId, n])), [nodes]);
  const selectedNode = taskId ? (nodesById.get(taskId) ?? null) : null;
  const roles = useMemo(
    () =>
      new Map<string, ScenarioRole>((scenarios.data?.scenarios ?? []).map((s) => [s.id, s.role])),
    [scenarios.data],
  );
  const versions = useMemo(
    () =>
      (reflexes.data?.reflexes ?? [])
        .filter((r) => family !== null && r.familyId === family.id)
        .flatMap((r) => r.versions),
    [reflexes.data, family],
  );

  const select = (node: MapNode | null) => {
    setTaskId(node ? node.taskId : null);
    if (node?.familyId) setFamily(node.familyId);
  };

  return (
    <>
      <MatcherPanel
        evaluation={matcher}
        loading={matcherLoading}
        error={matcherError}
        onRetry={onRetryMatcher}
        hasFamily={view.families.length > 0}
      />

      <section {...target} className="learn-families" aria-labelledby="learn-families-title">
        <header className="learn-families__head">
          <div>
            <h2 id="learn-families-title" className="learn-h2">
              Task families
            </h2>
            <p className="learn-sub">
              Fingerprints, not prompts, group the tasks: intent, toolchain, failure type, error
              classes and repository shape. Unrelated tasks seen the same week stay out.
            </p>
          </div>
        </header>
        {state.kind === 'no_family' ? (
          <p className="learn-note learn-note--warn" role="status">
            No family yet: {plural(state.tasks, 'task')} seen across{' '}
            {plural(state.variants, 'variant')}. A family needs at least{' '}
            {view.thresholds.minMembers} tasks with at least {view.thresholds.minVariants} distinct
            variants whose fingerprints cluster at similarity {view.thresholds.cluster} or more.{' '}
            {discoveryGap(state, view.thresholds)}
          </p>
        ) : null}
        <div className="learn-families__body">
          <div className="learn-families__map">
            <FamilyMap
              view={view}
              selectedFamilyId={family?.id ?? null}
              selectedTaskId={selectedNode?.taskId ?? null}
              onSelectFamily={setFamily}
              onSelectTask={select}
              roles={roles}
            />
          </div>
          <aside className="learn-families__inspector" aria-label="Family and task inspector">
            <FamilyInspector
              view={view}
              family={family}
              node={selectedNode}
              nodesById={nodesById}
              roles={roles}
              versions={versions}
              onSelectTask={(id) => {
                select(id ? (nodesById.get(id) ?? null) : null);
              }}
            />
          </aside>
        </div>
      </section>

      <DnaSection family={family} versions={versions} />
    </>
  );
}

/** `/learn?family=<familyId>`: What repeats? */
export default function LearnPage() {
  const families = useFamilies();
  const matcher = useMatcherEvaluation();
  const discover = useDiscoverFamilies();
  const auth = useAuth();
  const { toast } = useToast();

  const view = families.data;
  const canDiscover = auth.can('compile');

  const onDiscover = async () => {
    try {
      const next = await discover.mutateAsync();
      toast({
        title:
          next.families.length > 0 ? 'Task families discovered' : 'No family met the thresholds',
        description:
          next.families.length > 0
            ? `${plural(next.families.length, 'family', 'families')} across ${plural(next.nodes.length, 'task')}. Review the map, then compile.`
            : `Needs at least ${next.thresholds.minMembers} tasks with ${next.thresholds.minVariants} distinct variants.`,
        tone: next.families.length > 0 ? 'success' : 'info',
      });
    } catch (error) {
      toast({ title: 'Discovery failed', description: errorMessage(error), tone: 'danger' });
    }
  };

  const state = view ? learnState(view) : null;
  const matcherEvaluation = view?.matcher ?? matcher.data?.evaluation ?? null;

  return (
    <Page title="Learn">
      <PageHeader
        eyebrow="Fingerprint · Compile"
        title="Learn"
        question="What repeats?"
        meta={
          view
            ? `${plural(view.nodes.length, 'task')} seen · ${plural(view.families.length, 'family', 'families')} · decision: compile a Reflex?`
            : 'Decision: compile a Reflex?'
        }
        actions={
          <Button
            variant="forge"
            icon={<Network size={15} />}
            data-testid="discover-families"
            loading={discover.isPending}
            disabled={!canDiscover}
            {...(!canDiscover ? { disabledReason: roleReason(auth.role) } : {})}
            onClick={() => {
              void onDiscover();
            }}
          >
            Discover task families
          </Button>
        }
      />
      {families.isPending ? (
        <LoadingBody />
      ) : families.isError ? (
        <ErrorState
          title="Could not load the task families"
          error={families.error}
          onRetry={() => {
            void families.refetch();
          }}
        />
      ) : state?.kind === 'no_tasks' && view ? (
        <>
          <EmptyState
            icon={<Terminal size={22} />}
            title="No tasks to learn from yet"
            description={`BigForge learns from failures the baseline agent has already solved. Send a failure from the Run Console and let the baseline solve it; a family needs at least ${view.thresholds.minMembers} solved tasks across ${view.thresholds.minVariants} distinct variants before it can be proposed.`}
            action={
              <ButtonLink to={runPath()} variant="primary">
                Open the Run Console
              </ButtonLink>
            }
          />
          <MatcherPanel
            evaluation={null}
            loading={false}
            error={undefined}
            onRetry={() => undefined}
            hasFamily={false}
          />
        </>
      ) : view ? (
        <Families
          view={view}
          matcher={matcherEvaluation}
          matcherLoading={matcher.isPending && !view.matcher && view.families.length > 0}
          matcherError={matcher.isError && !view.matcher ? matcher.error : undefined}
          onRetryMatcher={() => {
            void matcher.refetch();
          }}
        />
      ) : null}
    </Page>
  );
}
