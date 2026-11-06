import { Ellipsis, Presentation } from 'lucide-react';
import { useState } from 'react';
import { NavLink } from 'react-router';
import { useDemo } from '../demo/useDemo';
import { Drawer } from '../ui';
import { NAV_ITEMS, type NavItem } from './nav';

function TabLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className="bf-tabbar__link"
      {...(onNavigate ? { onClick: onNavigate } : {})}
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
      <span>{item.label}</span>
    </NavLink>
  );
}

/** Bottom tab bar for screens below 768px. Four primary views, the rest under "More". */
export function TabBar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const demo = useDemo();
  const primary = NAV_ITEMS.filter((item) => item.primary);
  const rest = NAV_ITEMS.filter((item) => !item.primary);
  const close = () => {
    setMoreOpen(false);
  };

  return (
    <>
      <nav className="bf-tabbar" aria-label="Primary">
        <ul>
          {primary.map((item) => (
            <li key={item.id}>
              <TabLink item={item} />
            </li>
          ))}
          <li>
            <button
              type="button"
              className="bf-tabbar__link"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => {
                setMoreOpen(true);
              }}
            >
              <Ellipsis size={20} strokeWidth={1.75} aria-hidden="true" />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>
      <Drawer open={moreOpen} onClose={close} title="All views" width={360}>
        <nav aria-label="More views">
          <ul className="bf-more">
            {rest.map((item) => (
              <li key={item.id}>
                <TabLink item={item} onNavigate={close} />
              </li>
            ))}
            {demo.available ? (
              <li>
                <button
                  type="button"
                  className="bf-tabbar__link"
                  onClick={() => {
                    close();
                    if (demo.open) demo.exit();
                    else void demo.start();
                  }}
                >
                  <Presentation size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span>{demo.open ? 'Exit guided demo' : 'Guided demo'}</span>
                </button>
              </li>
            ) : null}
          </ul>
        </nav>
      </Drawer>
    </>
  );
}
