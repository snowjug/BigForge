import { Lock, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { type CSSProperties, type FormEvent, type ReactNode, useState } from 'react';
import type { SettingsDto, SystemDto } from '@bigforge/schemas';
import { ApiError, errorMessage } from '../api/client';
import { useLogin, usePersonas, useSettings, useSystem, useUpdateSettings } from '../api/hooks';
import { useAuth } from '../auth/useAuth';
import { ResetDemo } from '../demo/ResetDemo';
import { useNow } from '../hooks/useNow';
import {
  Button,
  Chip,
  ErrorState,
  Field,
  Page,
  PageHeader,
  Panel,
  Provenance,
  RoleBadge,
  Section,
  Skeleton,
  SkeletonGroup,
  Switch,
  formatTimestamp,
  relativeTime,
  useToast,
} from '../ui';
import type { ProvenanceKind } from '../ui/provenance';
import {
  type FieldErrors,
  type FieldKey,
  type SettingsForm,
  serverFieldErrors,
  toForm,
  validateForm,
} from './settings/validate';
import '../styles/settings.css';

/* ------------------------------------------------------------------------------------------------
 * What is real
 * ---------------------------------------------------------------------------------------------- */

interface FigureRow {
  id: string;
  figure: string;
  kind: ProvenanceKind;
  why: string;
}

function figureRows(system: SystemDto): FigureRow[] {
  const live = system.provider.mode === 'live';
  return [
    {
      id: 'tokens',
      figure: 'Token counts',
      kind: live ? 'measured' : 'synthetic',
      why: live
        ? 'Reported by the live provider for each call.'
        : 'The deterministic provider stands in for a model and counts tokens with a documented estimator (about four characters per token).',
    },
    {
      id: 'latency',
      figure: 'Model latency',
      kind: live ? 'measured' : 'simulated',
      why: live
        ? 'Wall-clock time of the provider call.'
        : 'Computed from a documented token-based latency model. It is never presented as measured.',
    },
    {
      id: 'local',
      figure: 'Local command time',
      kind: 'measured',
      why: 'Wall-clock time around each sandboxed process the Reflex or the baseline spawned.',
    },
    {
      id: 'cost',
      figure: 'Model cost',
      kind: 'estimated',
      why: 'Tokens multiplied by the price assumption below. A price sheet is a choice, not a fact.',
    },
    {
      id: 'savings',
      figure: 'Tokens avoided and ROI',
      kind: 'estimated',
      why: 'Counterfactual: what the baseline would have spent. It becomes a measurement only when a baseline reference run exists for the same task.',
    },
    {
      id: 'agreement',
      figure: 'Replay and canary agreement',
      kind: 'replay-measured',
      why: 'Measured by re-running recorded or familiar tasks against the Reflex and comparing outcomes.',
    },
  ];
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="set-fact">
      <dt className="micro">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function WhatIsReal() {
  const query = useSystem();
  const now = useNow();
  const system = query.data;

  if (query.isPending) {
    return (
      <SkeletonGroup label="Loading the provider status" className="stack">
        <Skeleton height={120} radius={8} />
        <Skeleton height={180} radius={8} />
      </SkeletonGroup>
    );
  }
  if (query.isError || !system) {
    return (
      <ErrorState
        title="The provider status could not be loaded"
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
        retrying={query.isFetching}
      />
    );
  }

  const live = system.provider.mode === 'live';
  return (
    <div className="set-real">
      <div className="set-real__lead" data-mode={live ? 'live' : 'deterministic'}>
        <Chip tone={live ? 'ember' : 'steel'} variant="outline">
          {live ? 'Live provider' : 'Deterministic provider · synthetic'}
        </Chip>
        <h3 className="set-real__headline">
          {live ? 'A real model is being called.' : 'No model is called.'}
        </h3>
        {system.provider.notes.map((note) => (
          <p key={note} className="set-real__note">
            {note}
          </p>
        ))}
        {!live && system.provider.liveConfigured ? (
          <p className="set-real__note">
            A live provider is configured ({system.provider.liveKind ?? 'unknown'}) but not
            selected.
          </p>
        ) : null}
        <p className="set-real__note">
          Deterministic activity is never called a “model call” without the word deterministic or
          synthetic next to it.
        </p>
      </div>

      <dl className="set-facts">
        <Fact label="Provider">
          <span className="mono">{system.provider.id}</span>
        </Fact>
        <Fact label="Deployment mode">{system.mode === 'demo' ? 'Demo' : 'Production'}</Fact>
        <Fact label="Live provider configured">
          {system.provider.liveConfigured ? 'Yes' : 'No'}
        </Fact>
        <Fact label="Application">
          BigForge <span className="mono">{system.version}</span> on Node{' '}
          <span className="mono">{system.node}</span>
        </Fact>
        <Fact label="Toolchain (synthetic lab)">
          <span className="mono">forge-ci {system.environment.toolchainVersion}</span>
        </Fact>
        <Fact label="Azure">
          <Chip tone="ash" variant="outline" dashed size="sm">
            Not deployed
          </Chip>{' '}
          <span className="set-fact__note">{system.claims.note}</span>
        </Fact>
      </dl>

      <div className="set-real__table">
        <h3 className="set-subhead" id="set-legend-title">
          What each number is
        </h3>
        <ul className="set-legend" aria-labelledby="set-legend-title">
          {figureRows(system).map((row) => (
            <li key={row.id} className="set-legend__row">
              <strong className="set-legend__figure">{row.figure}</strong>
              <Provenance kind={row.kind} />
              <span className="set-legend__why">{row.why}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="set-real__pricing">
        <h3 className="set-subhead">Pricing is an assumption</h3>
        <dl className="set-facts set-facts--tight">
          <Fact label="Price sheet">
            <span className="mono">{system.pricing.id}</span>
          </Fact>
          <Fact label="Assumed at">
            <span className="mono">{formatTimestamp(system.pricing.assumedAt)}</span>{' '}
            <span className="set-fact__note">({relativeTime(system.pricing.assumedAt, now)})</span>
          </Fact>
          <Fact label="Source">
            <Chip tone="amber" variant="outline" size="sm" dashed={false}>
              {system.pricing.source}
            </Chip>
          </Fact>
          <Fact label="Note">{system.pricing.note}</Fact>
        </dl>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Settings forms
 * ---------------------------------------------------------------------------------------------- */

interface NumberFieldProps {
  field: FieldKey;
  label: string;
  help: string;
  suffix?: string;
  value: string;
  error: string | undefined;
  readOnly: boolean;
  onChange: (value: string) => void;
}

function NumberField({
  field,
  label,
  help,
  suffix,
  value,
  error,
  readOnly,
  onChange,
}: NumberFieldProps) {
  return (
    <Field label={label} help={help} error={error}>
      {(control) => (
        <div className="bf-input-suffix">
          <input
            {...control}
            className="bf-input num"
            inputMode="decimal"
            name={field}
            value={value}
            readOnly={readOnly}
            aria-readonly={readOnly || undefined}
            onChange={(event) => {
              onChange(event.target.value);
            }}
          />
          {suffix ? <span className="bf-input-suffix__unit">{suffix}</span> : null}
        </div>
      )}
    </Field>
  );
}

function SettingsEditor({ initial, canEdit }: { initial: SettingsDto; canEdit: boolean }) {
  const update = useUpdateSettings();
  const { toast } = useToast();
  const baseline = toForm(initial);
  const [form, setForm] = useState<SettingsForm>(baseline);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const readOnly = !canEdit;
  const patch = <G extends keyof SettingsForm>(group: G, values: Partial<SettingsForm[G]>) => {
    setForm((current) => ({ ...current, [group]: { ...current[group], ...values } }));
  };
  const text = (field: FieldKey): string | undefined => errors[field];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(null);
    const result = validateForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      const first = Object.keys(result.errors)[0];
      document.querySelector<HTMLElement>(`[name="${first ?? ''}"]`)?.focus();
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync(result.value);
      toast({
        title: 'Settings saved',
        description: 'The gate, drift and economics now use these values.',
        tone: 'success',
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400)
        setErrors(serverFieldErrors(error.details));
      setFailure(errorMessage(error));
    }
  };

  const errorCount = Object.keys(errors).length;

  return (
    <form
      className="set-form"
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label="Settings"
    >
      {errorCount > 0 ? (
        <div role="alert" className="set-alert">
          {errorCount === 1 ? '1 field needs attention.' : `${errorCount} fields need attention.`}
        </div>
      ) : null}
      {failure && errorCount === 0 ? (
        <div role="alert" className="set-alert">
          {failure}
        </div>
      ) : null}

      <div className="set-panels">
        <Panel
          title="Promotion gate"
          subtitle="Evidence a candidate needs before a reviewer may promote it. Promotion itself is always a human decision."
        >
          <div className="set-fields">
            <NumberField
              field="gate.minShadowRuns"
              label="Minimum shadow runs"
              help="Shadow Brain runs required before promotion."
              value={form.gate.minShadowRuns}
              error={text('gate.minShadowRuns')}
              readOnly={readOnly}
              onChange={(minShadowRuns) => {
                patch('gate', { minShadowRuns });
              }}
            />
            <NumberField
              field="gate.minDistinctVariants"
              label="Minimum distinct variants"
              help="Different fault and workspace combinations the shadow runs must cover."
              value={form.gate.minDistinctVariants}
              error={text('gate.minDistinctVariants')}
              readOnly={readOnly}
              onChange={(minDistinctVariants) => {
                patch('gate', { minDistinctVariants });
              }}
            />
            <NumberField
              field="gate.maxSafetyViolations"
              label="Maximum safety violations"
              help="Safety is never traded against savings. Keep this at 0."
              value={form.gate.maxSafetyViolations}
              error={text('gate.maxSafetyViolations')}
              readOnly={readOnly}
              onChange={(maxSafetyViolations) => {
                patch('gate', { maxSafetyViolations });
              }}
            />
            <NumberField
              field="gate.minAgreementPct"
              label="Minimum shadow agreement"
              suffix="%"
              help="Share of shadow runs where the Reflex and the AI agree."
              value={form.gate.minAgreementPct}
              error={text('gate.minAgreementPct')}
              readOnly={readOnly}
              onChange={(minAgreementPct) => {
                patch('gate', { minAgreementPct });
              }}
            />
            <NumberField
              field="gate.minReplayAgreementPct"
              label="Minimum replay agreement"
              suffix="%"
              help="Share of historical traces the candidate must reproduce."
              value={form.gate.minReplayAgreementPct}
              error={text('gate.minReplayAgreementPct')}
              readOnly={readOnly}
              onChange={(minReplayAgreementPct) => {
                patch('gate', { minReplayAgreementPct });
              }}
            />
          </div>
        </Panel>

        <Panel
          title="Drift Canary"
          subtitle="When a Reflex stops being trusted. Example thresholds, not validated recommendations."
        >
          <div className="set-fields">
            <NumberField
              field="drift.minSamples"
              label="Minimum canary samples"
              help="Comparisons needed before drift can be confirmed."
              value={form.drift.minSamples}
              error={text('drift.minSamples')}
              readOnly={readOnly}
              onChange={(minSamples) => {
                patch('drift', { minSamples });
              }}
            />
            <NumberField
              field="drift.dropThresholdPct"
              label="Agreement drop that confirms drift"
              suffix="%"
              help="Drift needs agreement to fall by at least this much versus history…"
              value={form.drift.dropThresholdPct}
              error={text('drift.dropThresholdPct')}
              readOnly={readOnly}
              onChange={(dropThresholdPct) => {
                patch('drift', { dropThresholdPct });
              }}
            />
            <NumberField
              field="drift.floorPct"
              label="Agreement floor"
              suffix="%"
              help="…and agreement to be below this absolute floor."
              value={form.drift.floorPct}
              error={text('drift.floorPct')}
              readOnly={readOnly}
              onChange={(floorPct) => {
                patch('drift', { floorPct });
              }}
            />
            <NumberField
              field="drift.watchBelowPct"
              label="Watch below confidence"
              suffix="%"
              help="An active Reflex goes on Watch when its confidence falls below this."
              value={form.drift.watchBelowPct}
              error={text('drift.watchBelowPct')}
              readOnly={readOnly}
              onChange={(watchBelowPct) => {
                patch('drift', { watchBelowPct });
              }}
            />
          </div>
        </Panel>

        <Panel
          title="Economics assumptions"
          subtitle="Inputs to cost and ROI. Assumptions, labelled as such wherever they appear."
        >
          <div className="set-fields">
            <NumberField
              field="economics.reviewMinutes"
              label="Human review time"
              suffix="min"
              help="Booked as cost: humans spend time, not tokens."
              value={form.economics.reviewMinutes}
              error={text('economics.reviewMinutes')}
              readOnly={readOnly}
              onChange={(reviewMinutes) => {
                patch('economics', { reviewMinutes });
              }}
            />
            <NumberField
              field="economics.reviewerUsdPerHour"
              label="Reviewer rate"
              suffix="USD/h"
              help="Used to price the review time."
              value={form.economics.reviewerUsdPerHour}
              error={text('economics.reviewerUsdPerHour')}
              readOnly={readOnly}
              onChange={(reviewerUsdPerHour) => {
                patch('economics', { reviewerUsdPerHour });
              }}
            />
            <NumberField
              field="economics.projectedExecutions"
              label="Projected executions"
              help="Future executions the ROI projection assumes. An assumption, not a forecast."
              value={form.economics.projectedExecutions}
              error={text('economics.projectedExecutions')}
              readOnly={readOnly}
              onChange={(projectedExecutions) => {
                patch('economics', { projectedExecutions });
              }}
            />
            <div className="set-switch">
              <Switch
                label="Count learning-task baseline runs as investment"
                checked={form.economics.includeLearningInInvestment}
                disabled={readOnly}
                onChange={(event) => {
                  patch('economics', { includeLearningInInvestment: event.target.checked });
                }}
              />
              <p className="bf-help">
                The conservative view: those tasks had to be solved anyway, but counting them shows
                the most cautious ROI.
              </p>
            </div>
          </div>
        </Panel>
      </div>

      {canEdit ? (
        <div className="set-actions">
          <Button
            type="submit"
            variant="primary"
            loading={update.isPending}
            disabled={!dirty}
            data-testid="settings-save"
            {...(!dirty ? { disabledReason: 'No changes to save.' } : {})}
          >
            Save changes
          </Button>
          <Button
            disabled={!dirty || update.isPending}
            data-testid="settings-discard"
            onClick={() => {
              setForm(baseline);
              setErrors({});
              setFailure(null);
            }}
          >
            Discard changes
          </Button>
          {dirty ? <span className="set-actions__hint">Unsaved changes</span> : null}
        </div>
      ) : null}
    </form>
  );
}

function SwitchToAdmin() {
  const auth = useAuth();
  const personas = usePersonas();
  const login = useLogin();
  const { toast } = useToast();
  const admin = personas.data?.personas.find(
    (persona) => persona.role === 'admin' && persona.tenant.slug === auth.user?.tenant.slug,
  );
  const password = personas.data?.passwordHint;
  if (!admin || !password) return null;
  return (
    <Button
      size="sm"
      icon={<UserRoundCheck size={14} />}
      loading={login.isPending}
      onClick={() => {
        login.mutate(
          { email: admin.email, password },
          {
            onSuccess: () => {
              toast({ title: `Signed in as ${admin.displayName}`, tone: 'success' });
            },
          },
        );
      }}
    >
      Switch to {admin.displayName.split(' ')[0]} (admin)
    </Button>
  );
}

function SettingsPanel() {
  const auth = useAuth();
  const query = useSettings();
  const canEdit = auth.can('manage_settings');

  if (query.isPending) {
    return (
      <SkeletonGroup label="Loading settings" className="set-panels">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} height={260} radius={8} />
        ))}
      </SkeletonGroup>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        title="Settings could not be loaded"
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
        retrying={query.isFetching}
      />
    );
  }
  return (
    <div className="stack" style={{ '--gap': '16px' } as CSSProperties}>
      {canEdit ? null : (
        <div className="set-readonly" role="note">
          <Lock size={16} aria-hidden="true" />
          <p>
            <strong>Read-only.</strong> Only an admin can change settings. You are signed in as{' '}
            {auth.user?.displayName} {auth.role ? <RoleBadge role={auth.role} /> : null}; these are
            the values the server enforces for the gate, drift checks and economics.
          </p>
          {auth.isDemo ? <SwitchToAdmin /> : null}
        </div>
      )}
      <SettingsEditor key={JSON.stringify(query.data)} initial={query.data} canEdit={canEdit} />
    </div>
  );
}

/** `/settings`: What is configured and what is real? */
export default function SettingsPage() {
  const auth = useAuth();
  return (
    <Page title="Settings">
      <PageHeader
        title="Settings"
        question="What is configured and what is real?"
        actions={
          <Chip tone="ash" variant="outline" icon={<ShieldCheck size={12} />}>
            Server-enforced
          </Chip>
        }
      />
      <Section
        id="real"
        title="What is real"
        description="The provider, the price sheet and the label every kind of number carries."
      >
        <WhatIsReal />
      </Section>
      <Section
        id="thresholds"
        title="Thresholds and assumptions"
        description="Changing these changes what the gate allows, when drift is confirmed and how ROI is computed."
      >
        <SettingsPanel />
      </Section>
      {auth.isDemo ? (
        <Section
          id="demo"
          title="Demo data"
          description="The guided demo runs the real services on a local database."
        >
          <ResetDemo variant="section" />
        </Section>
      ) : null}
    </Page>
  );
}
