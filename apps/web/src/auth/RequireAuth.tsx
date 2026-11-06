import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../api/hooks';
import { loginPath } from '../routes';
import { ErrorState, ForgeLogo, Spinner } from '../ui';

function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="bf-splash">
      <ForgeLogo size={40} wordmark />
      {children}
    </div>
  );
}

/**
 * The authentication gate. Reads `GET /api/auth/me`; signed-out users are sent to /login and come
 * back to where they were (`?next=`). A 401 anywhere in the app flips the cached session to signed-out,
 * which lands here too.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    return (
      <Splash>
        <p className="bf-splash__status">
          <Spinner size={16} label="Reading your session" /> Reading your session…
        </p>
      </Splash>
    );
  }
  if (session.isError) {
    return (
      <Splash>
        <div className="bf-splash__error">
          <ErrorState
            title="BigForge could not be reached"
            error={session.error}
            onRetry={() => {
              void session.refetch();
            }}
            retrying={session.isFetching}
          />
        </div>
      </Splash>
    );
  }
  if (!session.data.user) {
    return <Navigate to={loginPath(`${location.pathname}${location.search}`)} replace />;
  }
  return <>{children}</>;
}
