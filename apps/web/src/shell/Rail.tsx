import { Presentation } from 'lucide-react';
import { Link, NavLink } from 'react-router';
import { useDemo } from '../demo/useDemo';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { ForgeLogo, Tooltip, cx } from '../ui';
import { NAV_GROUP_LABEL, NAV_ITEMS, type NavItem } from './nav';

function RailLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  const link = (
    <NavLink to={item.to} end={item.to === '/'} className="bf-rail__link">
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
      <span className="bf-rail__label">{item.label}</span>
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

/** Left rail: icons + labels at 1280px and up, icon-only from 768px. Below 768px see TabBar. */
export function Rail() {
  const collapsed = useMediaQuery('(max-width: 1279px)');
  const groups = ['forge', 'trust'] as const;

  return (
    <nav className="bf-rail" aria-label="Primary">
      <div className="bf-rail__brand">
        <Link to="/" className="bf-rail__home" aria-label="BigForge, Forge Floor">
          <ForgeLogo size={28} wordmark />
        </Link>
      </div>

      <div className="bf-rail__groups">
        {groups.map((group) => (
          <div key={group} className="bf-rail__group">
            <p className="micro bf-rail__group-label">{NAV_GROUP_LABEL[group]}</p>
            <ul>
              {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
                <li key={item.id}>
                  <RailLink item={item} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="bf-rail__foot">
        <DemoRailButton collapsed={collapsed} />
      </div>
    </nav>
  );
}

function DemoRailButton({ collapsed }: { collapsed: boolean }) {
  const demo = useDemo();
  if (!demo.available) return null;
  const button = (
    <button
      type="button"
      className={cx('bf-rail__demo', demo.open && 'bf-rail__demo--open')}
      aria-pressed={demo.open}
      data-testid="rail-demo-toggle"
      onClick={() => {
        if (demo.open) demo.exit();
        else void demo.start();
      }}
    >
      <Presentation size={18} strokeWidth={1.75} aria-hidden="true" />
      <span className="bf-rail__label bf-rail__demo-text">
        <span>Guided demo</span>
        <span className="bf-rail__demo-sub">
          {demo.state ? `Step ${demo.step} of ${demo.total}` : 'Walk the story'}
        </span>
      </span>
    </button>
  );
  return collapsed ? (
    <Tooltip content="Guided demo" side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
}
