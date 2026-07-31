import { useCallback, useEffect, useState } from "react";

/**
 * FROZEN — see CONTRACT.md. Theme plumbing shared by every lane.
 *
 * Dark is the default. The applied theme lives on `document.documentElement`
 * as `data-theme`, set by an inline script in index.html before first paint so
 * there is no flash of the wrong theme.
 */

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "quill-theme";

export function getTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  return attr === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode or storage disabled — the theme still applies for this session.
  }
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  return [theme, setTheme];
}
