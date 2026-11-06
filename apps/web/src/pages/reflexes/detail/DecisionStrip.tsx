import type { ReflexVersionDto } from '@bigforge/schemas';
import { Ban, Eye, RotateCcw, Stamp, Undo2 } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../../../api/client';
import {
  usePromoteVersion,
  useRejectVersion,
  useReplayVersion,
  useRollbackVersion,
} from '../../../api/hooks';
import { useAuth } from '../../../auth/useAuth';
import { useDemoTarget } from '../../../demo/useDemo';
import { governancePath, shadowPath } from '../../../routes';
import { Button, Chip, REFLEX_STATUS, formatPct, plural, useToast } from '../../../ui';
import { type ActionId, actionStates } from '../actions';
import { summariseGate } from '../gate';
import { eventLabel } from '../lifecycle';
import { ConfidenceBar, GateChecklist, IntegrityChip } from '../parts';
import { ConfirmDialog } from './ConfirmDialog';

type DialogKind = 'promote' | 'reject' | 'rollback';

interface Copy {
  eyebrow: string;
  headline: string;
  detail: string;
}

/** What the Reflex is waiting for, in one sentence, from its status and its evidence. */
function decisionCopy(version: ReflexVersionDto): Copy {
  const gate = summariseGate(version.gate);
  const returned = version.transitions.some((t) => t.event === 'drift_confirmed');
  switch (version.status) {
    case 'candidate':
      return {
        eyebrow: 'Next step',
        headline: 'Candidate: compiled, not yet validated',
        detail: `It cannot run live. Replay it against the ${plural(version.spec.provenance.sourceTraceIds.length, 'trace')} it was compiled from; every one must reproduce.`,
      };
    case 'replay':
      return {
        eyebrow: 'In progress',
        headline: 'Replaying the recorded tasks',
        detail:
          'The candidate is re-executing each source task in the sandbox. It moves to Shadow when every trace reproduces.',
      };
    case 'shadow':
      return {
        eyebrow: returned ? 'Back in Shadow' : 'Next step',
        headline: returned
          ? 'Returned to Shadow after drift'
          : 'In Shadow: earning trust beside the baseline',
        detail: returned
          ? 'It no longer executes live. It earns trust again by agreeing with the baseline: run Shadow Brain, and when the gate holds on fresh evidence it returns to a reviewer.'
          : gate.eligible
            ? 'The recorded evidence satisfies the gate.'
            : `${gate.headline} Run Shadow Brain on the held-out tasks to gather the missing evidence.`,
      };
    case 'approval':
      return {
        eyebrow: 'Human decision',
        headline: 'Awaiting a reviewer',
        detail: `The evidence gate passed (${gate.passed} of ${gate.total}). Promotion is never automatic: a reviewer inspects the evidence and decides whether this Reflex may execute live.`,
      };
    case 'active':
      return {
        eyebrow: 'Live',
        headline: 'Active: executing for new tasks of its family',
        detail: `Known steps run locally with no model call; an unresolved decision crosses the Token Firewall. Confidence ${formatPct(version.confidence, { digits: 0 })}. The Drift Canary can demote it automatically.`,
      };
    case 'watch':
      return {
        eyebrow: 'Under observation',
        headline: 'On watch: trust is slipping',
        detail:
          'It still runs, under closer observation. Confirmed drift returns it to Shadow automatically.',
      };
    case 'recompile':
      return {
        eyebrow: 'Needs a new version',
        headline: 'Persistent disagreement',
        detail: 'This version cannot run again. Compile a new version from the task family.',
      };
    case 'deprecated':
      return {
        eyebrow: 'Out of service',
        headline: 'Deprecated',
        detail: 'Superseded, rejected or rolled back. It will not run.',
      };
    case 'retired':
      return { eyebrow: 'End of life', headline: 'Retired', detail: 'This version is archived.' };
  }
}

