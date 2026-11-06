import type { MutationDto, ReflexSpec, ReflexVersionDto } from '@bigforge/schemas';
import { Check, Copy, Download, ExternalLink, FileJson } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../../../api/client';
import { useReflexExport } from '../../../api/hooks';
import { driftPath, learnPath, reflexPath } from '../../../routes';
import {
  Button,
  Chip,
  Provenance,
  Summary,
  formatCount,
  formatPct,
  formatTimestamp,
  plural,
  useToast,
} from '../../../ui';
import { ReflexDna } from '../../../viz/dna/ReflexDna';
import { tokenizeJson } from '../jsonView';

/* ------------------------------------------------------------------------------------------------
 * Permissions
 * ---------------------------------------------------------------------------------------------- */

/** Mirrors PROTECTED_WRITE_GLOBS in packages/security/src/permissions.ts. The server is the enforcement. */
const PROTECTED_WRITE_GLOBS: readonly string[] = [
  '**/forge.lock.json',
  '.github/**',
  'ci/**',
  '**/.env',
  '**/.env.*',
  '**/node_modules/**',
];

function GlobList({
  title,
  items,
  empty,
}: {
  title: string;
  items: readonly string[];
  empty: string;
}) {
  return (
    <section aria-label={title} className="rfx-perm">
      <h4 className="rfx-h4">
        {title} <span className="faint num">({items.length})</span>
      </h4>
      {items.length === 0 ? (
        <p className="dim">{empty}</p>
      ) : (
        <ul className="rfx-globs">
          {items.map((glob) => (
            <li key={glob} className="mono">
              {glob}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Least-privilege permissions the compiler derived. Protected paths are never writable. */
export function PermissionsTab({ spec }: { spec: ReflexSpec }) {
  const { permissions } = spec;
  return (
    <div className="rfx-tab-stack">
      <p className="rfx-lead">
        Derived by the compiler from what the source traces actually read, wrote and ran: nothing
        wider. The executor refuses every action outside these grants, whatever the Reflex asks for.
      </p>
      <div className="rfx-perm-grid">
        <GlobList title="May read" items={permissions.read} empty="Reads nothing." />
        <GlobList title="May write" items={permissions.write} empty="Writes nothing." />
        <section aria-label="May run" className="rfx-perm">
          <h4 className="rfx-h4">
            May run <span className="faint num">({permissions.commands.length})</span>
          </h4>
          <ul className="rfx-globs">
            {permissions.commands.map((c) => (
              <li key={c.program}>
                <span className="mono">{c.program}</span>
                <span className="rfx-chips" style={{ marginTop: 4 }}>
                  {c.subcommands.map((sub) => (
                    <Chip key={sub} mono size="sm" tone="steel" variant="outline">
                      {sub}
                    </Chip>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <p className="rfx-fine">
            Only allowlisted programs and subcommands; arguments are parsed, never passed to a
            shell.
          </p>
        </section>
        <section aria-label="Limits" className="rfx-perm">
          <h4 className="rfx-h4">Limits</h4>
          <dl className="rfx-facts">
            <dt>Network</dt>
            <dd>{permissions.limits.network ? 'allowed' : 'none'}</dd>
            <dt>Secrets</dt>
            <dd>{permissions.limits.secrets}</dd>
            <dt>Timeout</dt>
            <dd className="num">{permissions.limits.timeoutS} s</dd>
            <dt>Output cap</dt>
            <dd className="num">{formatCount(permissions.limits.maxOutputBytes)} bytes</dd>
            <dt>Step cap</dt>
            <dd className="num">{permissions.limits.maxSteps} steps</dd>
          </dl>
        </section>
      </div>
      <section aria-label="Protected paths" className="rfx-protected">
        <h4 className="rfx-h4">Protected paths: never writable</h4>
        <p className="dim">
          These paths cannot be modified by any Reflex, even if a write grant above would otherwise
          match them.
        </p>
        <ul className="rfx-globs rfx-globs--row">
          {PROTECTED_WRITE_GLOBS.map((glob) => (
            <li key={glob} className="mono">
              {glob}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Assumptions and provenance
 * ---------------------------------------------------------------------------------------------- */

/** What the compiler had to assume, what it left out, and where the Reflex came from. */
export function AssumptionsTab({ version }: { version: ReflexVersionDto }) {
  const { spec, compileReport } = version;
  const { provenance } = spec;
  return (
    <div className="rfx-tab-stack">
      <section aria-labelledby="rfx-assume-title">
        <h3 id="rfx-assume-title" className="rfx-h3">
          Assumptions the compiler made
        </h3>
        <p className="rfx-lead">
          A reviewer should read these before approving: they are the places where the Reflex goes
          beyond the evidence.
        </p>
        {provenance.assumptions.length === 0 ? (
          <p className="dim">The compiler recorded no assumptions.</p>
        ) : (
          <ol className="rfx-assumptions">
            {provenance.assumptions.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ol>
        )}
        {provenance.mutationOf ? (
          <p className="rfx-fine">
            This version is a mutation of v{provenance.mutationOf.reflexVersion}:{' '}
            {provenance.mutationOf.reason}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="rfx-excluded-title">
        <h3 id="rfx-excluded-title" className="rfx-h3">
          Left out
        </h3>
        {provenance.excludedTraceIds.length === 0 &&
        compileReport.excludedBehaviours.length === 0 &&
        compileReport.uncovered.length === 0 ? (
          <p className="dim">
            No trace and no behaviour was excluded, and every behaviour is covered by a step.
          </p>
        ) : (
          <ul className="rfx-excluded">
            {provenance.excludedTraceIds.map((t) => (
              <li key={t.traceId}>
                <Chip tone="crimson" variant="outline" dashed mono>
                  {t.traceId}
                </Chip>{' '}
                trace excluded: {t.reason}
              </li>
            ))}
            {compileReport.excludedBehaviours.map((b) => (
              <li key={b.purpose}>
                <Chip tone="crimson" variant="outline" dashed mono>
                  {b.purpose}
                </Chip>{' '}
                behaviour excluded ({plural(b.occurrences, 'occurrence')}): {b.reason}
              </li>
            ))}
            {compileReport.uncovered.map((u) => (
              <li key={u}>
                <Chip tone="ember" variant="outline" dashed mono>
                  {u}
                </Chip>{' '}
                uncovered: no typed operator reproduces it, so it stays with the model.
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rfx-sources-title">
        <div className="rfx-section-head">
          <h3 id="rfx-sources-title" className="rfx-h3">
            Source traces and variants
          </h3>
          <Link to={learnPath({ family: spec.familyId })} className="rfx-inline-link">
            Open the family in Learn <ExternalLink size={13} aria-hidden="true" />
          </Link>
        </div>
        <Summary
          label={`${plural(provenance.sourceTraceIds.length, 'source trace')} across ${plural(provenance.sourceVariants.length, 'variant')}`}
          defaultOpen
          description="The verified baseline traces the compiler aligned, in the order it read them."
          caption="Source traces"
          rows={compileReport.rows}
          getRowId={(r) => r.traceId}
          columns={[
            { id: 'trace', header: 'Trace', mono: true, cell: (r) => r.traceId },
            { id: 'scenario', header: 'Task', mono: true, cell: (r) => r.scenarioId },
            { id: 'variant', header: 'Variant', mono: true, cell: (r) => r.variantKey },
          ]}
        />
        <p className="rfx-fine">
          Compiler <span className="mono">{provenance.compilerVersion}</span> · baseline{' '}
          {formatCount(compileReport.baselineTokensPerTask)} tokens per task{' '}
          <Provenance kind="synthetic" />
        </p>
      </section>

      <section aria-labelledby="rfx-dna-title">
        <h3 id="rfx-dna-title" className="rfx-h3">
          Reflex DNA of this version
        </h3>
        <details className="rfx-disclosure">
          <summary>Show the compile alignment</summary>
          <ReflexDna
            report={compileReport}
            steps={spec.steps}
            title={`${spec.name} v${spec.version}`}
          />
        </details>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Spec
 * ---------------------------------------------------------------------------------------------- */

/** The immutable specification as read-only JSON, with copy and download from the export endpoint. */
export function SpecTab({ version }: { version: ReflexVersionDto }) {
  const { toast } = useToast();
  const exported = useReflexExport(version.id, false);
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => JSON.stringify(version.spec, null, 2), [version.spec]);
  const lines = useMemo(() => tokenizeJson(text), [text]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({
        title: 'Specification copied',
        description: `${lines.length} lines of JSON.`,
        tone: 'success',
      });
      window.setTimeout(() => {
        setCopied(false);
      }, 2500);
    } catch {
      toast({
        title: 'Could not copy',
        description: 'The browser blocked clipboard access.',
        tone: 'warning',
      });
    }
  };

  const download = async () => {
    try {
      const result = await exported.refetch();
      if (!result.data) throw new Error('The export returned nothing');
      const blob = new Blob([`${JSON.stringify(result.data, null, 2)}\n`], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${version.name}-${version.version}.reflex.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast({
        title: 'Export downloaded',
        description: `${link.download} with its content hash.`,
        tone: 'success',
      });
    } catch (error) {
      toast({ title: 'Download failed', description: errorMessage(error), tone: 'danger' });
    }
  };

  return (
    <div className="rfx-tab-stack">
      <div className="rfx-spec-head">
        <p className="rfx-lead">
          <span className="mono">bigforge.reflex/v1</span>: data, not code. Immutable once compiled
          and hashed with sha256; status, trust and evidence live beside it.
        </p>
        <div className="rfx-spec-actions">
          <Button
            size="sm"
            icon={copied ? <Check size={14} /> : <Copy size={14} />}
            data-testid="spec-copy"
            onClick={() => void copy()}
          >
            {copied ? 'Copied' : 'Copy JSON'}
          </Button>
          <Button
            size="sm"
            icon={<Download size={14} />}
            data-testid="spec-download"
            loading={exported.isFetching}
            onClick={() => void download()}
          >
            Download export
          </Button>
        </div>
      </div>
      <p className="rfx-hash">
        <FileJson size={14} aria-hidden="true" /> <span className="faint">content hash</span>{' '}
        <span className="mono">{version.contentHash}</span>
      </p>
      <pre className="rfx-json" tabIndex={0} aria-label="Reflex specification, read-only JSON">
        <code>
          {lines.map((tokens, index) => (
            <span key={index} className="rfx-json__line">
              {tokens.map((token, i) => (
                <span key={i} className={`rfx-json__${token.type}`}>
                  {token.text}
                </span>
              ))}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Mutations
 * ---------------------------------------------------------------------------------------------- */

const MUTATION_TONE = { proposed: 'ember', approved: 'jade', rejected: 'ash' } as const;

function MutationItem({ mutation, current }: { mutation: MutationDto; current: string }) {
  const regression = mutation.evidence.regression;
  return (
    <li className="rfx-mutation" data-status={mutation.status}>
      <header>
        <Chip
          tone={MUTATION_TONE[mutation.status]}
          variant="outline"
          dashed={mutation.status === 'proposed'}
        >
          {mutation.status === 'proposed' ? 'Proposed: not activated' : mutation.status}
        </Chip>
        <span className="rfx-mutation__versions">
          <Link
            to={reflexPath(mutation.fromVersionId)}
            aria-current={mutation.fromVersionId === current ? 'page' : undefined}
          >
            v{mutation.fromVersion}
          </Link>
          <span aria-hidden="true"> {'\u2192'} </span>
          <span className="sr-only"> becomes </span>
          <Link
            to={reflexPath(mutation.toVersionId)}
            aria-current={mutation.toVersionId === current ? 'page' : undefined}
          >
            v{mutation.toVersion}
          </Link>
        </span>
        <time className="faint mono num" dateTime={mutation.createdAt}>
          {formatTimestamp(mutation.createdAt)}
        </time>
      </header>
      <p>{mutation.reason}</p>
      {mutation.diff.steps.length > 0 ? (
        <Summary
          label={`Changes (${mutation.diff.steps.length})`}
          defaultOpen
          description="Steps whose operator changed, were added or were removed against the version it was mutated from."
          caption="Mutation diff"
          rows={mutation.diff.steps}
          getRowId={(s) => `${s.stepId}-${s.change}`}
          columns={[
            { id: 'step', header: 'Step', mono: true, cell: (s) => s.stepId },
            { id: 'change', header: 'Change', cell: (s) => s.change },
            { id: 'from', header: 'From', mono: true, cell: (s) => s.from ?? '\u2014' },
            { id: 'to', header: 'To', mono: true, cell: (s) => s.to ?? '\u2014' },
          ]}
        />
      ) : null}
      <p className="rfx-fine num">
        Regression check: {regression.agreements} of {regression.runs} runs agree
        {regression.agreement !== null
          ? ` (${formatPct(regression.agreement, { digits: 0 })})`
          : ''}{' '}
        across {plural(mutation.evidence.envVersions.length, 'toolchain version')} (
        {mutation.evidence.envVersions.join(', ')}). Not activated: a reviewer decides.
      </p>
    </li>
  );
}

/** Mutations proposed for this Reflex after drift. They are never activated without a reviewer. */
export function MutationsTab({ version }: { version: ReflexVersionDto }) {
  return (
    <div className="rfx-tab-stack">
      <p className="rfx-lead">
        A mutation recompiles the Reflex from old and new traces, swapping a fragile step for a
        robust one. It is proposed with its evidence and waits for a reviewer; it is never activated
        on its own.
      </p>
      {version.mutations.length === 0 ? (
        <p className="dim">
          No mutation has been proposed for this Reflex. They appear after the Drift Canary confirms
          drift.
        </p>
      ) : (
        <ul className="rfx-mutations">
          {version.mutations.map((m) => (
            <MutationItem key={m.id} mutation={m} current={version.id} />
          ))}
        </ul>
      )}
      <Link to={driftPath({ version: version.id })} className="rfx-inline-link">
        Review proposals and drift evidence in Drift <ExternalLink size={13} aria-hidden="true" />
      </Link>
    </div>
  );
}
