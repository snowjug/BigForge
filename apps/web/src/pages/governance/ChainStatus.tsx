import { Lock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useAudit, useVerifyAudit } from '../../api/hooks';
import { useNow } from '../../hooks/useNow';
import { Button, Chip, ErrorState, formatCount, relativeTime, shortHash } from '../../ui';

/**
 * The always-visible integrity strip: how many events the chain holds, its head, and a Verify button
 * that makes the server recompute every link. The result stays visible and says how stale it is.
 */
export function ChainStatus() {
  const audit = useAudit({ limit: 1 });
  const verify = useVerifyAudit();
  const now = useNow();
  const total = audit.data?.total;
  const head = audit.data?.items[0]?.hash;
  const result = verify.data;
  const newer = result && total !== undefined ? Math.max(0, total - result.count) : 0;

  return (
    <section className="gov-chain" aria-label="Audit chain integrity">
      <div className="gov-chain__facts">
        <div>
          <p className="micro">Audit chain</p>
          <p className="gov-chain__count num">
            {total === undefined ? '\u2014' : formatCount(total)}{' '}
            <span>{total === 1 ? 'event' : 'events'}</span>
          </p>
        </div>
        <div>
          <p className="micro">Head hash</p>
          <p className="gov-chain__hash mono" title={head}>
            {head ? shortHash(head, 16, { ellipsis: true }) : '\u2014'}
          </p>
        </div>
        <p className="gov-chain__how">
          Each event’s hash covers its own content and the previous hash, so changing any past event
          breaks every later one. Verify recomputes the whole chain on the server.
        </p>
      </div>

      <div className="gov-chain__verify">
        <Button
          variant="primary"
          icon={<ShieldCheck size={15} />}
          loading={verify.isPending}
          data-testid="verify-chain"
          onClick={() => {
            verify.mutate();
          }}
        >
          Verify chain
        </Button>
        <div aria-live="polite" className="gov-chain__result" data-testid="verify-chain-result">
          {result ? (
            result.ok ? (
              <>
                <Chip tone="jade" variant="soft" icon={<Lock size={12} />}>
                  Chain intact · {formatCount(result.count)} events verified
                </Chip>
                <span className="gov-chain__meta">
                  Verified {relativeTime(verify.submittedAt, now)}
                  {newer > 0
                    ? `. ${formatCount(newer)} newer ${newer === 1 ? 'event' : 'events'} since.`
                    : '.'}
                </span>
              </>
            ) : (
              <>
                <Chip tone="crimson" variant="solid" icon={<ShieldAlert size={12} />}>
                  Chain broken at event #{result.brokenAtSeq ?? '?'}
                </Chip>
                <span className="gov-chain__meta">
                  Every event from #{result.brokenAtSeq ?? '?'} on can no longer be trusted.
                </span>
              </>
            )
          ) : null}
          {verify.isError ? (
            <ErrorState compact title="Verification failed" error={verify.error} />
          ) : null}
        </div>
      </div>
    </section>
  );
}
