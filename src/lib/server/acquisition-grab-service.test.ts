import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AcquisitionJob, MediaItem } from '$lib/shared/types';

const seriesItem: MediaItem = {
  id: 'series:80',
  kind: 'series',
  title: 'Andor',
  year: 2022,
  rating: 8.5,
  poster: null,
  overview: 'Sci-fi',
  status: 'Ready to add',
  isExisting: false,
  isRequested: false,
  auditStatus: 'pending',
  audioLanguages: [],
  subtitleLanguages: [],
  sourceService: 'sonarr',
  origin: 'arr',
  inArr: false,
  inPlex: false,
  plexLibraries: [],
  canAdd: true,
  detail: null,
  requestPayload: {
    id: 80,
    tvdbId: 393189,
    seasons: [
      { seasonNumber: 0, monitored: false },
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: false },
      { seasonNumber: 3, monitored: false },
    ],
  },
};

const createdJob: AcquisitionJob = {
  id: 'job-1',
  itemId: seriesItem.id,
  arrItemId: 80,
  kind: 'series',
  title: seriesItem.title,
  sourceService: 'sonarr',
  status: 'queued',
  attempt: 1,
  maxRetries: 4,
  currentRelease: null,
  selectedReleaser: null,
  preferredReleaser: null,
  reasonCode: null,
  failureReason: null,
  validationSummary: null,
  autoRetrying: false,
  progress: null,
  queueStatus: 'Queued',
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'Any',
  },
  startedAt: '2026-04-02T10:05:00.000Z',
  updatedAt: '2026-04-02T10:05:00.000Z',
  completedAt: null,
  attempts: [],
};

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('acquisition grab service', () => {
  it('monitors only the selected seasons for new series grabs', async () => {
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/series') {
        return {
          id: 80,
        };
      }

      throw new Error(`Unexpected arrFetch path: ${path}`);
    });
    const recordJobCreated = vi.fn();
    const enqueue = vi.fn();
    const createJob = vi.fn().mockReturnValue(createdJob);
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...seriesItem,
      arrItemId: 80,
      canAdd: false,
      inArr: true,
      status: 'Already in Arr',
    } satisfies MediaItem);

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch,
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn().mockResolvedValue({
        rootFolderPath: 'C:\\TV',
        qualityProfileId: 11,
        languageProfileId: 2,
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        recordJobCreated,
      }),
    }));
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        enqueue,
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        createJob,
        findActiveJob: vi.fn().mockReturnValue(null),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
    }));

    const module = await import('$lib/server/acquisition-grab-service');
    await module.grabItem(
      seriesItem,
      {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      {
        qualityProfileId: 11,
        seasonNumbers: [2, 1, 2],
      },
    );

    expect(arrFetch).toHaveBeenCalledWith(
      'sonarr',
      '/api/v3/series',
      expect.objectContaining({
        body: expect.any(String),
        method: 'POST',
      }),
    );

    const [, , init] = arrFetch.mock.calls[0] as [string, string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      monitored: false,
      monitorNewItems: 'none',
      qualityProfileId: 11,
      languageProfileId: 2,
      rootFolderPath: 'C:\\TV',
      seasons: [
        { seasonNumber: 0, monitored: false },
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
        { seasonNumber: 3, monitored: false },
      ],
    });
    expect(fetchExistingSeries).toHaveBeenCalledWith(
      80,
      expect.objectContaining({
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      }),
      null,
      null,
    );
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(recordJobCreated).toHaveBeenCalledWith(createdJob);
    expect(enqueue).toHaveBeenCalledWith(createdJob.id);
  });

  it('collapses concurrent grab submissions for the same item into one Arr create', async () => {
    let resolveCreate: ((value: { id: number }) => void) | null = null;
    const createPromise = new Promise<{ id: number }>((resolve) => {
      resolveCreate = resolve;
    });
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/series') {
        return createPromise;
      }

      throw new Error(`Unexpected arrFetch path: ${path}`);
    });
    const createJob = vi.fn().mockReturnValue(createdJob);
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...seriesItem,
      arrItemId: 80,
      canAdd: false,
      inArr: true,
      status: 'Already in Arr',
    } satisfies MediaItem);

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch,
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn().mockResolvedValue({
        rootFolderPath: 'C:\\TV',
        qualityProfileId: 11,
        languageProfileId: 2,
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        recordJobCreated: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        enqueue: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        createJob,
        findActiveJob: vi.fn().mockReturnValue(null),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
    }));

    const module = await import('$lib/server/acquisition-grab-service');
    const first = module.grabItem(seriesItem, {
      preferredLanguage: 'English',
      subtitleLanguage: 'Any',
    });
    const second = module.grabItem(seriesItem, {
      preferredLanguage: 'English',
      subtitleLanguage: 'Any',
    });

    await Promise.resolve();
    expect(arrFetch).toHaveBeenCalledTimes(1);
    const createResolver =
      resolveCreate ??
      ((_: { id: number }) => {
        throw new Error('Expected Arr create resolver');
      });
    createResolver({ id: 80 });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(createJob).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
  });

  it('recovers acquisition tracking after Arr create when the first tracked-item fetch fails', async () => {
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/series') {
        return {
          id: 80,
        };
      }

      throw new Error(`Unexpected arrFetch path: ${path}`);
    });
    const createJob = vi.fn().mockReturnValue(createdJob);
    const fetchExistingSeries = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary Arr lookup failure'))
      .mockResolvedValue({
        ...seriesItem,
        arrItemId: 80,
        canAdd: false,
        inArr: true,
        status: 'Already in Arr',
      } satisfies MediaItem);

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch,
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn().mockResolvedValue({
        rootFolderPath: 'C:\\TV',
        qualityProfileId: 11,
        languageProfileId: 2,
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        recordJobCreated: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        enqueue: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        createJob,
        findActiveJob: vi.fn().mockReturnValue(null),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
    }));

    const module = await import('$lib/server/acquisition-grab-service');
    const result = await module.grabItem(seriesItem, {
      preferredLanguage: 'English',
      subtitleLanguage: 'Any',
    });

    expect(fetchExistingSeries).toHaveBeenCalledTimes(2);
    expect(createJob).toHaveBeenCalledTimes(1);
    expect(result.job?.id).toBe(createdJob.id);
    expect(result.item.arrItemId).toBe(80);
  });
});
