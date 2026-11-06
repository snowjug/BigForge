import {
  ChartLine,
  Fingerprint,
  Flame,
  GitCompareArrows,
  type LucideIcon,
  Play,
  Radar,
  ScrollText,
  Settings,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import { PAGE_META, type PageId } from '../pages/pageMeta';

export interface NavItem {
  id: PageId;
  label: string;
  to: string;
  icon: LucideIcon;
  /** `forge` pages are the loop; `trust` pages measure and govern it. */
  group: 'forge' | 'trust';
  /** Shown in the mobile tab bar; everything else lives under "More". */
  primary: boolean;
}

const item = (
  id: PageId,
  icon: LucideIcon,
  group: NavItem['group'],
  primary: boolean,
): NavItem => ({
  id,
  label: PAGE_META[id].navLabel,
  to: PAGE_META[id].path,
  icon,
  group,
  primary,
});

export const NAV_ITEMS: readonly NavItem[] = [
  item('home', Flame, 'forge', true),
  item('run', Play, 'forge', true),
  item('traces', ScrollText, 'forge', true),
  item('learn', Fingerprint, 'forge', false),
  item('reflexes', Waypoints, 'forge', true),
  item('shadow', GitCompareArrows, 'forge', false),
  item('drift', Radar, 'forge', false),
  item('economics', ChartLine, 'trust', false),
  item('governance', ShieldCheck, 'trust', false),
  item('settings', Settings, 'trust', false),
];

export const NAV_GROUP_LABEL: Record<NavItem['group'], string> = {
  forge: 'Forge',
  trust: 'Measure and trust',
};
