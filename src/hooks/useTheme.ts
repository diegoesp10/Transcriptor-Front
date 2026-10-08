import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/** system sigue al sistema operativo; day/night fuerzan el modo (data-theme en <html>) */
export type ThemeChoice = 'system' | 'day' | 'night';

const KEY = 'mm-mode';
const META: Record<'day' | 'night', string> = { day: '#f2f2f7', night: '#000000' };

function initial(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'day' || saved === 'night') return saved;
  } catch {
    /* noop */
  }
  return 'system';
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  const dark = choice === 'night' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[dark ? 'night' : 'day']);
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>(initial);

  useEffect(() => {
    apply(theme);
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      /* noop */
    }
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => apply('system');
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [theme]);

  /** Cambio con un revelado circular desde el punto de origen (View Transitions API) */
  const setTheme = useCallback((next: ThemeChoice, origin?: { x: number; y: number }) => {
    const commit = () => {
      apply(next);
      flushSync(() => setThemeState(next));
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!('startViewTransition' in document) || reduced) return commit();
    const transition = document.startViewTransition(commit);
    const { x, y } = origin ?? { x: window.innerWidth / 2, y: 0 };
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    transition.ready
      .then(() =>
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 650, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
        ),
      )
      .catch(() => undefined);
  }, []);

  return { theme, setTheme };
}
