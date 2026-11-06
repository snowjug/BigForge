import { Moon, Sun, Zap, ZapOff } from 'lucide-react';
import { useMotion, useTheme } from '../theme/prefs';
import { Button, Tooltip } from '../ui';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip content={`Switch to the ${next} theme`} side="bottom">
      <Button
        aria-label={`Switch to the ${next} theme`}
        icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        data-testid="theme-toggle"
        onClick={toggleTheme}
      />
    </Tooltip>
  );
}

/** Reduced motion stops looping animation and makes playback step-by-step. Defaults to the OS setting. */
export function MotionToggle() {
  const { reduced, toggleReduced, preference } = useMotion();
  return (
    <Tooltip
      content={
        reduced
          ? `Motion reduced${preference === 'system' ? ' (following your system setting)' : ''}. Click for full motion.`
          : 'Motion on. Click to reduce animation.'
      }
      side="bottom"
    >
      <Button
        aria-label="Reduce motion"
        aria-pressed={reduced}
        icon={reduced ? <ZapOff size={16} /> : <Zap size={16} />}
        data-testid="motion-toggle"
        onClick={toggleReduced}
      />
    </Tooltip>
  );
}
