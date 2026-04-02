import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, loadPreferences, loadSearchState } from '$lib/client/storage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('search storage', () => {
  it('defaults the availability filter to only not available', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    });

    expect(loadSearchState()).toEqual({
      activeView: 'search',
      query: '',
      kind: 'all',
      availability: 'not-available-only',
      sortField: 'popularity',
      sortDirection: 'desc',
    });
  });

  it('falls back to only not available when reading legacy boolean search state', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(
        JSON.stringify({
          activeView: 'search',
          query: 'Rambo',
          kind: 'movie',
          includeAvailable: true,
        }),
      ),
      setItem: vi.fn(),
    });

    expect(loadSearchState()).toEqual({
      activeView: 'search',
      query: 'Rambo',
      kind: 'movie',
      availability: 'not-available-only',
      sortField: 'popularity',
      sortDirection: 'desc',
    });
  });

  it('falls back to the default sort when persisted search sorting is unsupported', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(
        JSON.stringify({
          activeView: 'search',
          query: 'Heat',
          kind: 'movie',
          availability: 'all',
          sortField: 'runtime',
          sortDirection: 'sideways',
        }),
      ),
      setItem: vi.fn(),
    });

    expect(loadSearchState()).toEqual({
      activeView: 'search',
      query: 'Heat',
      kind: 'movie',
      availability: 'all',
      sortField: 'popularity',
      sortDirection: 'desc',
    });
  });
});

describe('preferences storage', () => {
  it('falls back to the default preferred audio when persisted data is unsupported', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(
        JSON.stringify({
          cardsView: 'square',
          preferredLanguage: 'Klingon',
          subtitleLanguage: 'German',
          theme: 'dark',
        }),
      ),
      setItem: vi.fn(),
    });

    expect(loadPreferences()).toEqual({
      cardsView: 'square',
      preferredLanguage: 'English',
      subtitleLanguage: 'German',
      theme: 'dark',
    });
  });

  it('keeps supported named themes from persisted preferences', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(
        JSON.stringify({
          cardsView: 'outline',
          preferredLanguage: 'English',
          subtitleLanguage: 'Any',
          theme: 'tron',
        }),
      ),
      setItem: vi.fn(),
    });

    expect(loadPreferences()).toEqual({
      cardsView: 'outline',
      preferredLanguage: 'English',
      subtitleLanguage: 'Any',
      theme: 'tron',
    });
  });

  it('falls back to the default cards view when persisted data is unsupported', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(
        JSON.stringify({
          cardsView: 'hexagon',
          preferredLanguage: 'English',
          subtitleLanguage: 'Any',
          theme: 'dark',
        }),
      ),
      setItem: vi.fn(),
    });

    expect(loadPreferences()).toEqual({
      cardsView: 'rounded',
      preferredLanguage: 'English',
      subtitleLanguage: 'Any',
      theme: 'dark',
    });
  });
});

describe('theme application', () => {
  it('resolves system into the current browser color scheme', () => {
    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    });
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {},
      },
    });

    applyTheme('system', 'rounded');

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.cardsView).toBe('rounded');
  });

  it('applies named themes directly', () => {
    vi.stubGlobal('window', {
      matchMedia: vi.fn().mockReturnValue({ matches: false }),
    });
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {},
      },
    });

    applyTheme('matrix', 'outline');

    expect(document.documentElement.dataset.theme).toBe('matrix');
    expect(document.documentElement.dataset.cardsView).toBe('outline');
  });
});
