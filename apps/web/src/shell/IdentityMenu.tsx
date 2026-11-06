import { Check, ChevronDown, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { useLogin, useLogout, usePersonas } from '../api/hooks';
import { useAuth } from '../auth/useAuth';
import { loginPath } from '../routes';
import { Avatar, Button, Popover, RoleBadge, ROLE_META, useToast } from '../ui';

/**
 * The signed-in identity: role badge, what the role may do, a persona switcher in demo mode and
 * sign out. Switching persona resets every tenant-scoped cache, so nothing from the previous identity lingers.
 */
export function IdentityMenu() {
  const { user, isDemo } = useAuth();
  const { data: personaData } = usePersonas();
  const login = useLogin();
  const logout = useLogout();
  const navigate = useNavigate();
  const { toast } = useToast();
  if (!user) return null;

  const personas = isDemo ? (personaData?.personas ?? []) : [];
  const password = personaData?.passwordHint ?? null;
  const tenants = [...new Set(personas.map((persona) => persona.tenant.slug))];

  const switchTo = async (email: string, name: string, close: () => void) => {
    if (!password) return;
    try {
      const result = await login.mutateAsync({ email, password });
      close();
      toast({
        title: `Signed in as ${name}`,
        description: ROLE_META[result.user.role].summary,
        tone: 'success',
      });
    } catch (error) {
      toast({
        title: 'Could not switch persona',
        description: errorMessage(error),
        tone: 'danger',
      });
    }
  };

  const signOut = async () => {
    try {
      await logout.mutateAsync();
      void navigate(loginPath(), { replace: true });
    } catch (error) {
      toast({ title: 'Could not sign out', description: errorMessage(error), tone: 'danger' });
    }
  };

  return (
    <Popover
      label="Account"
      side="bottom"
      align="end"
      className="bf-identity-pop"
      content={({ close }) => (
        <div className="bf-identity">
          <div className="bf-identity__me">
            <Avatar name={user.displayName} role={user.role} size={40} />
            <div className="bf-identity__who">
              <p className="bf-identity__name">{user.displayName}</p>
              <p className="bf-identity__email mono">{user.email}</p>
              <p className="bf-identity__tenant">{user.tenant.name}</p>
            </div>
          </div>
          <div className="bf-identity__role">
            <RoleBadge role={user.role} />
            <p>{ROLE_META[user.role].summary}</p>
          </div>

          {personas.length > 0 ? (
            <section className="bf-identity__personas" aria-labelledby="persona-switch-title">
              <h3 id="persona-switch-title" className="micro">
                Switch persona · demo mode
              </h3>
              {tenants.map((tenant) => (
                <ul key={tenant} className="bf-identity__list">
                  {personas
                    .filter((persona) => persona.tenant.slug === tenant)
                    .map((persona) => {
                      const current = persona.email === user.email;
                      return (
                        <li key={persona.email}>
                          <button
                            type="button"
                            className="bf-persona"
                            data-testid={`identity-persona-${persona.email}`}
                            aria-current={current ? 'true' : undefined}
                            disabled={login.isPending}
                            onClick={() => {
                              if (!current)
                                void switchTo(persona.email, persona.displayName, close);
                            }}
                          >
                            <Avatar name={persona.displayName} role={persona.role} size={28} />
                            <span className="bf-persona__text">
                              <span className="bf-persona__name">
                                {persona.displayName}
                                <RoleBadge role={persona.role} />
                              </span>
                              <span className="bf-persona__tenant">{persona.tenant.name}</span>
                            </span>
                            {current ? (
                              <Check size={16} role="img" aria-label="Current persona" />
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                </ul>
              ))}
            </section>
          ) : null}

          <Button
            block
            icon={<LogOut size={15} />}
            loading={logout.isPending}
            data-testid="sign-out"
            onClick={() => {
              void signOut();
            }}
          >
            Sign out
          </Button>
        </div>
      )}
    >
      <button
        type="button"
        className="bf-identity__trigger"
        data-testid="identity-menu"
        aria-label={`Account menu: ${user.displayName}, ${ROLE_META[user.role].label}`}
      >
        <Avatar name={user.displayName} role={user.role} size={28} />
        <span className="bf-identity__trigger-text">
          <span className="bf-identity__trigger-name">{user.displayName}</span>
          <span className="bf-identity__trigger-role">{ROLE_META[user.role].label}</span>
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
    </Popover>
  );
}
