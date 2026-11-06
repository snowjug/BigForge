import { CircleCheck, CircleMinus, LogIn } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import type { PersonaDto, Role } from '@bigforge/schemas';
import { errorMessage } from '../api/client';
import { useLogin, usePersonas, useSession } from '../api/hooks';
import { type Action, can } from '../auth/rbac';
import { MotionToggle, ThemeToggle } from '../shell/Toggles';
import { FORGE_STAGES } from '../stages';
import { parseLoginParams, safeNext } from '../routes';
import {
  Avatar,
  Button,
  ErrorState,
  Field,
  ForgeLogo,
  RoleBadge,
  ROLE_META,
  Skeleton,
  SkeletonGroup,
  usePageTitle,
} from '../ui';
import '../styles/login.css';

/** The three capabilities that distinguish the roles most clearly. */
const HIGHLIGHTS: { action: Action; label: string }[] = [
  { action: 'run_task', label: 'Run tasks' },
  { action: 'promote', label: 'Promote Reflexes' },
  { action: 'manage_settings', label: 'Edit settings' },
];

function Capabilities({ role }: { role: Role }) {
  return (
    <ul className="login-persona__caps" aria-label={`What a ${role} can do`}>
      {HIGHLIGHTS.map(({ action, label }) => {
        const allowed = can(role, action);
        return (
          <li key={action} data-allowed={allowed}>
            {allowed ? (
              <CircleCheck size={13} aria-hidden="true" />
            ) : (
              <CircleMinus size={13} aria-hidden="true" />
            )}
            <span>
              {label}
              <span className="sr-only">{allowed ? ': allowed' : ': not allowed'}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PersonaCard({
  persona,
  busy,
  pending,
  current,
  onChoose,
}: {
  persona: PersonaDto;
  busy: boolean;
  pending: boolean;
  current: boolean;
  onChoose: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="login-persona"
        data-testid={`persona-${persona.email}`}
        data-tone={ROLE_META[persona.role].tone}
        disabled={busy}
        aria-busy={pending || undefined}
        onClick={onChoose}
      >
        <Avatar name={persona.displayName} role={persona.role} size={40} />
        <span className="login-persona__body">
          <span className="login-persona__head">
            <span className="login-persona__name">{persona.displayName}</span>
            <RoleBadge role={persona.role} />
            {current ? <span className="login-persona__current micro">Signed in</span> : null}
          </span>
          <span className="login-persona__email mono">{persona.email}</span>
          <span className="login-persona__blurb">{persona.blurb}</span>
          <Capabilities role={persona.role} />
        </span>
        <span className="login-persona__go" aria-hidden="true">
          <LogIn size={16} />
        </span>
      </button>
    </li>
  );
}

export default function LoginPage() {
  usePageTitle('Sign in');
  const [search] = useSearchParams();
  const { next } = parseLoginParams(search);
  const navigate = useNavigate();
  const session = useSession();
  const personas = usePersonas();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const user = session.data?.user ?? null;
  const hint = personas.data?.passwordHint ?? null;
  const people = personas.data?.personas ?? [];
  const tenants = [...new Set(people.map((persona) => persona.tenant.slug))];

  const attempt = async (credentials: { email: string; password: string }) => {
    setMessage(null);
    setPendingEmail(credentials.email);
    try {
      await login.mutateAsync(credentials);
      void navigate(safeNext(next) ?? '/', { replace: true });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPendingEmail(null);
    }
  };

  // Landing here already signed in from a protected link: carry on.
  if (user && next) return <Navigate to={safeNext(next) ?? '/'} replace />;

  return (
    <div className="login">
      <div className="login__tools">
        <ThemeToggle />
        <MotionToggle />
      </div>
      <main id="main" className="login__main">
        <section className="login__story" aria-labelledby="login-title">
          <ForgeLogo size={34} wordmark />
          <h1 id="login-title" className="login__headline">
            Forge reasoning once.
            <span>Reuse it without paying to rethink it.</span>
          </h1>
          <p className="login__lede">
            BigForge learns executable <strong>Reflexes</strong> from repeated agent traces,
            validates them against the AI, lets a human promote them, and calls a model only at the
            edge of uncertainty, through a Token Firewall.
          </p>
          <ol className="login__loop" aria-label="The BigForge loop">
            {FORGE_STAGES.map((stage, index) => (
              <li key={stage.id} data-stage={stage.id}>
                <span className="login__loop-index mono" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="login__loop-name">{stage.label}</span>
                <span className="login__loop-sum">{stage.summary}</span>
              </li>
            ))}
          </ol>
          <p className="login__honesty">
            {session.data?.mode === 'production' ? (
              <>
                <strong>Every figure carries a provenance label.</strong> Measured, estimated,
                synthetic and simulated numbers are marked as such, so what was observed is never
                confused with what was assumed.
              </>
            ) : (
              <>
                <strong>This is a synthetic, offline demonstration.</strong> A deterministic
                provider plays the model, so nothing leaves your machine and no model is called.
                Every figure in the product carries a provenance label.
              </>
            )}
          </p>
        </section>

        <section className="login__panel" aria-labelledby="signin-title">
          <h2 id="signin-title" className="login__title">
            Sign in
          </h2>
          {user ? (
            <p className="login__already" role="status">
              You are signed in as <strong>{user.displayName}</strong> ({ROLE_META[user.role].label}
              ). <Link to="/">Continue to the Forge Floor</Link> or choose another identity.
            </p>
          ) : null}

          {message ? (
            <div role="alert" className="login__alert" data-testid="login-error">
              {message}
            </div>
          ) : null}

          {personas.isPending ? (
            <SkeletonGroup label="Loading demo identities" className="login__people">
              {[0, 1, 2].map((key) => (
                <Skeleton key={key} height={96} radius={8} />
              ))}
            </SkeletonGroup>
          ) : personas.isError ? (
            <ErrorState
              compact
              title="Demo identities could not be loaded"
              error={personas.error}
              onRetry={() => {
                void personas.refetch();
              }}
            />
          ) : people.length > 0 ? (
            <>
              <p className="login__hint">
                Demo mode. Choose an identity to see exactly what each role can do. Roles are
                enforced by the server, not just hidden in the interface.
              </p>
              <div className="login__people">
                {tenants.map((tenant) => (
                  <ul key={tenant} className="login__list">
                    {people
                      .filter((persona) => persona.tenant.slug === tenant)
                      .map((persona) => (
                        <PersonaCard
                          key={persona.email}
                          persona={persona}
                          busy={login.isPending || hint === null}
                          pending={pendingEmail === persona.email}
                          current={user?.email === persona.email}
                          onChoose={() => {
                            if (hint) void attempt({ email: persona.email, password: hint });
                          }}
                        />
                      ))}
                  </ul>
                ))}
              </div>
            </>
          ) : null}

          <form
            className="login__form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!email.trim() || !password) {
                setMessage('Enter your email address and password.');
                return;
              }
              void attempt({ email: email.trim(), password });
            }}
          >
            <h3 className="login__form-title micro">
              {people.length > 0 ? 'Or sign in with credentials' : 'Credentials'}
            </h3>
            <Field label="Email">
              {(control) => (
                <input
                  {...control}
                  className="bf-input"
                  type="email"
                  data-testid="login-email"
                  autoComplete="username"
                  value={email}
                  aria-invalid={message ? true : undefined}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                />
              )}
            </Field>
            <Field label="Password" {...(hint ? { help: `Demo password: ${hint}` } : {})}>
              {(control) => (
                <input
                  {...control}
                  className="bf-input"
                  type="password"
                  data-testid="login-password"
                  autoComplete="current-password"
                  value={password}
                  aria-invalid={message ? true : undefined}
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              data-testid="login-submit"
              loading={login.isPending && pendingEmail === email.trim()}
              disabled={login.isPending}
            >
              Sign in
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
