import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AcquisitionJob, QueueCancelRequest } from '$lib/shared/types';

const job: AcquisitionJob = {
  id: 'job-1',
  itemId: 'movie:603',
  arrItemId: 603,
  kind: 'movie',
  title: 'The Matrix',
  sourceService: 'radarr',
  status: 'validating',
  attempt: 1,
  maxRetries: 4,
  currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
  selectedReleaser: 'flux',
  preferredReleaser: 'flux',
  reasonCode: null,
  failureReason: null,
  validationSummary: null,
  autoRetrying: false,
  progress: 50,
  queueStatus: 'Downloading',
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'English',
  },
  targetSeasonNumbers: null,
  targetEpisodeIds: null,
  startedAt: '2026-04-13T12:00:00.000Z',
  updatedAt: '2026-04-13T12:00:00.000Z',
  completedAt: null,
  attempts: [],
};

const cancelledJob: AcquisitionJob = {
  ...job,
  completedAt: '2026-04-13T12:05:00.000Z',
  failureReason: 'Cancelled by user',
  queueStatus: 'Cancelled',
  reasonCode: 'cancelled',
  status: 'cancelled',
  validationSummary: 'Cancelled by user',
};

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('acquisition service', () => {
  it('cancels a job cleanly when the Arr queue row and tracked item are already missing', async () => {
    const cancelJob = vi.fn().mockReturnValue(cancelledJob);
    const arrFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('radarr 404: Queue entry missing'))
      .mockRejectedValueOnce(new Error('radarr 404: Movie missing'));

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        ensureWorkers: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        cancelJob,
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        getJob: vi.fn().mockReturnValue(job),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 7,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn().mockImplementation((_service: string, record: { movieId: number }) => record.movieId),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.cancelAcquisitionJob(job.id);

    expect(result.job.status).toBe('cancelled');
    expect(cancelJob).toHaveBeenCalledWith(job);
    expect(arrFetch).toHaveBeenCalledTimes(2);
  });

  it('cleans up stale queue deletes when the queue entry is already gone', async () => {
    const arrFetch = vi.fn().mockRejectedValue(new Error('radarr 404: Queue entry missing'));
    const queueEntry: QueueCancelRequest = {
      kind: 'external',
      arrItemId: null,
      id: 'radarr:queue:7',
      queueId: 7,
      sourceService: 'radarr',
      title: 'The Matrix',
    };
    const queueCache = new Map([
      [
        'queue',
        {
          expiresAt: Date.now() + 60_000,
          value: {
            updatedAt: '2026-04-13T12:00:00.000Z',
            entries: [],
            total: 0,
          },
        },
      ],
    ]);

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/app-cache', () => ({
      queueCache,
    }));
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        ensureWorkers: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        cancelJob: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        listActiveJobsByArrItem: vi.fn().mockReturnValue([]),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.cancelQueueEntry(queueEntry);

    expect(result.itemId).toBe('radarr:queue:7');
    expect(result.message).toBe('The Matrix download was cancelled.');
    expect(queueCache.has('queue')).toBe(false);
  });

  it('cancels only the selected external queue row without unmonitoring the tracked item', async () => {
    const arrFetch = vi.fn().mockResolvedValue({});
    const queueEntry: QueueCancelRequest = {
      kind: 'external',
      arrItemId: 603,
      id: 'radarr:queue:7',
      queueId: 7,
      sourceService: 'radarr',
      title: 'The Matrix',
    };

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/app-cache', () => ({
      queueCache: new Map(),
    }));
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        ensureWorkers: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        cancelJob: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        listActiveJobsByArrItem: vi.fn().mockReturnValue([]),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.cancelQueueEntry(queueEntry);

    expect(result).toEqual({
      itemId: 'radarr:queue:7',
      message: 'The Matrix download was cancelled.',
    });
    expect(arrFetch).toHaveBeenCalledTimes(1);
    expect(arrFetch).toHaveBeenCalledWith(
      'radarr',
      '/api/v3/queue/7',
      {
        method: 'DELETE',
      },
      {
        blocklist: false,
        removeFromClient: true,
        skipRedownload: false,
      },
    );
  });

  it('cancels managed jobs across every matching Arr queue row', async () => {
    const cancelJob = vi.fn().mockReturnValue(cancelledJob);
    const arrFetch = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        id: 603,
        monitored: true,
      })
      .mockResolvedValueOnce({});

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        ensureWorkers: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        cancelJob,
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        getJob: vi.fn().mockReturnValue(job),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 7,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
        {
          id: 8,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn().mockImplementation((_service: string, record: { movieId: number }) => record.movieId),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.cancelAcquisitionJob(job.id);

    expect(result.message).toBe('The Matrix download was cancelled and unmonitored.');
    expect(cancelJob).toHaveBeenCalledWith(job);
    expect(arrFetch).toHaveBeenCalledTimes(4);
    expect(arrFetch.mock.calls[0]?.[1]).toBe('/api/v3/queue/7');
    expect(arrFetch.mock.calls[1]?.[1]).toBe('/api/v3/queue/8');
    expect(arrFetch.mock.calls[2]?.[1]).toBe('/api/v3/movie/603');
    expect(arrFetch.mock.calls[3]?.[1]).toBe('/api/v3/movie/603');
  });

  it('falls back to deleting every live row when a managed queue job is already gone', async () => {
    const arrFetch = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        id: 603,
        monitored: true,
      })
      .mockResolvedValueOnce({});
    const queueEntry: QueueCancelRequest = {
      kind: 'managed',
      arrItemId: 603,
      currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      jobId: 'job-missing',
      sourceService: 'radarr',
      targetEpisodeIds: null,
      targetSeasonNumbers: null,
      title: 'The Matrix',
    };

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/app-cache', () => ({
      queueCache: new Map(),
    }));
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        ensureWorkers: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        cancelJob: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        getJob: vi.fn().mockReturnValue(null),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 7,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
        {
          id: 8,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn().mockImplementation((_service: string, record: { movieId: number }) => record.movieId),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.cancelQueueEntry(queueEntry);

    expect(result).toEqual({
      itemId: 'job-missing',
      message: 'The Matrix download was cancelled and unmonitored.',
    });
    expect(arrFetch).toHaveBeenCalledTimes(4);
    expect(arrFetch.mock.calls[0]?.[1]).toBe('/api/v3/queue/7');
    expect(arrFetch.mock.calls[1]?.[1]).toBe('/api/v3/queue/8');
  });

  it('cancels only queue rows whose Sonarr episode scope overlaps the managed job', async () => {
    const seriesJob: AcquisitionJob = {
      ...job,
      id: 'job-series',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Andor',
      sourceService: 'sonarr',
      currentRelease: 'Andor.S01E01.1080p.WEB-DL-FLUX',
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
    };
    const cancelledSeriesJob: AcquisitionJob = {
      ...cancelledJob,
      id: seriesJob.id,
      itemId: seriesJob.itemId,
      arrItemId: seriesJob.arrItemId,
      kind: 'series',
      title: seriesJob.title,
      sourceService: seriesJob.sourceService,
      currentRelease: seriesJob.currentRelease,
      targetSeasonNumbers: seriesJob.targetSeasonNumbers,
      targetEpisodeIds: seriesJob.targetEpisodeIds,
    };
    const cancelJob = vi.fn().mockReturnValue(cancelledSeriesJob);
    const arrFetch = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        id: 83867,
        monitored: true,
        seasons: [{ seasonNumber: 1, monitored: true }],
      })
      .mockResolvedValueOnce({});

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        ensureWorkers: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        cancelJob,
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        getJob: vi.fn().mockReturnValue(seriesJob),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          episode: {
            id: 101,
            seasonNumber: 1,
            title: 'Kassa',
          },
          id: 7,
          series: {
            id: 83867,
            title: 'Andor',
            year: 2022,
          },
          seriesId: 83867,
          title: 'Andor.S01E01.1080p.WEB-DL-FLUX',
        },
        {
          episode: {
            id: 201,
            seasonNumber: 2,
            title: 'One Year Later',
          },
          id: 8,
          series: {
            id: 83867,
            title: 'Andor',
            year: 2022,
          },
          seriesId: 83867,
          title: 'Andor.S02E01.1080p.WEB-DL-FLUX',
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.cancelAcquisitionJob(seriesJob.id);

    expect(result.message).toBe('Andor download was cancelled and unmonitored.');
    expect(cancelJob).toHaveBeenCalledWith(seriesJob);
    expect(arrFetch).toHaveBeenCalledTimes(3);
    expect(arrFetch.mock.calls[0]?.[1]).toBe('/api/v3/queue/7');
    expect(arrFetch.mock.calls[1]?.[1]).toBe('/api/v3/series/83867');
    expect(arrFetch.mock.calls[2]?.[1]).toBe('/api/v3/series/83867');
  });

  it('removes local jobs when the Arr item is already missing during delete', async () => {
    const deleteJobsByArrItem = vi.fn();
    const arrFetch = vi.fn().mockRejectedValue(new Error('radarr 404: Movie missing'));

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        ensureWorkers: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        cancelJob: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        deleteJobsByArrItem,
        listActiveJobsByArrItem: vi.fn().mockReturnValue([]),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.deleteArrItem({
      deleteMode: 'library',
      arrItemId: 603,
      id: 'movie:603',
      kind: 'movie',
      sourceService: 'radarr',
      title: 'The Matrix',
    });

    expect(deleteJobsByArrItem).toHaveBeenCalledWith(603, 'movie', 'radarr');
    expect(result.message).toContain('already missing from Radarr');
  });

  it('clears stale queue rows without deleting the tracked Arr title', async () => {
    const arrFetch = vi.fn().mockResolvedValue({});

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        ensureWorkers: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        cancelJob: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        deleteJobsByArrItem: vi.fn(),
        listActiveJobsByArrItem: vi.fn().mockReturnValue([]),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.deleteArrItem({
      deleteMode: 'queue-entry',
      id: 'radarr:queue:7',
      kind: 'movie',
      queueId: 7,
      sourceService: 'radarr',
      title: 'The Matrix',
    });

    expect(result).toEqual({
      itemId: 'radarr:queue:7',
      message: 'The Matrix stale queue entry was removed from Radarr.',
    });
    expect(arrFetch).toHaveBeenCalledTimes(1);
    expect(arrFetch).toHaveBeenCalledWith(
      'radarr',
      '/api/v3/queue/7',
      {
        method: 'DELETE',
      },
      {
        blocklist: false,
        removeFromClient: true,
        skipRedownload: false,
      },
    );
  });

  it('rejects manual selections once a job is already grabbing or validating', async () => {
    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        ensureWorkers: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-lifecycle', () => ({
      getAcquisitionLifecycle: () => ({
        cancelJob: vi.fn(),
      }),
    }));
    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        getJob: vi.fn().mockReturnValue({
          ...job,
          status: 'validating',
        }),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(module.selectManualRelease(job.id, 'guid-1', 11)).rejects.toThrow(
      'can no longer accept manual release selections',
    );
  });
});
