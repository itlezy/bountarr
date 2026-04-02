import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '$lib/shared/types';

afterEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
});

describe('searchPlex', () => {
  it('disables section search after a Plex 400 and keeps using global hub results', async () => {
    const info = vi.fn();
    const warn = vi.fn();

    class MockPlexHttpError extends Error {
      readonly path: string;
      readonly status: number;
      readonly statusText: string;

      constructor(path: string, status: number, statusText: string) {
        super(`Plex ${status}`);
        this.name = 'PlexHttpError';
        this.path = path;
        this.status = status;
        this.statusText = statusText;
      }
    }

    const plexFetch = vi
      .fn()
      .mockImplementation(async (_baseUrl: string, _token: string, path: string) => {
        if (path === '/library/sections') {
          return {
            MediaContainer: {
              Directory: [{ key: '1', title: 'Movies', type: 'movie' }],
            },
          };
        }

        if (path === '/hubs/search') {
          return {
            MediaContainer: {
              Hub: [
                {
                  type: 'movie',
                  Metadata: [{ ratingKey: '522938', title: 'Rambo: Last Blood' }],
                },
              ],
            },
          };
        }

        if (path === '/library/sections/1/search') {
          throw new MockPlexHttpError(path, 400, 'Bad Request');
        }

        throw new Error(`Unexpected path ${path}`);
      });

    vi.doMock('$lib/server/logger', () => ({
      createAreaLogger: () => ({
        info,
        warn,
      }),
      toErrorLogContext: (error: unknown) =>
        error instanceof Error ? { error: error.message, stack: error.stack ?? null } : {},
    }));
    vi.doMock('$lib/server/plex-client', () => ({
      PlexHttpError: MockPlexHttpError,
      getPlexConfig: () => ({
        baseUrl: 'https://plex.example:32400',
        token: 'secret',
      }),
      plexFetch,
    }));
    vi.doMock('$lib/server/plex-normalize', () => ({
      extractPlexPoster: () => null,
      hasStablePlexExternalIds: () => true,
      mergePlexResults: (items: MediaItem[]) => items,
      normalizePlexRecentSectionResult: vi.fn(),
      normalizePlexSectionKind: (type: string | null) =>
        type === 'movie' || type === 'show' ? (type === 'show' ? 'series' : 'movie') : null,
      normalizePlexSectionResult: vi.fn(),
    }));
    vi.doMock('$lib/server/raw', () => ({
      asArray: (value: unknown) => (Array.isArray(value) ? value : []),
      asRecord: (value: unknown) => (value && typeof value === 'object' ? value : {}),
      asString: (value: unknown) => (typeof value === 'string' ? value : null),
      asNumber: (value: unknown) => (typeof value === 'number' ? value : null),
    }));

    const module = await import('$lib/server/plex-service');
    const firstResults = await module.searchPlex('Rambo', 'movie');
    const secondResults = await module.searchPlex('Rambo', 'movie');

    expect(firstResults).toHaveLength(1);
    expect(secondResults).toHaveLength(1);
    expect(info).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(
      plexFetch.mock.calls.filter((call) => call[2] === '/library/sections/1/search'),
    ).toHaveLength(1);
  });
});
