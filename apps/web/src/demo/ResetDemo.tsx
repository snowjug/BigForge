import { RotateCcw } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useAuth } from '../auth/useAuth';
import { Button, Popover, useToast } from '../ui';
import { useDemo } from './useDemo';

interface ResetDemoProps {
  /** `button` is the bare control; `section` adds the explanation used on the Settings page. */
  variant?: 'button' | 'section';
  size?: 'md' | 'lg';
}

/**
 * Admin-only demo reset with an explicit confirmation. It recreates the database and starts a new audit
 * chain (which records the previous chain head), so it is never one click away from a mistake.
 */
export function ResetDemo({ variant = 'button', size = 'md' }: ResetDemoProps) {
  const demo = useDemo();
  const auth = useAuth();
  const { toast } = useToast();
  const allowed = auth.can('reset_demo');
  if (!demo.available) return null;

  const control = (
    <Popover
      label="Confirm demo reset"
      side="bottom"
      align="start"
      className="bf-confirm-pop"
      content={({ close }) => (
        <div className="stack" style={{ '--gap': '12px' } as CSSProperties}>
          <p>
            <strong>Reset the demo?</strong>
          </p>
          <p className="dim">
            This recreates the database. Every task, trace, Reflex and approval is erased and a new
            audit chain begins; it records the previous chain head.
          </p>
          <div className="cluster">
            <Button
              variant="danger"
              icon={<RotateCcw size={14} />}
              loading={demo.busy}
              data-testid="reset-demo-confirm"
              onClick={() => {
                void demo.reset().then(() => {
                  close();
                  toast({
                    title: 'Demo reset',
                    description: 'The database is empty and a new audit chain has started.',
                    tone: 'success',
                  });
                });
              }}
            >
              Reset demo
            </Button>
            <Button onClick={close}>Cancel</Button>
          </div>
        </div>
      )}
    >
      <Button
        size={size}
        icon={<RotateCcw size={15} />}
        disabled={!allowed}
        data-testid="reset-demo"
        {...(!allowed ? { disabledReason: 'Only an admin can reset the demo.' } : {})}
      >
        Reset demo
      </Button>
    </Popover>
  );

  if (variant === 'button') return control;
  return (
    <div className="bf-reset">
      <div className="bf-reset__text">
        <p className="bf-reset__title">Reset the demo</p>
        <p className="dim">
          Recreates the database and starts a new audit chain. Use it to rehearse the guided demo
          from a clean slate.
          {allowed ? '' : ' Only an admin can do this.'}
        </p>
      </div>
      {control}
    </div>
  );
}
