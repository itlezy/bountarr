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
          if (service === 'radarr' && path === '/api/v3/movie/lookup' && query?.term === 'Matrix') {
            return [
              {
                title: 'The Matrix',
                year: 1999,
                id: 42,
                tmdbId: 603,
                monitored: true,
                hasFile: true,
                path: 'C:\\Media\\Movies\\The Matrix (1999)',
                added: '2025-04-22T10:28:21Z',
              },
            ];
          }

          if (service === 'radarr' && path === '/api/v3/movie/42') {
            return {
              id: 42,
              title: 'The Matrix',
              year: 1999,
              tmdbId: 603,
              monitored: true,
              hasFile: true,
              path: 'C:\\Media\\Movies\\The Matrix (1999)',
            };
          }

          if (service === 'radarr' && path === '/api/v3/moviefile/42') {
            return {
              id: 42,
              path: 'C:\\Media\\Movies\\The Matrix (1999)\\The.Matrix.1999.mkv',
            };
          }

          return [];
        },
      );

    const searchPlex = vi.fn().mockResolvedValue([
      {
        id: 'plex:movie:603',
        kind: 'movie',
        title: 'The Matrix',
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
    const notAvailableResults = await module.lookupItems('Matrix', 'movie', undefined, {
      availability: 'not-available-only',
    });

    expect(notAvailableResults).toHaveLength(1);
    expect(notAvailableResults[0]).toMatchObject({
      title: 'The Matrix',
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
            query?.term === 'Dangerous Animals'
          ) {
            return [
              {
                title: 'Dangerous Animals',
                year: 2025,
                id: 727,
                tmdbId: 1285965,
                imdbId: 'tt32299316',
                monitored: true,
                hasFile: true,
                path: 'C:\\Media\\Movies\\Dangerous Animals (2025)',
                added: '2026-04-17T11:47:51Z',
                alternateTitles: [{ title: 'Animales Peligrosos' }],
              },
            ];
          }

          if (service === 'radarr' && path === '/api/v3/movie/727') {
            return {
              id: 727,
              title: 'Dangerous Animals',
              year: 2025,
              tmdbId: 1285965,
              imdbId: 'tt32299316',
              monitored: true,
              hasFile: true,
              path: 'C:\\Media\\Movies\\Dangerous Animals (2025)',
              alternateTitles: [{ title: 'Animales Peligrosos' }],
              movieFileId: 349,
            };
          }

          if (service === 'radarr' && path === '/api/v3/moviefile/349') {
            return {
              id: 349,
              path: 'C:\\Media\\Movies\\Dangerous Animals (2025)\\Dangerous.Animals.2025.mkv',
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
            title: 'Dangerous Animals',
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
    const results = await module.lookupItems('Dangerous Animals', 'movie', undefined, {
      availability: 'all',
    });

    expect(searchPlex).toHaveBeenCalledWith('Dangerous Animals', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Animales Peligrosos', 'movie');
    expect(results[0]).toMatchObject({
      title: 'Dangerous Animals',
      inArr: true,
      inPlex: true,
      plexLibraries: ['Movies ITA'],
    });
  });

  it('resolves Plex-only movie results into Arr-backed grab candidates', async () => {
    const plexOnlyItem: MediaItem = {
      id: 'plex:movie:2105',
      kind: 'movie',
      title: 'American Pie',
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
          if (service === 'radarr' && path === '/api/v3/movie/lookup' && query?.term === 'American Pie') {
            return [
              {
                title: 'American Pie',
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
      title: 'American Pie',
      inPlex: true,
      origin: 'merged',
      requestPayload: expect.objectContaining({
        tmdbId: 2105,
      }),
    });
  });
});
