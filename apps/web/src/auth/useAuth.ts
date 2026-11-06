import type { Role, SessionUser } from '@bigforge/schemas';
import { useSession } from '../api/hooks';
import { type Action, can } from './rbac';

export interface Auth {
  user: SessionUser | null;
  role: Role | null;
  /** 'demo' enables the persona switcher and the shared demo password. */
  mode: 'demo' | 'production';
  isDemo: boolean;
  /** Whether the session is still being read. */
  isLoading: boolean;
  /** Mirrors the server's role matrix to decide which controls to offer. The server still enforces it. */
  can: (action: Action) => boolean;
}

export function useAuth(): Auth {
  const { data, isPending } = useSession();
  const user = data?.user ?? null;
  const role = user?.role ?? null;
  const mode = data?.mode ?? 'demo';
  return {
    user,
    role,
    mode,
    isDemo: mode === 'demo',
    isLoading: isPending,
    can: (action) => can(role, action),
  };
}
