import type { ReflexStatus, Role } from '@bigforge/schemas';
import {
  Archive,
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  Eye,
  Hammer,
  Hourglass,
  KeyRound,
  Lock,
  Play,
  RotateCcw,
  ScanEye,
  Stamp,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Chip, type ChipProps } from './Chip';
import { cx } from './cx';
import { initials } from './formatters';
import { REFLEX_STATUS, ROLE_META } from './status';

const STATUS_ICON: Record<ReflexStatus, ReactNode> = {
  candidate: <CircleDashed size={12} />,
  replay: <RotateCcw size={12} />,
  shadow: <Eye size={12} />,
  approval: <Hourglass size={12} />,
  active: <Lock size={12} />,
  watch: <ScanEye size={12} />,
  recompile: <Hammer size={12} />,
  deprecated: <Ban size={12} />,
  retired: <Archive size={12} />,
};

export function StatusChip({
  status,
  ...rest
}: { status: ReflexStatus } & Omit<ChipProps, 'tone' | 'icon' | 'children' | 'dashed'>) {
  const meta = REFLEX_STATUS[status];
  return (
    <Chip
      tone={meta.tone}
      icon={STATUS_ICON[status]}
      dashed={meta.dashed}
      variant={status === 'active' ? 'soft' : 'outline'}
      title={meta.description}
      {...rest}
    >
      {meta.label}
    </Chip>
  );
}

const VERIFICATION = {
  pass: { label: 'Verified', tone: 'jade', icon: <CircleCheck size={12} />, dashed: false },
  fail: { label: 'Failed', tone: 'crimson', icon: <CircleX size={12} />, dashed: false },
  incomplete: { label: 'Incomplete', tone: 'ash', icon: <CircleDashed size={12} />, dashed: true },
} as const;

/** Objective verification result of a run. Always icon + text, never colour alone. */
export function VerificationChip({
  status,
  ...rest
}: { status: 'pass' | 'fail' | 'incomplete' } & Omit<
  ChipProps,
  'tone' | 'icon' | 'children' | 'dashed'
>) {
  const meta = VERIFICATION[status];
  return (
    <Chip tone={meta.tone} icon={meta.icon} dashed={meta.dashed} variant="outline" {...rest}>
      {meta.label}
    </Chip>
  );
}

const ROLE_ICON: Record<Role, ReactNode> = {
  viewer: <Eye size={12} />,
  operator: <Play size={12} />,
  reviewer: <Stamp size={12} />,
  admin: <KeyRound size={12} />,
};

export function RoleBadge({
  role,
  ...rest
}: { role: Role } & Omit<ChipProps, 'tone' | 'icon' | 'children'>) {
  const meta = ROLE_META[role];
  return (
    <Chip tone={meta.tone} icon={ROLE_ICON[role]} variant="outline" title={meta.summary} {...rest}>
      {meta.label}
    </Chip>
  );
}

/** Initials in a circle. The ring colour is the role's tone; the name is always printed next to it. */
export function Avatar({
  name,
  role,
  size = 32,
  className,
}: {
  name: string;
  role?: Role;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cx('bf-avatar', className)}
      data-tone={role ? ROLE_META[role].tone : 'neutral'}
      data-initials={initials(name)}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) }}
      aria-hidden="true"
    />
  );
}
