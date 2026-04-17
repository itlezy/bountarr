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
  qualityProfileId: 11,
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'Any',
  },
  targetSeasonNumbers: [1, 2],
  targetEpisodeIds: [101, 102],
  startedAt: '2026-04-02T10:05:00.000Z',
  updatedAt: '2026-04-02T10:05:00.000Z',
  completedAt: null,
  attempts: [],
};

const seriesEpisodeRecords = [
  { id: 101, seasonNumber: 1 },
  { id: 102, seasonNumber: 2 },
  { id: 103, seasonNumber: 3 },
];
const selectedSeasonNumbers = [1, 2];

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
    const createOrReuseActiveJob = vi.fn().mockReturnValue({ created: true, job: createdJob });
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...seriesItem,
      arrItemId: 80,
      canAdd: false,
      inArr: true,
      requestPayload: {
        ...seriesItem.requestPayload,
        id: 80,
        qualityProfileId: 11,
      },
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
        createOrReuseActiveJob,
        findActiveJob: vi.fn().mockReturnValue(null),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue(seriesEpisodeRecords),
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
    expect(createOrReuseActiveJob).toHaveBeenCalledTimes(1);
    expect(createOrReuseActiveJob).toHaveBeenCalledWith(
      expect.objectContaining({
        arrItemId: 80,
        itemId: seriesItem.id,
        kind: 'series',
        qualityProfileId: 11,
        sourceService: 'sonarr',
        targetEpisodeIds: null,
        targetSeasonNumbers: [1, 2],
      }),
    );
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
    const createOrReuseActiveJob = vi.fn().mockReturnValue({ created: true, job: createdJob });
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...seriesItem,
      arrItemId: 80,
      canAdd: false,
      inArr: true,
      requestPayload: {
        ...seriesItem.requestPayload,
        id: 80,
        qualityProfileId: 11,
      },
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
        createOrReuseActiveJob,
        findActiveJob: vi.fn().mockReturnValue(null),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue(seriesEpisodeRecords),
    }));

    const module = await import('$lib/server/acquisition-grab-service');
    const first = module.grabItem(seriesItem, {
      preferredLanguage: 'English',
      subtitleLanguage: 'Any',
    }, {
      seasonNumbers: selectedSeasonNumbers,
    });
    const second = module.grabItem(seriesItem, {
      preferredLanguage: 'English',
      subtitleLanguage: 'Any',
    }, {
      seasonNumbers: selectedSeasonNumbers,
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

    expect(createOrReuseActiveJob).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual(secondResult);
  });

  it('treats a stale second submit after Arr create as the tracked-item path', async () => {
    let createCalls = 0;
    let activeJob: AcquisitionJob | null = null;
    const arrFetch = vi.fn();
    arrFetch.mockImplementation(async (_service: string, path: string, init?: RequestInit) => {
      if (path === '/api/v3/series' && init?.method === 'POST') {
        createCalls += 1;
        if (createCalls === 1) {
          return {
            id: 80,
          };
        }

        throw new Error('sonarr 400: Series has already been added');
      }

      if (path === '/api/v3/series' && !init?.method) {
        return [
          {
            id: 80,
            tvdbId: 393189,
            title: 'Andor',
            year: 2022,
          },
        ];
      }

      throw new Error(`Unexpected arrFetch path: ${path}`);
    });
    const createOrReuseActiveJob = vi.fn().mockImplementation(() => {
      if (activeJob) {
        return { created: false, job: activeJob };
      }

      activeJob = createdJob;
      return { created: true, job: createdJob };
    });
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...seriesItem,
      arrItemId: 80,
      canAdd: false,
      inArr: true,
      requestPayload: {
        ...seriesItem.requestPayload,
        id: 80,
        qualityProfileId: 11,
      },
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
        createOrReuseActiveJob,
        deleteJob: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue(seriesEpisodeRecords),
    }));

    const module = await import('$lib/server/acquisition-grab-service');
    const first = await module.grabItem(seriesItem, {
      preferredLanguage: 'English',
      subtitleLanguage: 'Any',
    }, {
      seasonNumbers: selectedSeasonNumbers,
    });
    const second = await module.grabItem(seriesItem, {
      preferredLanguage: 'English',
      subtitleLanguage: 'Any',
    }, {
      seasonNumbers: selectedSeasonNumbers,
    });

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.job?.id).toBe(first.job?.id);
    expect(second.item.arrItemId).toBe(first.item.arrItemId);
    expect(second.message).toContain('Reusing the active alternate-release grab');
    expect(createOrReuseActiveJob).toHaveBeenCalledTimes(2);
    expect(fetchExistingSeries).toHaveBeenCalledTimes(2);
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
    const createOrReuseActiveJob = vi.fn().mockReturnValue({ created: true, job: createdJob });
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
        createOrReuseActiveJob,
        findActiveJob: vi.fn().mockReturnValue(null),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue(seriesEpisodeRecords),
    }));

    const module = await import('$lib/server/acquisition-grab-service');
    const result = await module.grabItem(seriesItem, {
      preferredLanguage: 'English',
      subtitleLanguage: 'Any',
    }, {
      seasonNumbers: selectedSeasonNumbers,
    });

    expect(fetchExistingSeries).toHaveBeenCalledTimes(2);
    expect(createOrReuseActiveJob).toHaveBeenCalledTimes(1);
    expect(result.job?.id).toBe(createdJob.id);
    expect(result.item.arrItemId).toBe(80);
  });

  it('starts an alternate acquisition job for items already tracked in Arr', async () => {
    const trackedSeriesItem: MediaItem = {
      ...seriesItem,
      arrItemId: 80,
      canAdd: true,
      inArr: true,
      isExisting: true,
      isRequested: true,
      status: 'Already in Arr',
    };
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...trackedSeriesItem,
      canAdd: false,
      requestPayload: {
        ...seriesItem.requestPayload,
        id: 80,
        qualityProfileId: 11,
      },
      sourceService: 'sonarr',
    } satisfies MediaItem);
    const createOrReuseActiveJob = vi.fn().mockReturnValue({ created: true, job: createdJob });
    const arrFetch = vi.fn();

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch,
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn(),
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
        createOrReuseActiveJob,
        findActiveJob: vi.fn().mockReturnValue(null),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue('flux'),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue(seriesEpisodeRecords),
    }));

    const module = await import('$lib/server/acquisition-grab-service');
    const result = await module.grabItem(trackedSeriesItem, {
      preferredLanguage: 'English',
      subtitleLanguage: 'Any',
    }, {
      seasonNumbers: [2],
    });

    expect(arrFetch).not.toHaveBeenCalled();
    expect(fetchExistingSeries).toHaveBeenCalledWith(
      80,
      expect.objectContaining({
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      }),
      null,
      null,
    );
    expect(createOrReuseActiveJob).toHaveBeenCalledTimes(1);
    expect(createOrReuseActiveJob).toHaveBeenCalledWith(
      expect.objectContaining({
        arrItemId: 80,
        qualityProfileId: 11,
        targetEpisodeIds: null,
        targetSeasonNumbers: [2],
      }),
    );
    expect(result.existing).toBe(true);
    expect(result.job?.id).toBe(createdJob.id);
    expect(result.message).toContain('Alternate-release acquisition started');
  });

  it('updates the tracked Arr title to the requested quality profile before starting a new grab', async () => {
    const trackedSeriesItem: MediaItem = {
      ...seriesItem,
      arrItemId: 80,
      canAdd: true,
      inArr: true,
      isExisting: true,
      isRequested: true,
      status: 'Already in Arr',
    };
    const fetchExistingSeries = vi
      .fn()
      .mockResolvedValueOnce({
        ...trackedSeriesItem,
        canAdd: false,
        requestPayload: {
          ...seriesItem.requestPayload,
          id: 80,
          qualityProfileId: 11,
        },
        sourceService: 'sonarr',
      } satisfies MediaItem)
      .mockResolvedValueOnce({
        ...trackedSeriesItem,
        canAdd: false,
        requestPayload: {
          ...seriesItem.requestPayload,
          id: 80,
          qualityProfileId: 22,
        },
        sourceService: 'sonarr',
      } satisfies MediaItem);
    const createOrReuseActiveJob = vi.fn().mockReturnValue({ created: true, job: createdJob });
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string, init?: RequestInit) => {
      if (!init && path === '/api/v3/series/80') {
        return {
          id: 80,
          monitored: false,
          qualityProfileId: 11,
          seasons: [
            { seasonNumber: 0, monitored: false },
            { seasonNumber: 1, monitored: false },
            { seasonNumber: 2, monitored: true },
          ],
        };
      }

      if (init?.method === 'PUT' && path === '/api/v3/series/80') {
        return {
          id: 80,
          qualityProfileId: 22,
        };
      }

      throw new Error(`Unexpected arrFetch path: ${path}`);
    });

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch,
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn(),
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
        createOrReuseActiveJob,
        findActiveJob: vi.fn().mockReturnValue(null),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue('flux'),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
    }));

    const module = await import('$lib/server/acquisition-grab-service');
    const result = await module.grabItem(
      trackedSeriesItem,
      {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      {
        qualityProfileId: 22,
        seasonNumbers: [2],
      },
    );

    expect(arrFetch).toHaveBeenNthCalledWith(1, 'sonarr', '/api/v3/series/80');
    expect(arrFetch).toHaveBeenNthCalledWith(
      2,
      'sonarr',
      '/api/v3/series/80',
      expect.objectContaining({
        body: expect.any(String),
        method: 'PUT',
      }),
    );
    expect(JSON.parse(String((arrFetch.mock.calls[1] as [string, string, RequestInit])[2].body))).toMatchObject({
      qualityProfileId: 22,
    });
    expect(fetchExistingSeries).toHaveBeenCalledTimes(1);
    expect(createOrReuseActiveJob).toHaveBeenCalledWith(
      expect.objectContaining({
        arrItemId: 80,
        qualityProfileId: 22,
        targetSeasonNumbers: [2],
      }),
    );
    expect(result.item.requestPayload?.qualityProfileId).toBe(22);
  });

  it('does not update the tracked Arr title when claiming the active job resolves to a conflicting grab', async () => {
    const trackedSeriesItem: MediaItem = {
      ...seriesItem,
      arrItemId: 80,
      canAdd: true,
      inArr: true,
      isExisting: true,
      isRequested: true,
      status: 'Already in Arr',
    };
    const conflictingJob: AcquisitionJob = {
      ...createdJob,
      preferences: {
        preferredLanguage: 'Spanish',
        subtitleLanguage: 'Any',
      },
      qualityProfileId: 11,
      targetSeasonNumbers: [1],
    };
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...trackedSeriesItem,
      canAdd: false,
      requestPayload: {
        ...seriesItem.requestPayload,
        id: 80,
        qualityProfileId: 11,
      },
      sourceService: 'sonarr',
    } satisfies MediaItem);
    const arrFetch = vi.fn();

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch,
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn(),
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
        createOrReuseActiveJob: vi.fn().mockReturnValue({
          created: false,
          job: conflictingJob,
        }),
        deleteJob: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue('flux'),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
    }));

    const module = await import('$lib/server/acquisition-grab-service');

    await expect(
      module.grabItem(
        trackedSeriesItem,
        {
          preferredLanguage: 'English',
          subtitleLanguage: 'Any',
        },
        {
          qualityProfileId: 22,
          seasonNumbers: [2],
        },
      ),
    ).rejects.toThrow('Cancel the current grab before starting a different one.');

    expect(arrFetch).not.toHaveBeenCalled();
  });

  it('rolls back a newly claimed tracked job when the Arr quality update fails', async () => {
    const trackedSeriesItem: MediaItem = {
      ...seriesItem,
      arrItemId: 80,
      canAdd: true,
      inArr: true,
      isExisting: true,
      isRequested: true,
      status: 'Already in Arr',
    };
    const recordJobCreated = vi.fn();
    const enqueue = vi.fn();
    const deleteJob = vi.fn();
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...trackedSeriesItem,
      canAdd: false,
      requestPayload: {
        ...seriesItem.requestPayload,
        id: 80,
        qualityProfileId: 11,
      },
      sourceService: 'sonarr',
    } satisfies MediaItem);
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string, init?: RequestInit) => {
      if (!init && path === '/api/v3/series/80') {
        return {
          id: 80,
          monitored: false,
          qualityProfileId: 11,
          seasons: [{ seasonNumber: 2, monitored: false }],
        };
      }

      if (init?.method === 'PUT' && path === '/api/v3/series/80') {
        throw new Error('Unable to update tracked quality profile');
      }

      throw new Error(`Unexpected arrFetch path: ${path}`);
    });

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch,
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn(),
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
        createOrReuseActiveJob: vi.fn().mockReturnValue({ created: true, job: createdJob }),
        deleteJob,
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue('flux'),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
    }));

    const module = await import('$lib/server/acquisition-grab-service');

    await expect(
      module.grabItem(
        trackedSeriesItem,
        {
          preferredLanguage: 'English',
          subtitleLanguage: 'Any',
        },
        {
          qualityProfileId: 22,
          seasonNumbers: [2],
        },
      ),
    ).rejects.toThrow('Unable to update tracked quality profile');

    expect(deleteJob).toHaveBeenCalledWith(createdJob.id);
    expect(recordJobCreated).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('keeps a newly claimed tracked job when the quality update succeeds without refetching the Arr item again', async () => {
    const trackedSeriesItem: MediaItem = {
      ...seriesItem,
      arrItemId: 80,
      canAdd: true,
      inArr: true,
      isExisting: true,
      isRequested: true,
      status: 'Already in Arr',
    };
    const recordJobCreated = vi.fn();
    const enqueue = vi.fn();
    const deleteJob = vi.fn();
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...trackedSeriesItem,
      canAdd: false,
      requestPayload: {
        ...seriesItem.requestPayload,
        id: 80,
        qualityProfileId: 11,
      },
      sourceService: 'sonarr',
    } satisfies MediaItem);
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string, init?: RequestInit) => {
      if (!init && path === '/api/v3/series/80') {
        return {
          id: 80,
          monitored: false,
          qualityProfileId: 11,
          seasons: [{ seasonNumber: 2, monitored: false }],
        };
      }

      if (init?.method === 'PUT' && path === '/api/v3/series/80') {
        return {
          id: 80,
          monitored: false,
          qualityProfileId: 22,
          seasons: [{ seasonNumber: 2, monitored: false }],
        };
      }

      throw new Error(`Unexpected arrFetch path: ${path}`);
    });

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch,
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn(),
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
        createOrReuseActiveJob: vi.fn().mockReturnValue({ created: true, job: createdJob }),
        deleteJob,
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue('flux'),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
    }));

    const module = await import('$lib/server/acquisition-grab-service');
    const result = await module.grabItem(
      trackedSeriesItem,
      {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      {
        qualityProfileId: 22,
        seasonNumbers: [2],
      },
    );

    expect(fetchExistingSeries).toHaveBeenCalledTimes(1);
    expect(deleteJob).not.toHaveBeenCalled();
    expect(recordJobCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: createdJob.id,
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(createdJob.id);
    expect(result.item.requestPayload?.qualityProfileId).toBe(22);
  });

  it('reuses an active season-scoped grab even when the stored episode snapshot drifted', async () => {
    const trackedSeriesItem: MediaItem = {
      ...seriesItem,
      arrItemId: 80,
      canAdd: true,
      inArr: true,
      isExisting: true,
      isRequested: true,
      status: 'Already in Arr',
    };
    const activeSeasonJob: AcquisitionJob = {
      ...createdJob,
      targetEpisodeIds: [101],
      targetSeasonNumbers: [2],
    };
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...trackedSeriesItem,
      canAdd: false,
      requestPayload: {
        ...seriesItem.requestPayload,
        id: 80,
        qualityProfileId: 11,
      },
      sourceService: 'sonarr',
    } satisfies MediaItem);

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch: vi.fn(),
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn(),
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
        createOrReuseActiveJob: vi.fn().mockReturnValue({
          created: false,
          job: activeSeasonJob,
        }),
        deleteJob: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue([
        { id: 102, seasonNumber: 2 },
        { id: 103, seasonNumber: 2 },
      ]),
    }));

    const module = await import('$lib/server/acquisition-grab-service');
    const result = await module.grabItem(
      trackedSeriesItem,
      {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      {
        seasonNumbers: [2],
      },
    );

    expect(result.existing).toBe(true);
    expect(result.job?.id).toBe(activeSeasonJob.id);
    expect(result.message).toContain('Reusing the active alternate-release grab');
  });

  it('stores selected seasons as the canonical completion scope for tracked series grabs', async () => {
    const trackedSeriesItem: MediaItem = {
      ...seriesItem,
      arrItemId: 80,
      canAdd: true,
      inArr: true,
      isExisting: true,
      isRequested: true,
      status: 'Already in Arr',
    };
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...trackedSeriesItem,
      canAdd: false,
      requestPayload: {
        ...seriesItem.requestPayload,
        id: 80,
        qualityProfileId: 11,
      },
      sourceService: 'sonarr',
    } satisfies MediaItem);
    const createOrReuseActiveJob = vi.fn().mockReturnValue({ created: true, job: createdJob });

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch: vi.fn(),
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn(),
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
        createOrReuseActiveJob,
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
      trackedSeriesItem,
      {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      {
        seasonNumbers: [2],
      },
    );

    expect(createOrReuseActiveJob).toHaveBeenCalledWith(
      expect.objectContaining({
        arrItemId: 80,
        qualityProfileId: 11,
        targetEpisodeIds: null,
        targetSeasonNumbers: [2],
      }),
    );
  });

  it('rejects a conflicting active series grab instead of silently reusing it', async () => {
    const trackedSeriesItem: MediaItem = {
      ...seriesItem,
      arrItemId: 80,
      canAdd: true,
      inArr: true,
      isExisting: true,
      isRequested: true,
      status: 'Already in Arr',
    };
    const conflictingJob: AcquisitionJob = {
      ...createdJob,
      preferences: {
        preferredLanguage: 'Spanish',
        subtitleLanguage: 'Any',
      },
      targetEpisodeIds: [101],
      targetSeasonNumbers: [1],
    };
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...trackedSeriesItem,
      canAdd: false,
      requestPayload: {
        ...seriesItem.requestPayload,
        id: 80,
        qualityProfileId: 11,
      },
      sourceService: 'sonarr',
    } satisfies MediaItem);

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch: vi.fn(),
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn(),
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
        createOrReuseActiveJob: vi.fn().mockReturnValue({
          created: false,
          job: conflictingJob,
        }),
        deleteJob: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      findPreferredReleaser: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
      fetchExistingSeries,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue(seriesEpisodeRecords),
    }));

    const module = await import('$lib/server/acquisition-grab-service');

    await expect(
      module.grabItem(
        trackedSeriesItem,
        {
          preferredLanguage: 'English',
          subtitleLanguage: 'Any',
        },
        {
          seasonNumbers: [2],
        },
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('already has an active alternate-release grab'),
      status: 409,
    });
  });

  it('rejects a conflicting active series grab when the requested quality profile differs', async () => {
    const trackedSeriesItem: MediaItem = {
      ...seriesItem,
      arrItemId: 80,
      canAdd: true,
      inArr: true,
      isExisting: true,
      isRequested: true,
      status: 'Already in Arr',
    };
    const conflictingJob: AcquisitionJob = {
      ...createdJob,
      qualityProfileId: 11,
      targetSeasonNumbers: [2],
    };
    const fetchExistingSeries = vi.fn().mockResolvedValue({
      ...trackedSeriesItem,
      canAdd: false,
      requestPayload: {
        ...seriesItem.requestPayload,
        id: 80,
        qualityProfileId: 11,
      },
      sourceService: 'sonarr',
    } satisfies MediaItem);

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionMaxRetries: () => 4,
      arrFetch: vi.fn(),
    }));
    vi.doMock('$lib/server/config-service', () => ({
      fetchServiceDefaults: vi.fn(),
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
        createOrReuseActiveJob: vi.fn().mockReturnValue({
          created: false,
          job: conflictingJob,
        }),
        deleteJob: vi.fn(),
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

    await expect(
      module.grabItem(
        trackedSeriesItem,
        {
          preferredLanguage: 'English',
          subtitleLanguage: 'Any',
        },
        {
          qualityProfileId: 22,
          seasonNumbers: [2],
        },
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('quality profile'),
      status: 409,
    });
  });
});
