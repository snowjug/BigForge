import { ArrowRight, Check, GitPullRequestArrow, Lock, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { MutationDto, ReflexStatus } from '@bigforge/schemas';
import { errorMessage } from '../../api/client';
import {
  useApproveMutation,
  useProposeMutation,
  useReflexVersion,
  useRejectMutation,
} from '../../api/hooks';
import { useAuth } from '../../auth/useAuth';
import { useDemoTarget } from '../../demo/useDemo';
import { reflexPath, shadowPath } from '../../routes';
import {
  Button,
  Chip,
  Drawer,
  EmptyState,
  Field,
  Provenance,
  StatusChip,
  Summary,
  formatPct,
  formatTimestamp,
  plural,
  useToast,
} from '../../ui';
import {
  decisionBlocker,
  describeStepChange,
  mutationStatusInfo,
  proposeBlocker,
  regressionSummary,
} from './model';
import { JobLine, StageHead } from './parts';
import { useDemoJob, useJobFollower } from './useDriftWorkspace';

type Decision = 'approve' | 'reject';

function DiffLine({ sign, children }: { sign: '+' | '-'; children: string }) {
  return (
    <div className={`drift-diffline drift-diffline--${sign === '+' ? 'add' : 'remove'}`}>
      <span className="drift-diffline__sign" aria-hidden="true">
        {sign === '+' ? '+' : '\u2212'}
      </span>
      <span className="sr-only">{sign === '+' ? 'Added: ' : 'Removed: '}</span>
      <code>{children}</code>
    </div>
  );
}

function DecisionDrawer({
  kind,
  mutation,
  onClose,
  onConfirm,
  pending,
  error,
}: {
  kind: Decision | null;
  mutation: MutationDto;
  onClose: () => void;
  onConfirm: (comment: string) => void;
  pending: boolean;
  error: string | null;
}) {
  const [comment, setComment] = useState('');
  const approving = kind === 'approve';
  return (
    <Drawer
      open={kind !== null}
      onClose={onClose}
      title={
        approving
          ? `Approve v${mutation.toVersion} into shadow validation`
          : `Reject v${mutation.toVersion}`
      }
      description={
        approving
          ? 'Approving does not activate anything. The new version re-enters shadow validation and must earn trust again before a reviewer can promote it.'
          : 'Rejecting deprecates the proposed version. The running Reflex is not affected.'
      }
      footer={
        <div className="drift-decision__footer">
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={approving ? 'primary' : 'danger'}
            icon={approving ? <Check size={14} /> : <X size={14} />}
            loading={pending}
            data-testid={approving ? 'mutation-approve-confirm' : 'mutation-reject-confirm'}
            onClick={() => {
              onConfirm(comment.trim());
            }}
          >
            {approving ? 'Approve mutation' : 'Reject mutation'}
          </Button>
        </div>
      }
    >
      <div className="drift-decision">
        <Field label="Comment" help="Recorded in the audit log with your name. Optional.">
          {(control) => (
            <textarea
              {...control}
              className="bf-textarea"
              rows={4}
              maxLength={500}
              data-autofocus
              data-testid="mutation-comment"
              value={comment}
              onChange={(event) => {
                setComment(event.target.value);
              }}
            />
          )}
        </Field>
        {error ? (
          <p className="drift-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}

interface MutationPanelProps {
  versionId: string | null;
  status: ReflexStatus | null;
  versionLabel: string;
  proposal: MutationDto | null;
  origin: MutationDto | null;
  hasCheck: boolean;
}

/** A mutation proposal: an ember dashed outline until a reviewer approves, never activated by itself. */
export function MutationPanel({
  versionId,
  status,
  versionLabel,
  proposal,
  origin,
  hasCheck,
}: MutationPanelProps) {
  const target = useDemoTarget('mutation');
  const auth = useAuth();
  const { toast } = useToast();
  const propose = useProposeMutation();
  const approve = useApproveMutation();
  const reject = useRejectMutation();
  const follower = useJobFollower();
  const demoJob = useDemoJob('mutation');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const successor = useReflexVersion(
    proposal && proposal.status !== 'rejected' ? proposal.toVersionId : null,
  );

  const hasProposed = proposal?.status === 'proposed';
  const blocker = proposeBlocker({
    canPropose: auth.can('compile'),
    status,
    hasCheck,
    hasProposed,
  });
  const running = propose.isPending || follower.running || demoJob !== null;
  const info = proposal ? mutationStatusInfo(proposal) : null;
  const regression = proposal ? regressionSummary(proposal.evidence) : null;
  const canDecide = auth.can('approve_mutation');
  const approveBlocker = proposal
    ? decisionBlocker({ kind: 'approve', canDecide, role: auth.role, mutation: proposal })
    : null;
  const rejectBlocker = proposal
    ? decisionBlocker({ kind: 'reject', canDecide, role: auth.role, mutation: proposal })
    : null;

  const runPropose = () => {
    if (!versionId) return;
    setProposeError(null);
    propose.mutate(versionId, {
      onSuccess: (envelope) => {
        follower.follow(envelope.job.id);
      },
      onError: (error) => {
        setProposeError(errorMessage(error));
      },
    });
  };

  const decide = (comment: string) => {
    if (!proposal || !decision) return;
    setDecisionError(null);
    const action = decision === 'approve' ? approve : reject;
    action.mutate(
      { mutationId: proposal.id, comment },
      {
        onSuccess: () => {
          toast({
            title:
              decision === 'approve'
                ? `v${proposal.toVersion} approved into shadow validation`
                : `v${proposal.toVersion} rejected`,
            description:
              decision === 'approve'
                ? 'It is not active. It must earn trust in shadow before a reviewer can promote it.'
                : 'The running Reflex is unchanged.',
            tone: 'success',
          });
          setDecision(null);
        },
        onError: (error) => {
          setDecisionError(errorMessage(error));
        },
      },
    );
  };

  return (
    <section
      className="drift-stage"
      id="drift-mutation"
      aria-labelledby="drift-mutation-title"
      {...target}
    >
      <StageHead
        n={5}
        id="drift-mutation-title"
        title="A mutation is proposed, not activated"
        lede="Recompiled from the old and the new traces, it swaps the fragile step for a robust one. It waits, with its evidence, for a human decision."
        state={
          info && proposal
            ? { label: info.label.toLowerCase(), tone: info.tone }
            : { label: 'none proposed', tone: 'ash' }
        }
        actions={
          <Button
            variant="forge"
            icon={<Sparkles size={14} />}
            data-testid="propose-mutation"
            loading={running}
            disabled={blocker !== null}
            {...(blocker ? { disabledReason: blocker } : {})}
            onClick={runPropose}
          >
            Propose a mutation
          </Button>
        }
      />
      <JobLine job={running ? (demoJob ?? follower.job) : null} />
      {(follower.failure ?? proposeError) ? (
        <p className="drift-error" role="alert">
          The mutation was not proposed: {follower.failure ?? proposeError}
        </p>
      ) : null}

      {origin ? (
        <p className="drift-origin">
          <GitPullRequestArrow size={14} aria-hidden="true" /> {versionLabel} is itself a mutation
          of v{origin.fromVersion} ({origin.status}).
        </p>
      ) : null}

      {proposal && info && regression ? (
        <article
          className="drift-mutation"
          data-testid="mutation-proposal"
          data-status={proposal.status}
          aria-label={`Mutation proposal from v${proposal.fromVersion} to v${proposal.toVersion}`}
        >
          <header className="drift-mutation__head">
            <p className="drift-mutation__versions mono">
              v{proposal.fromVersion}
              <ArrowRight size={16} aria-hidden="true" />v{proposal.toVersion}
            </p>
            <Chip
              tone={info.tone}
              variant={proposal.status === 'proposed' ? 'outline' : 'soft'}
              dashed={proposal.status === 'proposed'}
              data-testid="mutation-status"
            >
              {proposal.status}
            </Chip>
            <span className="faint">proposed {formatTimestamp(proposal.createdAt)}</span>
          </header>

          <p className="drift-mutation__notice" role="note">
            <Lock size={15} aria-hidden="true" />
            <span>
              <code>activated: {String(proposal.evidence.activated)}</code> {info.words}
            </span>
          </p>
          <p className="drift-mutation__reason">{proposal.reason}</p>

          <div
            className="drift-mutation__diff"
            data-pending={proposal.status === 'proposed' ? 'true' : undefined}
          >
            <p className="micro">Step changes</p>
            {proposal.diff.steps.length === 0 ? (
              <p className="faint">No step changed.</p>
            ) : (
              proposal.diff.steps.map((change) => (
                <div key={`${change.stepId}-${change.change}`} className="drift-diffstep">
                  <p className="drift-diffstep__title">
                    <span className="mono">{change.stepId}</span> {describeStepChange(change)}
                  </p>
                  {change.from ? <DiffLine sign="-">{change.from}</DiffLine> : null}
                  {change.to ? <DiffLine sign="+">{change.to}</DiffLine> : null}
                </div>
              ))
            )}
            <p className="micro">Assumptions the compiler recorded</p>
            {proposal.diff.assumptions.removed.length + proposal.diff.assumptions.added.length ===
            0 ? (
              <p className="faint">No assumption changed.</p>
            ) : (
              <>
                {proposal.diff.assumptions.removed.map((text) => (
                  <DiffLine key={`r-${text}`} sign="-">
                    {text}
                  </DiffLine>
                ))}
                {proposal.diff.assumptions.added.map((text) => (
                  <DiffLine key={`a-${text}`} sign="+">
                    {text}
                  </DiffLine>
                ))}
              </>
            )}
          </div>

          <div className="drift-mutation__evidence">
            <p className="micro">
              Regression evidence <Provenance kind="replay-measured" />
            </p>
            <p>
              <strong className="num">
                {regression.agreements} of {regression.runs}
              </strong>{' '}
              recorded traces reproduced (
              {regression.ratio === null ? 'no replay' : formatPct(regression.ratio, { digits: 0 })}
              ).{' '}
              {regression.groups
                .map((group) => `${group.agree} of ${group.total} on forge-ci ${group.env}`)
                .join(', ')}
              .
            </p>
            <ul className="drift-tape drift-tape--small" aria-hidden="true">
              {proposal.evidence.regression.items.map((item) => (
                <li
                  key={`${item.scenarioId}-${item.env}`}
                  data-agree={item.agree}
                  title={`${item.scenarioId} on forge-ci ${item.env}: ${item.agree ? 'agrees' : 'differs'}`}
                >
                  {item.agree ? (
                    <Check size={11} strokeWidth={2.5} />
                  ) : (
                    <X size={11} strokeWidth={2.5} />
                  )}
                </li>
              ))}
            </ul>
            <Summary
              caption="Regression replay per trace"
              description={`${plural(regression.runs, 'recorded trace')} were replayed against v${proposal.toVersion}: the ones from before and after the environment change.`}
              rows={proposal.evidence.regression.items}
              getRowId={(item) => `${item.scenarioId}-${item.env}`}
              columns={[
                { id: 's', header: 'Scenario', cell: (item) => item.scenarioId, mono: true },
                {
                  id: 'e',
                  header: 'Toolchain',
                  cell: (item) => `forge-ci ${item.env}`,
                  mono: true,
                },
                {
                  id: 'a',
                  header: 'Result',
                  cell: (item) => (item.agree ? 'reproduced' : 'differs'),
                },
              ]}
            />
          </div>

          <footer className="drift-mutation__actions">
            <Button
              variant="primary"
              icon={<Check size={14} />}
              data-testid="mutation-approve"
              disabled={approveBlocker !== null}
              {...(approveBlocker ? { disabledReason: approveBlocker } : {})}
              onClick={() => {
                setDecisionError(null);
                setDecision('approve');
              }}
            >
              Approve
            </Button>
            <Button
              variant="danger"
              icon={<X size={14} />}
              data-testid="mutation-reject"
              disabled={rejectBlocker !== null}
              {...(rejectBlocker ? { disabledReason: rejectBlocker } : {})}
              onClick={() => {
                setDecisionError(null);
                setDecision('reject');
              }}
            >
              Reject
            </Button>
            {proposal.status === 'proposed' ? (
              <span className="faint drift-mutation__who">
                {canDecide
                  ? 'Your decision is recorded in the audit log.'
                  : 'A reviewer or admin decides. You can read everything here.'}
              </span>
            ) : null}
          </footer>

          {proposal.status === 'approved' ? (
            <div className="drift-mutation__next" data-testid="mutation-next">
              <p className="micro">Where it goes</p>
              <p>
                v{proposal.toVersion} is a new candidate in{' '}
                {successor.data ? (
                  <StatusChip status={successor.data.status} />
                ) : (
                  'shadow validation'
                )}
                : it runs beside the baseline again and must pass the promotion gate, then a
                reviewer decides. It is not live.
              </p>
              <p className="drift-mutation__links">
                <Link to={reflexPath(proposal.toVersionId)}>Open v{proposal.toVersion}</Link>
                <Link to={shadowPath({ version: proposal.toVersionId })}>
                  Validate it in Shadow
                </Link>
              </p>
            </div>
          ) : null}

          <DecisionDrawer
            kind={decision}
            mutation={proposal}
            onClose={() => {
              setDecision(null);
            }}
            onConfirm={decide}
            pending={approve.isPending || reject.isPending}
            error={decisionError}
          />
        </article>
      ) : (
        <EmptyState
          compact
          icon={<Sparkles size={16} />}
          title="No mutation proposed"
          description={
            blocker && !hasProposed
              ? `${blocker} A proposal appears here with its diff and its regression evidence.`
              : 'Propose one: the compiler reads the old and the new traces and swaps the fragile step. Nothing is activated.'
          }
        />
      )}
    </section>
  );
}
