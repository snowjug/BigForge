import type { FamilyDto, ReflexVersionSummaryDto } from '@bigforge/schemas';
import { ExternalLink, Hammer } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorMessage } from '../../api/client';
import { useCompileFamily, useReflexVersion } from '../../api/hooks';
import { useAuth } from '../../auth/useAuth';
import { useDemoTarget, useOptionalDemo } from '../../demo/useDemo';
import { reflexPath } from '../../routes';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Provenance,
  SkeletonGroup,
  SkeletonLines,
  StatusChip,
  formatMs,
  plural,
  useToast,
} from '../../ui';
import { ReflexDna } from '../../viz/dna/ReflexDna';
import { ReflexGlyph } from '../../viz';

interface DnaSectionProps {
  family: FamilyDto | null;
  /** Versions compiled from the family, any order. */
  versions: readonly ReflexVersionSummaryDto[];
}

const oldestFirst = (a: ReflexVersionSummaryDto, b: ReflexVersionSummaryDto): number =>
  a.createdAt.localeCompare(b.createdAt);

/**
 * Reflex DNA for the selected family: the alignment of the traces the Reflex was compiled from, and the
 * Compile action. Compiling is deterministic (zero model tokens) and lands on the new version.
 */
export function DnaSection({ family, versions }: DnaSectionProps) {
  const target = useDemoTarget('invariants');
  const demo = useOptionalDemo();
  const auth = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const compile = useCompileFamily();
  const [picked, setPicked] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<unknown>(null);

  const sorted = [...versions].sort(oldestFirst);
  const demoVersion = demo?.context?.reflexVersionId ?? null;
  const defaultId =
    demoVersion && sorted.some((v) => v.id === demoVersion) ? demoVersion : (sorted[0]?.id ?? null);
  const versionId = picked && sorted.some((v) => v.id === picked) ? picked : defaultId;
  const version = useReflexVersion(versionId);
  const summary = sorted.find((v) => v.id === versionId) ?? null;

  const canCompile = auth.can('compile');
  const compileReason = !family
    ? 'Discover a task family first: a Reflex is compiled from one.'
    : !canCompile
      ? `Compiling is limited to operators, reviewers and admins.${auth.role ? ` You are signed in as a${auth.role === 'admin' ? 'n' : ''} ${auth.role}.` : ''}`
      : undefined;

  const onCompile = async () => {
    if (!family) return;
    setCompileError(null);
    try {
      const created = await compile.mutateAsync(family.id);
      toast({
        title: 'Candidate Reflex compiled',
        description: `${created.name} v${created.version} is a candidate. It cannot run live until it is replayed, shadowed and approved by a reviewer.`,
        tone: 'success',
      });
      void navigate(reflexPath(created.id));
    } catch (error) {
      setCompileError(error);
      toast({ title: 'Compile failed', description: errorMessage(error), tone: 'danger' });
    }
  };

  return (
    <section
      {...target}
      className="learn-dna"
      data-testid="reflex-dna"
      aria-labelledby="learn-dna-title"
    >
      <header className="learn-dna__head">
        <div className="learn-dna__title">
          {summary ? <ReflexGlyph hash={summary.contentHash} size={44} /> : null}
          <div>
            <h2 id="learn-dna-title" className="learn-h2">
              Reflex DNA
            </h2>
            <p className="learn-sub">
              What never changes across the traces becomes a deterministic step; what varies stays a
              decision. Compiling is deterministic and uses no model tokens.
            </p>
          </div>
        </div>
        <div className="learn-dna__actions">
          {summary ? (
            <Link to={reflexPath(summary.id)} className="learn-dna__open">
              Open {summary.name} v{summary.version} <ExternalLink size={13} aria-hidden="true" />
            </Link>
          ) : null}
          <Button
            variant="forge"
            icon={<Hammer size={15} />}
            data-testid="compile-reflex"
            loading={compile.isPending}
            disabled={!family || !canCompile}
            {...(compileReason ? { disabledReason: compileReason } : {})}
            onClick={() => {
              void onCompile();
            }}
          >
            {sorted.length > 0 ? 'Compile a new version' : 'Compile Reflex'}
          </Button>
        </div>
      </header>

      {sorted.length > 1 ? (
        <div
          className="learn-dna__versions"
          role="group"
          aria-label="Reflex version to show the DNA of"
        >
          {sorted.map((v) => (
            <button
              key={v.id}
              type="button"
              className="learn-vchip"
              aria-pressed={v.id === versionId}
              onClick={() => {
                setPicked(v.id);
              }}
            >
              <span className="mono">v{v.version}</span>
              <StatusChip status={v.status} />
            </button>
          ))}
        </div>
      ) : null}

      {compile.isPending ? (
        <p className="learn-note" role="status">
          Aligning {family ? plural(family.members.length, 'trace') : 'the traces'} and testing
          every typed operator against each one. This is local and deterministic; it takes a few
          seconds.
        </p>
      ) : null}
      {compileError ? (
        <div role="alert" className="learn-note learn-note--bad">
          Compile did not finish: {errorMessage(compileError)}
        </div>
      ) : null}

      {!family ? (
        <EmptyState
          compact
          title="Nothing to align yet"
          description="Reflex DNA appears once a task family exists and a Reflex has been compiled from it."
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="No Reflex has been compiled from this family"
          description={`Compiling aligns the ${plural(family.members.length, 'verified baseline trace')} this family was discovered from, keeps a step only when a typed operator reproduces it on every trace, excludes unsafe behaviour and records every assumption. The result is a candidate: it cannot run live.`}
        />
      ) : version.isPending ? (
        <SkeletonGroup label="Loading the compile alignment">
          <SkeletonLines lines={6} />
        </SkeletonGroup>
      ) : version.isError ? (
        <ErrorState
          title="Could not load the compile report"
          error={version.error}
          onRetry={() => {
            void version.refetch();
          }}
        />
      ) : (
        <>
          <p className="learn-dna__meta">
            <Chip tone="neutral" variant="outline" mono>
              {version.data.compileReport.compilerVersion}
            </Chip>
            <span>
              {plural(version.data.compileReport.tracesUsed, 'trace')} from{' '}
              {plural(version.data.compileReport.variants.length, 'variant')}
            </span>
            {version.data.compileReport.compileMs !== undefined ? (
              <span>
                compiled in {formatMs(version.data.compileReport.compileMs)}{' '}
                <Provenance kind="measured" />
              </span>
            ) : null}
          </p>
          <ReflexDna
            report={version.data.compileReport}
            steps={version.data.spec.steps}
            title={`${version.data.name} v${version.data.version}`}
          />
        </>
      )}
    </section>
  );
}
