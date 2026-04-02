import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
});

describe('queue dashboard service', () => {
  it('keeps Arr ids on dashboard fallback items so audit cards can delete them', async () => {
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/history') {
        return {
          records: [
            {
              movieId: 603,
              sourceTitle: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
              movie: {
                title: 'The Matrix',
                year: 1999,
                status: 'missing',
              },
            },
          ],
        };
      }

      if (path === '/api/v3/queue') {
        return {
          records: [],
        };
      }

      return {
        records: [],
      };
    });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: false,
        radarrConfigured: true,
        sonarrConfigured: false,
      }),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn().mockRejectedValue(new Error('missing from arr lookup')),
      fetchExistingSeries: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-service', () => ({
      ensureAcquisitionWorkers: vi.fn(),
      getQueueAcquisitionJobs: () => [],
    }));

    const module = await import('$lib/server/queue-dashboard-service');
    const dashboard = await module.getDashboard({
      cardsView: 'rounded',
      preferredLanguage: 'English',
      subtitleLanguage: 'English',
      theme: 'system',
    });

    expect(dashboard.items[0]).toMatchObject({
      arrItemId: 603,
      canDeleteFromArr: true,
      inArr: true,
      title: 'The Matrix',
    });
  });
});
