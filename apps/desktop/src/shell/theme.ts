import { useEffect, useState } from 'react';

const KEY = 'desktop.theme';
export type Theme = 'dark' | 'light';

export function loadTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
}

/** The Desktop theme (`desktop.theme`, dark by default), mirrored on the root element for the shared tokens. */
export function useTheme(): Theme {
  const [theme] = useState<Theme>(loadTheme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return theme;
}
