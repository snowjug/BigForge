import { Link } from 'react-router';
import { useLocation } from 'react-router';
import { useOptionalDemo } from '../demo/useDemo';
import { ForgeLogo } from '../ui';
import { type ForgeStageId, resolveActiveStages } from '../stages';
import { PipelineStrip } from './PipelineStrip';
import { usePageStages } from './stageStore';
import { ProviderChip, ToolchainChip } from './StripChips';
import { IdentityMenu } from './IdentityMenu';
import { MotionToggle, ThemeToggle } from './Toggles';

/** The stages that should glow right now: page override, then the demo step, then the route. */
export function useActiveStages(): ForgeStageId[] {
  const { pathname } = useLocation();
  const page = usePageStages();
  const demo = useOptionalDemo();
  const demoSource =
    demo?.open && demo.current ? { stepId: demo.current.id, route: demo.current.route } : null;
  return resolveActiveStages({ page, demo: demoSource, pathname });
}

/**
 * The top Forge strip: the pipeline, the provider-mode chip (always visible: it says whether a model
 * is really being called), the toolchain chip, the theme and motion toggles and the identity menu.
 */
export function ForgeStrip() {
  const active = useActiveStages();
  return (
    <header className="bf-strip">
      <Link to="/" className="bf-strip__brand" aria-label="BigForge, Forge Floor">
        <ForgeLogo size={26} />
      </Link>
      <PipelineStrip active={active} />
      <div className="bf-strip__right">
        <ProviderChip />
        <span className="bf-strip__optional">
          <ToolchainChip />
        </span>
        <ThemeToggle />
        <MotionToggle />
        <IdentityMenu />
      </div>
    </header>
  );
}
