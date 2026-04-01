import { defaultPreferences, sanitizePreferences } from '$lib/shared/preferences';
import type { Preferences, SearchState, ThemeMode } from '$lib/shared/types';

const storageKey = 'bountarr.preferences';
const searchStateKey = 'bountarr.search-state';
const defaultSearchState: SearchState = {
  activeView: 'search',
  query: '',
  kind: 'all',
  includeAvailable: true
};

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

export function loadSearchState(): SearchState {
  if (typeof localStorage === 'undefined') {
    return defaultSearchState;
  }

  try {
    const raw = localStorage.getItem(searchStateKey);
    if (!raw) {
      return defaultSearchState;
    }

    const parsed = JSON.parse(raw) as Partial<SearchState>;
    return {
      activeView:
        parsed.activeView === 'search' ||
        parsed.activeView === 'queue' ||
        parsed.activeView === 'dashboard' ||
        parsed.activeView === 'status' ||
        parsed.activeView === 'settings'
          ? parsed.activeView
          : defaultSearchState.activeView,
      query: typeof parsed.query === 'string' ? parsed.query : defaultSearchState.query,
      kind:
        parsed.kind === 'all' || parsed.kind === 'movie' || parsed.kind === 'series'
          ? parsed.kind
          : defaultSearchState.kind,
      includeAvailable:
        typeof parsed.includeAvailable === 'boolean'
          ? parsed.includeAvailable
          : defaultSearchState.includeAvailable
    };
  } catch {
    return defaultSearchState;
  }
}

export function saveSearchState(state: SearchState): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(searchStateKey, JSON.stringify(state));
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
