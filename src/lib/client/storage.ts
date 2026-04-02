import { defaultPreferences, sanitizePreferences } from '$lib/shared/preferences';
import { resolveTheme } from '$lib/shared/themes';
import type {
  CardViewMode,
  Preferences,
  SearchAvailability,
  SearchSortDirection,
  SearchSortField,
  SearchState,
  ThemeMode,
} from '$lib/shared/types';

const storageKey = 'bountarr.preferences';
const searchStateKey = 'bountarr.search-state';
const defaultSearchState: SearchState = {
  activeView: 'search',
  query: '',
  kind: 'all',
  availability: 'not-available-only',
  sortField: 'popularity',
  sortDirection: 'desc',
};

function isSearchAvailability(value: unknown): value is SearchAvailability {
  return value === 'all' || value === 'available-only' || value === 'not-available-only';
}

function isSearchSortField(value: unknown): value is SearchSortField {
  return value === 'title' || value === 'year' || value === 'popularity' || value === 'rating';
}

function isSearchSortDirection(value: unknown): value is SearchSortDirection {
  return value === 'asc' || value === 'desc';
}

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
      availability: isSearchAvailability(parsed.availability)
        ? parsed.availability
        : defaultSearchState.availability,
      sortField: isSearchSortField(parsed.sortField)
        ? parsed.sortField
        : defaultSearchState.sortField,
      sortDirection: isSearchSortDirection(parsed.sortDirection)
        ? parsed.sortDirection
        : defaultSearchState.sortDirection,
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

export function applyTheme(
  theme: ThemeMode,
  cardsView: CardViewMode = defaultPreferences.cardsView,
): void {
  if (typeof document === 'undefined') {
    return;
  }

  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolvedTheme = resolveTheme(theme, prefersDark);

  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.cardsView = cardsView;
}
