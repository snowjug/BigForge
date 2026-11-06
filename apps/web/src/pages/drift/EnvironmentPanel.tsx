import { Hammer, History, Wrench } from 'lucide-react';
import type { EnvironmentDto } from '@bigforge/schemas';
import { useDemoTarget } from '../../demo/useDemo';
import { useAuth } from '../../auth/useAuth';
import { useSetEnvironment } from '../../api/hooks';
import { errorMessage } from '../../api/client';
import { Button, Chip, relativeTime, useToast } from '../../ui';
import { useNow } from '../../hooks/useNow';
import {
  type EnvChange,
  revertTargets,
  updateTarget,
  updateToolBlocker,
  versionDiff,
} from './model';
import { DiffChip, StageHead } from './parts';

/** The synthetic lab's toolchain: what is running, what it does differently, and the action that changes it. */
export function EnvironmentPanel({
  environment,
  changes,
  lastChange,
}: {
  environment: EnvironmentDto;
  changes: readonly EnvChange[];
  /** The change that preceded the latest canary, when the audit history is unavailable. */
  lastChange: { from: string; to: string } | null;
}) {
  const target = useDemoTarget('env_change');
  const auth = useAuth();
  const { toast } = useToast();
  const now = useNow();
  const setEnvironment = useSetEnvironment();
  const next = updateTarget(environment);
  const reverts = revertTargets(environment);
  const blocker = updateToolBlocker({
    canChange: auth.can('inject_environment_change'),
    target: next,
    current: environment.toolchainVersion,
  });
  const newest = changes[changes.length - 1] ?? null;
  const shownChange = newest ? { from: newest.from, to: newest.to } : lastChange;
  const nextEntry = environment.available.find((entry) => entry.version === next);

  const change = (version: string, quiet: boolean) => {
    setEnvironment.mutate(version, {
      onSuccess: () => {
        toast({
          title: `Build tool is now forge-ci ${version}`,
          description: quiet
            ? 'The synthetic lab was put back on an earlier version.'
            : 'Simulated upgrade in the synthetic lab. Run the Drift Canary to see what it does to the Reflex.',
          tone: 'info',
        });
      },
      onError: (error) => {
        toast({
          title: 'The environment was not changed',
          description: errorMessage(error),
          tone: 'danger',
        });
      },
    });
  };

  return (
    <section
      className="drift-stage"
      id="drift-environment"
      aria-labelledby="drift-environment-title"
      data-testid="drift-env"
      {...target}
    >
      <StageHead
        n={1}
        id="drift-environment-title"
        title="The world changes"
        lede="A synthetic build-tool upgrade in the lab. Nothing in the Reflex says it cannot run on the new version."
        state={
          shownChange ? { label: 'changed', tone: 'crimson' } : { label: 'unchanged', tone: 'ash' }
        }
        actions={
          <Button
            variant="forge"
            icon={<Wrench size={15} />}
            data-testid="drift-update-tool"
            loading={setEnvironment.isPending}
            disabled={blocker !== null}
            {...(blocker ? { disabledReason: blocker } : {})}
            onClick={() => {
              if (next) change(next, false);
            }}
          >
            Update the build tool
          </Button>
        }
      />
      <div className="drift-env">
        <div className="drift-env__now">
          <p className="micro">Toolchain in the lab</p>
          <p className="drift-env__version mono" aria-live="polite">
            forge-ci {environment.toolchainVersion}
          </p>
          {shownChange ? (
            <DiffChip from={shownChange.from} to={shownChange.to} />
          ) : (
            <Chip tone="ash" size="sm" dashed>
              no change recorded
            </Chip>
          )}
          <p className="drift-env__explain">
            Updating simulates a build-tool upgrade in the synthetic lab, not a real one.
            {nextEntry
              ? ` What changes on forge-ci ${nextEntry.version}: ${nextEntry.description.replace(/^[^:]*:\s*/, '')}`
              : ''}
          </p>
        </div>

        <div className="drift-env__versions">
          <p className="micro">Available versions</p>
          <ul className="drift-versions">
            {environment.available.map((entry) => {
              const isCurrent = entry.version === environment.toolchainVersion;
              return (
                <li
                  key={entry.version}
                  className="drift-version"
                  data-current={isCurrent ? 'true' : undefined}
                >
                  <span className="drift-version__mark" aria-hidden="true" />
                  <div className="drift-version__text">
                    <p>
                      <span className="mono">forge-ci {entry.version}</span>{' '}
                      {isCurrent ? (
                        <Chip tone="steel" size="sm">
                          current
                        </Chip>
                      ) : null}
                    </p>
                    <p className="drift-version__desc">{entry.description}</p>
                  </div>
                  {reverts.includes(entry.version) ? (
                    <Button
                      size="sm"
                      loading={setEnvironment.isPending}
                      disabled={!auth.can('inject_environment_change')}
                      {...(!auth.can('inject_environment_change')
                        ? {
                            disabledReason:
                              'Changing the environment needs the operator role or higher.',
                          }
                        : {})}
                      icon={<Hammer size={13} />}
                      onClick={() => {
                        change(entry.version, true);
                      }}
                    >
                      Switch back
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="drift-env__history">
          <p className="micro">
            <History size={12} aria-hidden="true" /> History of changes
          </p>
          {changes.length === 0 ? (
            <p className="drift-env__none">
              {shownChange
                ? `The lab moved from forge-ci ${shownChange.from} to ${shownChange.to} before the latest canary.`
                : `No change yet. The lab has run forge-ci ${environment.toolchainVersion} since the demo began.`}
            </p>
          ) : (
            <ol className="drift-history">
              {[...changes].reverse().map((entry) => (
                <li key={entry.id}>
                  <span className="mono">{versionDiff(entry.from, entry.to)}</span>
                  <span className="faint">
                    {entry.by} &middot; {relativeTime(entry.at, now)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
