import { FlaskConical, Hammer, Radio } from 'lucide-react';
import { Link } from 'react-router';
import { useSystem } from '../api/hooks';
import { settingsPath } from '../routes';
import { Chip, Skeleton, Tooltip } from '../ui';

/**
 * Always visible, because every number in the product depends on it: is a model being called, or is a
 * deterministic stand-in playing the model? Deterministic activity is never called a "model call"
 * without the word deterministic or synthetic nearby.
 */
export function ProviderChip() {
  const { data, isPending, isError } = useSystem();
  if (isPending) return <Skeleton width={150} height={22} radius={999} />;
  if (isError || !data) {
    return (
      <Chip tone="ash" variant="outline" dashed>
        Provider unknown
      </Chip>
    );
  }
  const live = data.provider.mode === 'live';
  const tip = (
    <div className="bf-prov-tip">
      <p className="bf-prov-tip__head">
        <span className="micro" data-tone={live ? 'ember' : 'steel'}>
          {live ? 'Live provider' : 'Deterministic provider'}
        </span>
      </p>
      <p>
        {live
          ? 'Model calls go to a real provider. Token counts and latency are provider-reported, so they are measured, and tokens cost real money.'
          : 'No model is called. A scripted stand-in plays the model so everything runs offline: token counts are synthetic and model latency is simulated. Local command time is measured.'}
      </p>
      {data.provider.notes.map((note) => (
        <p key={note} className="faint">
          {note}
        </p>
      ))}
      <p className="faint">Click to see what is real in Settings.</p>
    </div>
  );
  return (
    <Tooltip content={tip} side="bottom" align="end">
      <Link
        to={settingsPath()}
        className="bf-strip__chip-link"
        data-testid="provider-chip"
        aria-label={
          live
            ? 'Live provider. Model calls go to a real provider. Open settings to see what is real.'
            : 'Deterministic provider · synthetic. No model is called. Open settings to see what is real.'
        }
      >
        <Chip
          tone={live ? 'ember' : 'steel'}
          variant="outline"
          icon={live ? <Radio size={12} /> : <FlaskConical size={12} />}
        >
          <span className="bf-strip__chip-full">
            {live ? 'Live provider' : 'Deterministic provider · synthetic'}
          </span>
          <span className="bf-strip__chip-short">{live ? 'Live' : 'Synthetic'}</span>
        </Chip>
      </Link>
    </Tooltip>
  );
}

/** The forge-ci toolchain version of the synthetic lab. Changing it is the drift trigger. */
export function ToolchainChip() {
  const { data } = useSystem();
  if (!data) return null;
  const { toolchainVersion, available } = data.environment;
  const tip = (
    <div className="bf-prov-tip">
      <p className="bf-prov-tip__head">
        <span className="micro">Toolchain</span>
      </p>
      <p>The synthetic build tool the lab uses. A version change is how drift is introduced.</p>
      {available.map((entry) => (
        <p key={entry.version} className={entry.version === toolchainVersion ? undefined : 'faint'}>
          <span className="mono">{entry.version}</span>
          {entry.version === toolchainVersion ? ' (current)' : ''}: {entry.description}
        </p>
      ))}
    </div>
  );
  return (
    <Tooltip content={tip} side="bottom" align="end">
      <button
        type="button"
        className="bf-strip__chip-button"
        data-testid="toolchain-chip"
        aria-label={`Toolchain forge-ci ${toolchainVersion}`}
      >
        <Chip tone="neutral" variant="outline" icon={<Hammer size={12} />} mono>
          forge-ci {toolchainVersion}
        </Chip>
      </button>
    </Tooltip>
  );
}