function PromoteBody({
  version,
  comment,
  onComment,
}: {
  version: ReflexVersionDto;
  comment: string;
  onComment: (value: string) => void;
}) {
  const { replay, shadow } = version;
  return (
    <div className="stack" style={{ '--gap': '16px' } as CSSProperties}>
      <section aria-label="Evidence summary" className="rfx-evidence">
        <p className="micro">Evidence you are approving</p>
        <GateChecklist gate={version.gate} variant="compact" />
        <dl className="rfx-evidence__facts">
          <div>
            <dt>Replay</dt>
            <dd className="num">
              {replay.agreements} of {replay.runs} source traces reproduced
            </dd>
          </div>
          <div>
            <dt>Shadow Brain</dt>
            <dd className="num">
              {shadow.agreements} of {shadow.runs} agree with the baseline across{' '}
              {plural(shadow.distinctVariants, 'variant')},{' '}
              {plural(shadow.safetyViolations, 'safety violation')}
            </dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>
              <ConfidenceBar trust={version.trust} withProvenance />
            </dd>
          </div>
          <div>
            <dt>Integrity</dt>
            <dd>
              <IntegrityChip integrity={version.integrity} />
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label="What promotion does" className="rfx-does">
        <p className="micro">What promoting does</p>
        <ul>
          <li>
            <strong>It will execute live.</strong> From now on this Reflex handles new tasks of its
            family on its own. Known steps run locally with zero model calls; only an unresolved
            decision crosses the Token Firewall.
          </li>
          <li>
            <strong>It is recorded.</strong> The decision, your name, the time, your comment and
            this evidence go into the hash-chained audit log.
          </li>
          <li>
            <strong>It can be demoted automatically.</strong> If the Drift Canary confirms
            disagreement it returns to Shadow without anyone clicking.
          </li>
          <li>
            <strong>You can undo it.</strong> A reviewer can roll it back at any time.
          </li>
        </ul>
      </section>

      <div className="bf-field">
        <label className="bf-label" htmlFor="rfx-promote-comment">
          Comment for the audit log <span className="faint">(optional)</span>
        </label>
        <textarea
          id="rfx-promote-comment"
          className="bf-textarea"
          rows={3}
          maxLength={1000}
          value={comment}
          placeholder="What did you check before approving?"
          onChange={(event) => {
            onComment(event.target.value);
          }}
        />
        <p className="bf-help num">{comment.length} / 1000</p>
      </div>
    </div>
  );
}

interface Props {
  version: ReflexVersionDto;
  /** Called after a human decision lands, so the page can move focus to the updated status. */
  onDecided?: () => void;
}

/**
 * The decision strip: what this Reflex is waiting for, and the actions the server allows this user.
 * Promotion is the human step: it opens a confirmation that shows the evidence and says what it does.
 */
