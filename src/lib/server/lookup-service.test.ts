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
                title: 'Fixture Workplace (US)',
                year: 2005,
                tvdbId: 73244,
                imdbId: 'tt0386676',
                monitored: true,
                folder: 'Fixture Workplace (US)',
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
      title: 'Fixture Workplace (US)',
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
          if (path === '/api/v3/series/lookup' && query?.term === 'Fixture Series') {
            return [
              {
                title: 'Fixture Series',
                year: 2022,
                id: 80,
                tvdbId: 393189,
                monitored: true,
                path: 'C:\\TV\\Fixture Series',
                added: '2025-04-22T10:28:21Z',
              },
            ];
          }

          if (path === '/api/v3/series/80') {
            return {
              id: 80,
              title: 'Fixture Series',
              year: 2022,
              monitored: true,
              path: 'C:\\TV\\Fixture Series',
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
    const results = await module.lookupItems('Fixture Series', 'series', undefined, {
      availability: 'all',
    });

    expect(arrFetch).toHaveBeenCalledWith('sonarr', '/api/v3/series/80');
    expect(results[0]).toMatchObject({
      id: 'series:80',
      title: 'Fixture Series',
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
                title: 'Fixture Workplace (US)',
                year: 2005,
                tvdbId: 73244,
                imdbId: 'tt0386676',
                monitored: true,
                folder: 'Fixture Workplace (US)',
                path: null,
                added: '0001-01-01T00:00:00Z',
              },
              {
                title: 'Workplace Joe',
                year: 2024,
                tvdbId: 454842,
                imdbId: 'tt30954909',
                monitored: true,
                folder: 'Workplace Joe',
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
            title: 'Fixture Workplace (US)',
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

    expect(availableResults.map((item) => item.title)).toEqual(['Fixture Workplace (US)']);
    expect(notAvailableResults.map((item) => item.title)).toEqual(['Workplace Joe']);
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
          if (path === '/api/v3/movie/lookup' && query?.term === 'Fixture Action') {
            return [
              {
                title: 'Fixture Action: Last Case',
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
      if (term === 'Fixture Action: Last Case') {
        return [
          {
            id: 'plex:movie:522938',
            kind: 'movie',
            title: 'Fixture Action: Last Case',
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
    const results = await module.lookupItems('Fixture Action', 'movie', undefined, {
      availability: 'all',
    });
    const match = results[0];

    expect(searchPlex).toHaveBeenCalledWith('Fixture Action', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Fixture Action: Last Case', 'movie');
    expect(match).toBeDefined();
    expect(match?.title).toBe('Fixture Action: Last Case');
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
          if (path === '/api/v3/movie/lookup' && query?.term === 'Fixture Action: Last Case 2019') {
            return [
              {
                title: 'Fixture Action: Last Case',
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
      if (term === 'Fixture Action: Last Case') {
        return [
          {
            id: 'plex:movie:522938',
            kind: 'movie',
            title: 'Fixture Action: Last Case',
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
    const results = await module.lookupItems('Fixture Action: Last Case 2019', 'movie', undefined, {
      availability: 'all',
    });
    const match = results[0];

    expect(searchPlex).toHaveBeenCalledWith('Fixture Action: Last Case 2019', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Fixture Action: Last Case', 'movie');
    expect(match).toBeDefined();
    expect(match?.title).toBe('Fixture Action: Last Case');
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
          if (path === '/api/v3/movie/lookup' && query?.term === 'Fixture Action') {
            return [
              {
                title: 'Fixture Action: Last Case',
                year: 2019,
                tmdbId: 522938,
                imdbId: 'tt1206885',
                status: 'released',
                monitored: false,
              },
              {
                title: 'John Fixture Action',
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
      if (term === 'Fixture Action: Last Case') {
        return [
          {
            id: 'plex:movie:522938',
            kind: 'movie',
            title: 'Fixture Action: Last Case',
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
    const allResults = await module.lookupItems('Fixture Action', 'movie', undefined, {
      availability: 'all',
    });
    const availableResults = await module.lookupItems('Fixture Action', 'movie', undefined, {
      availability: 'available-only',
    });
    searchPlex.mockClear();
    const notAvailableResults = await module.lookupItems('Fixture Action', 'movie', undefined, {
      availability: 'not-available-only',
    });

    expect(allResults.map((item) => item.title)).toEqual([
      'John Fixture Action',
      'Fixture Action: Last Case',
    ]);
    expect(availableResults.map((item) => item.title)).toEqual(['Fixture Action: Last Case']);
    expect(notAvailableResults.map((item) => item.title)).toEqual(['John Fixture Action']);
    expect(searchPlex).toHaveBeenCalledWith('Fixture Action', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Fixture Action: Last Case', 'movie');
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
          if (path === '/api/v3/movie/lookup' && query?.term === 'Fixture Action') {
            return [
              {
                title: 'Fixture Action III',
                year: 1988,
                tmdbId: 1370,
                status: 'released',
                monitored: false,
                alternateTitles: [{ title: 'Fixture Action 3' }],
              },
            ];
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockImplementation(async (term: string): Promise<MediaItem[]> => {
      if (term === 'Fixture Action') {
        return [
          {
            id: 'plex:movie:1370',
            kind: 'movie',
            title: 'Fixture Action 3',
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
    const allResults = await module.lookupItems('Fixture Action', 'movie', undefined, {
      availability: 'all',
    });
    const notAvailableResults = await module.lookupItems('Fixture Action', 'movie', undefined, {
      availability: 'not-available-only',
    });

    expect(allResults).toHaveLength(1);
    expect(allResults[0]).toMatchObject({
      title: 'Fixture Action III',
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
          if (path === '/api/v3/movie/lookup' && query?.term === 'Fixture Action') {
            return [
              {
                title: 'Fixture Action III',
                year: 1988,
                tmdbId: 1370,
                status: 'released',
                monitored: false,
                alternateTitles: [{ title: 'Fixture Action 3' }],
              },
            ];
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockImplementation(async (term: string): Promise<MediaItem[]> => {
      if (term === 'Fixture Action 3') {
        return [
          {
            id: 'plex:movie:1370',
            kind: 'movie',
            title: 'Fixture Action 3',
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
    const allResults = await module.lookupItems('Fixture Action', 'movie', undefined, {
      availability: 'all',
    });
    const notAvailableResults = await module.lookupItems('Fixture Action', 'movie', undefined, {
      availability: 'not-available-only',
    });

    expect(searchPlex).toHaveBeenCalledWith('Fixture Action', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Fixture Action III', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Fixture Action 3', 'movie');
    expect(allResults).toHaveLength(1);
    expect(allResults[0]).toMatchObject({
      title: 'Fixture Action III',
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
          if (path === '/api/v3/movie/lookup' && query?.term === 'Fixture Action') {
            return [
              ...Array.from({ length: 13 }, (_, index) => ({
                title: `Fixture Action Placeholder ${index + 1}`,
                year: 2025 - index,
                tmdbId: 9000 + index,
                status: 'released',
                monitored: false,
              })),
              {
                title: 'Fixture Action III',
                year: 1988,
                tmdbId: 1370,
                status: 'released',
                monitored: false,
                alternateTitles: [{ title: 'Fixture Action 3' }],
              },
            ];
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockImplementation(async (term: string): Promise<MediaItem[]> => {
      if (term === 'Fixture Action 3') {
        return [
          {
            id: 'plex:movie:1370',
            kind: 'movie',
            title: 'Fixture Action 3',
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
    const notAvailableResults = await module.lookupItems('Fixture Action', 'movie', undefined, {
      availability: 'not-available-only',
    });

    expect(searchPlex).toHaveBeenCalledWith('Fixture Action 3', 'movie');
    expect(notAvailableResults.map((item) => item.title)).not.toContain('Fixture Action III');
  });

  it('keeps tracked Arr titles visible in not-available-only when Plex also has them', async () => {
    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (
            service === 'radarr' &&
            path === '/api/v3/movie/lookup' &&
            query?.term === 'Fixture'
          ) {
            return [
              {
                title: 'Fixture Movie',
                year: 1999,
                id: 42,
                tmdbId: 603,
                monitored: true,
                hasFile: true,
                path: 'C:\\Media\\Movies\\Fixture Movie (1999)',
                added: '2025-04-22T10:28:21Z',
              },
            ];
          }

          if (service === 'radarr' && path === '/api/v3/movie/42') {
            return {
              id: 42,
              title: 'Fixture Movie',
              year: 1999,
              tmdbId: 603,
              monitored: true,
              hasFile: true,
              path: 'C:\\Media\\Movies\\Fixture Movie (1999)',
            };
          }

          if (service === 'radarr' && path === '/api/v3/moviefile/42') {
            return {
              id: 42,
              path: 'C:\\Media\\Movies\\Fixture Movie (1999)\\Fixture.Movie.1999.mkv',
            };
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockResolvedValue([
      {
        id: 'plex:movie:603',
        kind: 'movie',
        title: 'Fixture Movie',
        year: 1999,
        rating: 8.7,
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
        plexLibraries: ['Movies'],
        canAdd: false,
        detail: null,
        requestPayload: {
          Guid: [{ id: 'tmdb://603' }],
        },
      },
    ]);

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
    const notAvailableResults = await module.lookupItems('Fixture', 'movie', undefined, {
      availability: 'not-available-only',
    });

    expect(notAvailableResults).toHaveLength(1);
    expect(notAvailableResults[0]).toMatchObject({
      title: 'Fixture Movie',
      inArr: true,
      inPlex: true,
    });
  });

  it('uses supplemental alternate-title Plex lookups for tracked Arr titles too', async () => {
    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (
            service === 'radarr' &&
            path === '/api/v3/movie/lookup' &&
            query?.term === 'Fixture Queue'
          ) {
            return [
              {
                title: 'Fixture Queue',
                year: 2025,
                id: 727,
                tmdbId: 1285965,
                imdbId: 'tt32299316',
                monitored: true,
                hasFile: true,
                path: 'C:\\Media\\Movies\\Fixture Queue (2025)',
                added: '2026-04-17T11:47:51Z',
                alternateTitles: [{ title: 'Animales Peligrosos' }],
              },
            ];
          }

          if (service === 'radarr' && path === '/api/v3/movie/727') {
            return {
              id: 727,
              title: 'Fixture Queue',
              year: 2025,
              tmdbId: 1285965,
              imdbId: 'tt32299316',
              monitored: true,
              hasFile: true,
              path: 'C:\\Media\\Movies\\Fixture Queue (2025)',
              alternateTitles: [{ title: 'Animales Peligrosos' }],
              movieFileId: 349,
            };
          }

          if (service === 'radarr' && path === '/api/v3/moviefile/349') {
            return {
              id: 349,
              path: 'C:\\Media\\Movies\\Fixture Queue (2025)\\Fixture.Queue.2025.mkv',
            };
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockImplementation(async (term: string): Promise<MediaItem[]> => {
      if (term === 'Animales Peligrosos') {
        return [
          {
            id: 'plex:movie:1285965',
            kind: 'movie',
            title: 'Fixture Queue',
            year: 2025,
            rating: 6.4,
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
              Guid: [{ id: 'tmdb://1285965' }],
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
    const results = await module.lookupItems('Fixture Queue', 'movie', undefined, {
      availability: 'all',
    });

    expect(searchPlex).toHaveBeenCalledWith('Fixture Queue', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Animales Peligrosos', 'movie');
    expect(results[0]).toMatchObject({
      title: 'Fixture Queue',
      inArr: true,
      inPlex: true,
      plexLibraries: ['Movies ITA'],
    });
  });

  it('resolves Plex-only movie results into Arr-backed grab candidates', async () => {
    const plexOnlyItem: MediaItem = {
      id: 'plex:movie:2105',
      kind: 'movie',
      title: 'Fixture Pie',
      year: 1999,
      rating: 7.0,
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
      plexLibraries: ['Movies'],
      canAdd: false,
      detail: null,
      requestPayload: {
        Guid: [{ id: 'tmdb://2105' }],
      },
    };

    const arrFetch = vi
      .fn()
      .mockImplementation(
        async (
          service: string,
          path: string,
          _init: unknown,
          query?: Record<string, string | number>,
        ) => {
          if (
            service === 'radarr' &&
            path === '/api/v3/movie/lookup' &&
            query?.term === 'Fixture Pie'
          ) {
            return [
              {
                title: 'Fixture Pie',
                year: 1999,
                tmdbId: 2105,
                imdbId: 'tt0163651',
                status: 'released',
                monitored: false,
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
        plexConfigured: true,
        radarrConfigured: true,
        sonarrConfigured: false,
      }),
    }));

    const module = await import('$lib/server/lookup-service');
    const resolved = await module.resolveGrabCandidateFromPlexItem(plexOnlyItem);

    expect(resolved).toMatchObject({
      title: 'Fixture Pie',
      inPlex: true,
      origin: 'merged',
      requestPayload: expect.objectContaining({
        tmdbId: 2105,
      }),
    });
  });
});
