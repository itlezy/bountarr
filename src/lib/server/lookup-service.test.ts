import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '$lib/shared/types';

afterEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
});

describe('lookupItems', () => {
  it('keeps Sonarr lookup placeholders addable when the series is not actually tracked', async () => {
    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          _service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (path === '/api/v3/series/lookup' && query?.term === 'Office') {
            return [
              {
                title: 'The Office (US)',
                year: 2005,
                tvdbId: 73244,
                imdbId: 'tt0386676',
                monitored: true,
                folder: 'The Office (US)',
                path: null,
                added: '0001-01-01T00:00:00Z',
              },
            ];
          }

          return [];
        },
      );

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      searchPlex: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: false,
        radarrConfigured: false,
        sonarrConfigured: true,
      }),
    }));

    const module = await import('$lib/server/lookup-service');
    const results = await module.lookupItems('Office', 'series', undefined, {
      availability: 'all',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'The Office (US)',
      inArr: false,
      canAdd: true,
      status: 'Ready to add',
    });
  });

  it('hydrates tracked Sonarr series results when lookup returns a real series id', async () => {
    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          _service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (path === '/api/v3/series/lookup' && query?.term === 'Andor') {
            return [
              {
                title: 'Andor',
                year: 2022,
                id: 80,
                tvdbId: 393189,
                monitored: true,
                path: 'C:\\TV\\Andor',
                added: '2025-04-22T10:28:21Z',
              },
            ];
          }

          if (path === '/api/v3/series/80') {
            return {
              id: 80,
              title: 'Andor',
              year: 2022,
              monitored: true,
              path: 'C:\\TV\\Andor',
            };
          }

          if (path === '/api/v3/episode' && query?.seriesId === 80) {
            return [];
          }

          return [];
        },
      );

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      searchPlex: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: false,
        radarrConfigured: false,
        sonarrConfigured: true,
      }),
    }));

    const module = await import('$lib/server/lookup-service');
    const results = await module.lookupItems('Andor', 'series', undefined, {
      availability: 'all',
    });

    expect(arrFetch).toHaveBeenCalledWith('sonarr', '/api/v3/series/80');
    expect(results[0]).toMatchObject({
      id: 'series:80',
      title: 'Andor',
      inArr: true,
      canAdd: false,
    });
  });

  it('filters series results by availability after merging Plex ownership', async () => {
    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          _service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (path === '/api/v3/series/lookup' && query?.term === 'Office') {
            return [
              {
                title: 'The Office (US)',
                year: 2005,
                tvdbId: 73244,
                imdbId: 'tt0386676',
                monitored: true,
                folder: 'The Office (US)',
                path: null,
                added: '0001-01-01T00:00:00Z',
              },
              {
                title: 'Office Joe',
                year: 2024,
                tvdbId: 454842,
                imdbId: 'tt30954909',
                monitored: true,
                folder: 'Office Joe',
                path: null,
                added: '0001-01-01T00:00:00Z',
              },
            ];
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockImplementation(async (term: string): Promise<MediaItem[]> => {
      if (term === 'Office') {
        return [
          {
            id: 'plex:series:73244',
            kind: 'series',
            title: 'The Office (US)',
            year: 2005,
            rating: 8.9,
            poster: null,
            overview: 'Plex copy',
            status: 'Already in Plex',
            isExisting: false,
            isRequested: false,
            auditStatus: 'pending',
            audioLanguages: [],
            subtitleLanguages: [],
            sourceService: 'plex',
            origin: 'plex',
            inArr: false,
            inPlex: true,
            plexLibraries: ['TV'],
            canAdd: false,
            detail: null,
            requestPayload: {
              Guid: [{ id: 'tvdb://73244' }],
            },
          },
        ];
      }

      return [];
    });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      searchPlex,
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: true,
        radarrConfigured: false,
        sonarrConfigured: true,
      }),
    }));

    const module = await import('$lib/server/lookup-service');
    const availableResults = await module.lookupItems('Office', 'series', undefined, {
      availability: 'available-only',
    });
    const notAvailableResults = await module.lookupItems('Office', 'series', undefined, {
      availability: 'not-available-only',
    });

    expect(availableResults.map((item) => item.title)).toEqual(['The Office (US)']);
    expect(notAvailableResults.map((item) => item.title)).toEqual(['Office Joe']);
  });

  it('supplements broad search terms with exact Arr titles to suppress Plex-owned results', async () => {
    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          _service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (path === '/api/v3/movie/lookup' && query?.term === 'Rambo') {
            return [
              {
                title: 'Rambo: Last Blood',
                year: 2019,
                tmdbId: 522938,
                imdbId: 'tt1206885',
                status: 'released',
                monitored: false,
              },
            ];
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockImplementation(async (term: string): Promise<MediaItem[]> => {
      if (term === 'Rambo: Last Blood') {
        return [
          {
            id: 'plex:movie:522938',
            kind: 'movie',
            title: 'Rambo: Last Blood',
            year: 2019,
            rating: 6.5,
            poster: 'https://plex.example/poster.jpg',
            overview: 'Plex copy',
            status: 'Already in Plex',
            isExisting: false,
            isRequested: false,
            auditStatus: 'pending',
            audioLanguages: [],
            subtitleLanguages: [],
            sourceService: 'plex',
            origin: 'plex',
            inArr: false,
            inPlex: true,
            plexLibraries: ['Movies ITA'],
            canAdd: false,
            detail: null,
            requestPayload: {
              Guid: [{ id: 'tmdb://522938' }],
            },
          },
        ];
      }

      return [];
    });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      searchPlex,
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: true,
        radarrConfigured: true,
        sonarrConfigured: false,
      }),
    }));

    const module = await import('$lib/server/lookup-service');
    const results = await module.lookupItems('Rambo', 'movie', undefined, {
      availability: 'all',
    });
    const match = results[0];

    expect(searchPlex).toHaveBeenCalledWith('Rambo', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Rambo: Last Blood', 'movie');
    expect(match).toBeDefined();
    expect(match?.title).toBe('Rambo: Last Blood');
    expect(match?.inPlex).toBe(true);
    expect(match?.canAdd).toBe(false);
  });

  it('uses year-stripped fallback terms so Plex matches still suppress addability', async () => {
    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          _service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (path === '/api/v3/movie/lookup' && query?.term === 'Rambo: Last Blood 2019') {
            return [
              {
                title: 'Rambo: Last Blood',
                year: 2019,
                tmdbId: 522938,
                imdbId: 'tt1206885',
                status: 'released',
                monitored: false,
              },
            ];
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockImplementation(async (term: string): Promise<MediaItem[]> => {
      if (term === 'Rambo: Last Blood') {
        return [
          {
            id: 'plex:movie:522938',
            kind: 'movie',
            title: 'Rambo: Last Blood',
            year: 2019,
            rating: 6.5,
            poster: 'https://plex.example/poster.jpg',
            overview: 'Plex copy',
            status: 'Already in Plex',
            isExisting: false,
            isRequested: false,
            auditStatus: 'pending',
            audioLanguages: [],
            subtitleLanguages: [],
            sourceService: 'plex',
            origin: 'plex',
            inArr: false,
            inPlex: true,
            plexLibraries: ['Movies ITA'],
            canAdd: false,
            detail: null,
            requestPayload: {
              Guid: [{ id: 'tmdb://522938' }],
            },
          },
        ];
      }

      return [];
    });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      searchPlex,
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: true,
        radarrConfigured: true,
        sonarrConfigured: false,
      }),
    }));

    const module = await import('$lib/server/lookup-service');
    const results = await module.lookupItems('Rambo: Last Blood 2019', 'movie', undefined, {
      availability: 'all',
    });
    const match = results[0];

    expect(searchPlex).toHaveBeenCalledWith('Rambo: Last Blood 2019', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Rambo: Last Blood', 'movie');
    expect(match).toBeDefined();
    expect(match?.title).toBe('Rambo: Last Blood');
    expect(match?.inPlex).toBe(true);
    expect(match?.canAdd).toBe(false);
  });

  it('filters merged results by the requested availability mode', async () => {
    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          _service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (path === '/api/v3/movie/lookup' && query?.term === 'Rambo') {
            return [
              {
                title: 'Rambo: Last Blood',
                year: 2019,
                tmdbId: 522938,
                imdbId: 'tt1206885',
                status: 'released',
                monitored: false,
              },
              {
                title: 'John Rambo',
                year: 2008,
                tmdbId: 7555,
                imdbId: 'tt0462499',
                status: 'released',
                monitored: false,
              },
            ];
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockImplementation(async (term: string): Promise<MediaItem[]> => {
      if (term === 'Rambo: Last Blood') {
        return [
          {
            id: 'plex:movie:522938',
            kind: 'movie',
            title: 'Rambo: Last Blood',
            year: 2019,
            rating: 6.5,
            poster: null,
            overview: 'Plex copy',
            status: 'Already in Plex',
            isExisting: false,
            isRequested: false,
            auditStatus: 'pending',
            audioLanguages: [],
            subtitleLanguages: [],
            sourceService: 'plex',
            origin: 'plex',
            inArr: false,
            inPlex: true,
            plexLibraries: ['Movies ITA'],
            canAdd: false,
            detail: null,
            requestPayload: {
              Guid: [{ id: 'tmdb://522938' }],
            },
          },
        ];
      }

      return [];
    });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      searchPlex,
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: true,
        radarrConfigured: true,
        sonarrConfigured: false,
      }),
    }));

    const module = await import('$lib/server/lookup-service');
    const allResults = await module.lookupItems('Rambo', 'movie', undefined, {
      availability: 'all',
    });
    const availableResults = await module.lookupItems('Rambo', 'movie', undefined, {
      availability: 'available-only',
    });
    searchPlex.mockClear();
    const notAvailableResults = await module.lookupItems('Rambo', 'movie', undefined, {
      availability: 'not-available-only',
    });

    expect(allResults.map((item) => item.title)).toEqual(['John Rambo', 'Rambo: Last Blood']);
    expect(availableResults.map((item) => item.title)).toEqual(['Rambo: Last Blood']);
    expect(notAvailableResults.map((item) => item.title)).toEqual(['John Rambo']);
    expect(searchPlex).toHaveBeenCalledWith('Rambo', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Rambo: Last Blood', 'movie');
  });

  it('merges roman numeral and numeric title variants when Plex lacks stable ids', async () => {
    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          _service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (path === '/api/v3/movie/lookup' && query?.term === 'Rambo') {
            return [
              {
                title: 'Rambo III',
                year: 1988,
                tmdbId: 1370,
                status: 'released',
                monitored: false,
                alternateTitles: [{ title: 'Rambo 3' }],
              },
            ];
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockImplementation(async (term: string): Promise<MediaItem[]> => {
      if (term === 'Rambo') {
        return [
          {
            id: 'plex:movie:1370',
            kind: 'movie',
            title: 'Rambo 3',
            year: 1988,
            rating: 5.8,
            poster: null,
            overview: 'Plex copy',
            status: 'Already in Plex',
            isExisting: false,
            isRequested: false,
            auditStatus: 'pending',
            audioLanguages: [],
            subtitleLanguages: [],
            sourceService: 'plex',
            origin: 'plex',
            inArr: false,
            inPlex: true,
            plexLibraries: ['Movies ITA'],
            canAdd: false,
            detail: null,
            requestPayload: {},
          },
        ];
      }

      return [];
    });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      searchPlex,
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: true,
        radarrConfigured: true,
        sonarrConfigured: false,
      }),
    }));

    const module = await import('$lib/server/lookup-service');
    const allResults = await module.lookupItems('Rambo', 'movie', undefined, {
      availability: 'all',
    });
    const notAvailableResults = await module.lookupItems('Rambo', 'movie', undefined, {
      availability: 'not-available-only',
    });

    expect(allResults).toHaveLength(1);
    expect(allResults[0]).toMatchObject({
      title: 'Rambo III',
      inPlex: true,
      canAdd: false,
    });
    expect(notAvailableResults).toEqual([]);
  });

  it('uses alternate numeric titles for supplemental Plex lookups when the canonical title misses', async () => {
    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          _service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (path === '/api/v3/movie/lookup' && query?.term === 'Rambo') {
            return [
              {
                title: 'Rambo III',
                year: 1988,
                tmdbId: 1370,
                status: 'released',
                monitored: false,
                alternateTitles: [{ title: 'Rambo 3' }],
              },
            ];
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockImplementation(async (term: string): Promise<MediaItem[]> => {
      if (term === 'Rambo 3') {
        return [
          {
            id: 'plex:movie:1370',
            kind: 'movie',
            title: 'Rambo 3',
            year: 1988,
            rating: 5.8,
            poster: null,
            overview: 'Plex copy',
            status: 'Already in Plex',
            isExisting: false,
            isRequested: false,
            auditStatus: 'pending',
            audioLanguages: [],
            subtitleLanguages: [],
            sourceService: 'plex',
            origin: 'plex',
            inArr: false,
            inPlex: true,
            plexLibraries: ['Movies ITA'],
            canAdd: false,
            detail: null,
            requestPayload: {},
          },
        ];
      }

      return [];
    });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      searchPlex,
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: true,
        radarrConfigured: true,
        sonarrConfigured: false,
      }),
    }));

    const module = await import('$lib/server/lookup-service');
    const allResults = await module.lookupItems('Rambo', 'movie', undefined, {
      availability: 'all',
    });
    const notAvailableResults = await module.lookupItems('Rambo', 'movie', undefined, {
      availability: 'not-available-only',
    });

    expect(searchPlex).toHaveBeenCalledWith('Rambo', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Rambo III', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Rambo 3', 'movie');
    expect(allResults).toHaveLength(1);
    expect(allResults[0]).toMatchObject({
      title: 'Rambo III',
      inPlex: true,
      canAdd: false,
    });
    expect(notAvailableResults).toEqual([]);
  });

  it('supplements every result that can still land in the final response, not just the first 12', async () => {
    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          _service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (path === '/api/v3/movie/lookup' && query?.term === 'Rambo') {
            return [
              ...Array.from({ length: 13 }, (_, index) => ({
                title: `Rambo Placeholder ${index + 1}`,
                year: 2025 - index,
                tmdbId: 9000 + index,
                status: 'released',
                monitored: false,
              })),
              {
                title: 'Rambo III',
                year: 1988,
                tmdbId: 1370,
                status: 'released',
                monitored: false,
                alternateTitles: [{ title: 'Rambo 3' }],
              },
            ];
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockImplementation(async (term: string): Promise<MediaItem[]> => {
      if (term === 'Rambo 3') {
        return [
          {
            id: 'plex:movie:1370',
            kind: 'movie',
            title: 'Rambo 3',
            year: 1988,
            rating: 5.8,
            poster: null,
            overview: 'Plex copy',
            status: 'Already in Plex',
            isExisting: false,
            isRequested: false,
            auditStatus: 'pending',
            audioLanguages: [],
            subtitleLanguages: [],
            sourceService: 'plex',
            origin: 'plex',
            inArr: false,
            inPlex: true,
            plexLibraries: ['Movies ITA'],
            canAdd: false,
            detail: null,
            requestPayload: {},
          },
        ];
      }

      return [];
    });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      searchPlex,
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: true,
        radarrConfigured: true,
        sonarrConfigured: false,
      }),
    }));

    const module = await import('$lib/server/lookup-service');
    const notAvailableResults = await module.lookupItems('Rambo', 'movie', undefined, {
      availability: 'not-available-only',
    });

    expect(searchPlex).toHaveBeenCalledWith('Rambo 3', 'movie');
    expect(notAvailableResults.map((item) => item.title)).not.toContain('Rambo III');
  });
});