export function DecisionStrip({ version, onDecided }: Props) {
  const target = useDemoTarget('promote');
  const auth = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const replay = useReplayVersion();
  const promote = usePromoteVersion();
  const reject = useRejectVersion();
  const rollback = useRollbackVersion();
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [comment, setComment] = useState('');

  const meta = REFLEX_STATUS[version.status];
  const copy = decisionCopy(version);
  const states = actionStates({
    status: version.status,
    actions: version.actions,
    gate: version.gate,
    integrityOk: version.integrity.ok,
    role: auth.role,
  });
  const label = `${version.name} v${version.version}`;

  const open = (kind: DialogKind) => {
    setComment('');
    promote.reset();
    reject.reset();
    rollback.reset();
    setDialog(kind);
  };
  const close = () => {
    setDialog(null);
  };

  const decide = async (kind: DialogKind) => {
    try {
      if (kind === 'promote') {
        await promote.mutateAsync({ versionId: version.id, comment });
        toast({
          title: `Promoted: ${label} is now Active`,
          description: `Recorded in the audit log${auth.user ? ` by ${auth.user.displayName}` : ''}. It executes live for new tasks of its family and returns to Shadow automatically if drift is confirmed.`,
          tone: 'success',
          action: {
            label: 'View audit log',
            onClick: () => {
              void navigate(governancePath({ tab: 'audit' }));
            },
          },
        });
      } else if (kind === 'reject') {
        await reject.mutateAsync({ versionId: version.id, comment });
        toast({
          title: `Rejected: ${label} returns to Shadow`,
          description: 'It keeps running beside the baseline. The decision is in the audit log.',
          tone: 'info',
        });
      } else {
        await rollback.mutateAsync({ versionId: version.id, comment });
        toast({
          title: `Rolled back: ${label} is out of service`,
          description:
            'New tasks of its family go to the baseline agent. The decision is in the audit log.',
          tone: 'warning',
        });
      }
      close();
      // After the dialog has returned focus, move it to the updated status.
      window.requestAnimationFrame(() => {
        onDecided?.();
      });
    } catch {
      // The mutation keeps the error; the dialog shows it next to the retry.
    }
  };

  const onReplay = async () => {
    try {
      const result = await replay.mutateAsync(version.id);
      toast({
        title: `Replay finished: ${result.replay.agreements} of ${result.replay.runs} traces reproduced`,
        description:
          result.status === 'shadow'
            ? 'It is now in Shadow. Run Shadow Brain to gather the rest of the evidence.'
            : 'It stays a candidate until every trace reproduces.',
        tone: result.status === 'shadow' ? 'success' : 'warning',
      });
    } catch (error) {
      toast({ title: 'Replay failed', description: errorMessage(error), tone: 'danger' });
    }
  };

  const button = (
    id: ActionId,
    props: {
      label: string;
      testId: string;
      icon: ReactNode;
      variant?: 'primary' | 'ghost' | 'danger' | 'forge';
      onClick: () => void;
      loading?: boolean;
    },
  ) => {
    const state = states[id];
    return (
      <Button
        key={id}
        variant={props.variant ?? 'ghost'}
        icon={props.icon}
        data-testid={props.testId}
        loading={props.loading ?? false}
        disabled={!state.available}
        {...(!state.available && state.reason ? { disabledReason: state.reason } : {})}
        onClick={props.onClick}
      >
        {props.label}
      </Button>
    );
  };

  const showPromote = ['candidate', 'replay', 'shadow', 'approval'].includes(version.status);
  const lastTransition = version.transitions[version.transitions.length - 1];

  return (
    <section
      {...target}
      className="rfx-decision"
      data-tone={meta.tone}
      aria-label="Decision"
      data-testid="decision-strip"
    >
      <div className="rfx-decision__text">
        <p className="micro">{copy.eyebrow}</p>
        <h2 className="rfx-decision__headline">{copy.headline}</h2>
        <p className="rfx-decision__detail" aria-live="polite">
          {copy.detail}
        </p>
        {lastTransition ? (
          <p className="rfx-decision__last">
            Last change: {eventLabel(lastTransition.event).toLowerCase()} by {lastTransition.actor}
            {lastTransition.reason ? ` \u2014 ${lastTransition.reason}` : ''}
          </p>
        ) : null}
      </div>
      <div className="rfx-decision__actions">
        {version.status === 'candidate'
          ? button('replay', {
              label: 'Replay the source traces',
              testId: 'detail-replay',
              icon: <RotateCcw size={15} />,
              variant: 'forge',
              loading: replay.isPending,
              onClick: () => {
                void onReplay();
              },
            })
          : null}
        {version.status === 'shadow'
          ? button('shadow', {
              label: 'Run Shadow Brain',
              testId: 'detail-shadow',
              icon: <Eye size={15} />,
              variant: 'forge',
              onClick: () => {
                void navigate(shadowPath({ version: version.id }));
              },
            })
          : null}
        {version.status === 'approval'
          ? button('reject', {
              label: 'Reject',
              testId: 'reject-button',
              icon: <Undo2 size={15} />,
              onClick: () => {
                open('reject');
              },
            })
          : null}
        {showPromote
          ? button('promote', {
              label: 'Promote…',
              testId: 'promote-button',
              icon: <Stamp size={15} />,
              variant: 'primary',
              onClick: () => {
                open('promote');
              },
            })
          : null}
        {version.status === 'active' || version.status === 'watch'
          ? button('rollback', {
              label: 'Roll back',
              testId: 'rollback-button',
              icon: <Ban size={15} />,
              variant: 'danger',
              onClick: () => {
                open('rollback');
              },
            })
          : null}
        {!states.promote.available && showPromote && auth.role !== null && !auth.can('promote') ? (
          <Chip tone="ash" variant="outline" size="sm">
            Reviewer decision
          </Chip>
        ) : null}
      </div>

      <ConfirmDialog
        open={dialog === 'promote'}
        onClose={close}
        onConfirm={() => {
          void decide('promote');
        }}
        title={`Promote ${label} to Active?`}
        description="This is the human decision that lets a Reflex act on its own."
        confirmLabel="Promote to Active"
        confirmIcon={<Stamp size={15} />}
        busy={promote.isPending}
        error={promote.error}
        testId="promote-dialog"
        confirmTestId="promote-confirm"
      >
        <PromoteBody version={version} comment={comment} onComment={setComment} />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'reject'}
        onClose={close}
        onConfirm={() => {
          void decide('reject');
        }}
        title={`Reject ${label}?`}
        description="Rejecting returns the Reflex to Shadow. It does not delete anything."
        confirmLabel="Return to Shadow"
        confirmVariant="primary"
        confirmIcon={<Undo2 size={15} />}
        busy={reject.isPending}
        error={reject.error}
        testId="reject-dialog"
        confirmTestId="reject-confirm"
      >
        <CommentBody
          id="rfx-reject-comment"
          comment={comment}
          onComment={setComment}
          prompt="What evidence is missing?"
        >
          <p className="dim">
            It keeps running beside the baseline agent and must earn approval again. Your decision
            and comment are recorded in the audit log.
          </p>
        </CommentBody>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'rollback'}
        onClose={close}
        onConfirm={() => {
          void decide('rollback');
        }}
        title={`Roll back ${label}?`}
        description="Rolling back takes this Reflex out of service."
        confirmLabel="Roll back"
        confirmVariant="danger"
        confirmIcon={<Ban size={15} />}
        busy={rollback.isPending}
        error={rollback.error}
        testId="rollback-dialog"
        confirmTestId="rollback-confirm"
      >
        <CommentBody
          id="rfx-rollback-comment"
          comment={comment}
          onComment={setComment}
          prompt="Why is it being rolled back?"
        >
          <p className="dim">
            It becomes deprecated and no longer executes. New tasks of its family go to the baseline
            agent again. Your decision and comment are recorded in the audit log.
          </p>
        </CommentBody>
      </ConfirmDialog>
    </section>
  );
}

function CommentBody({
  id,
  comment,
  onComment,
  prompt,
  children,
}: {
  id: string;
  comment: string;
  onComment: (value: string) => void;
  prompt: string;
  children: ReactNode;
}) {
  return (
    <div className="stack" style={{ '--gap': '16px' } as CSSProperties}>
      {children}
      <div className="bf-field">
        <label className="bf-label" htmlFor={id}>
          Comment for the audit log <span className="faint">(optional)</span>
        </label>
        <textarea
          id={id}
          className="bf-textarea"
          rows={3}
          maxLength={1000}
          value={comment}
          placeholder={prompt}
          onChange={(event) => {
            onComment(event.target.value);
          }}
        />
        <p className="bf-help num">{comment.length} / 1000</p>
      </div>
    </div>
  );
}
