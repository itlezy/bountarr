import { defaultPreferences, sanitizePreferences } from '$lib/shared/preferences';
import type { Preferences, ThemeMode } from '$lib/shared/types';

const storageKey = 'bountarr.preferences';

export function loadPreferences(): Preferences {
  if (typeof localStorage === 'undefined') {
    return defaultPreferences;
  }

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return defaultPreferences;
    }

    return sanitizePreferences(JSON.parse(raw) as Partial<Preferences>);
  } catch {
    return defaultPreferences;
  }
}

export function savePreferences(preferences: Preferences): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(storageKey, JSON.stringify(preferences));
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') {
    return;
  }

  const resolvedTheme =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;

  document.documentElement.dataset.theme = resolvedTheme;
}
