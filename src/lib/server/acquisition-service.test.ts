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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 7,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'downloading',
          trackedDownloadStatus: 'ok',
          trackedDownloadState: 'downloading',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.cancelQueueEntry(queueEntry);

    expect(result.itemId).toBe('radarr:queue:7');
    expect(result.message).toBe('"The Matrix" download was cancelled.');
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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 7,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'downloading',
          trackedDownloadStatus: 'ok',
          trackedDownloadState: 'downloading',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.cancelQueueEntry(queueEntry);

    expect(result).toEqual({
      itemId: 'radarr:queue:7',
      message: '"The Matrix" download was cancelled.',
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

  it('resolves external queue cancels by download id when the queue row id changed', async () => {
    const arrFetch = vi.fn().mockResolvedValue({});
    const queueEntry: QueueCancelRequest = {
      kind: 'external',
      arrItemId: 603,
      downloadId: 'radarr-download-7',
      id: 'radarr:download:radarr-download-7',
      queueId: null,
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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 11,
          downloadId: 'radarr-download-7',
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'downloading',
          trackedDownloadStatus: 'ok',
          trackedDownloadState: 'downloading',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.cancelQueueEntry(queueEntry);

    expect(result).toEqual({
      itemId: 'radarr:download:radarr-download-7',
      message: '"The Matrix" download was cancelled.',
    });
    expect(arrFetch).toHaveBeenCalledWith(
      'radarr',
      '/api/v3/queue/11',
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

  it('refuses external queue cancels when the resolved Arr row still lacks a queue id', async () => {
    const arrFetch = vi.fn();
    const queueEntry: QueueCancelRequest = {
      kind: 'external',
      arrItemId: 603,
      downloadId: 'radarr-download-7',
      id: 'radarr:download:radarr-download-7',
      queueId: null,
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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          downloadId: 'radarr-download-7',
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'downloading',
          trackedDownloadStatus: 'ok',
          trackedDownloadState: 'downloading',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(module.cancelQueueEntry(queueEntry)).rejects.toThrow(
      'This live Arr queue row cannot be cancelled because Arr did not expose a queue id. Refresh the queue and stop it directly in Arr if it is still running.',
    );
    expect(arrFetch).not.toHaveBeenCalled();
  });

  it('resolves external queue cancels by exact entry id before falling back to a shared download id', async () => {
    const arrFetch = vi.fn();
    const queueEntry: QueueCancelRequest = {
      kind: 'external',
      arrItemId: 83867,
      downloadId: 'download-shared',
      id: 'sonarr:download:download-shared:sonarr-83867-andor-s01e02-1080p-web-dl-flux-episodes-102',
      queueId: null,
      sourceService: 'sonarr',
      title: 'Andor',
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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          downloadId: 'download-shared',
          seriesId: 83867,
          title: 'Andor.S01E01.1080p.WEB-DL-FLUX',
          status: 'downloading',
          trackedDownloadStatus: 'ok',
          trackedDownloadState: 'downloading',
          series: {
            id: 83867,
            title: 'Andor',
            year: 2022,
          },
          episodeIds: [101],
        },
        {
          downloadId: 'download-shared',
          seriesId: 83867,
          title: 'Andor.S01E02.1080p.WEB-DL-FLUX',
          status: 'completed',
          trackedDownloadStatus: 'warning',
          trackedDownloadState: 'importPending',
          statusMessages: [
            {
              title: 'Import pending',
              messages: ['Import failed, destination path already exists.'],
            },
          ],
          series: {
            id: 83867,
            title: 'Andor',
            year: 2022,
          },
          episodeIds: [102],
        },
      ]),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(module.cancelQueueEntry(queueEntry)).rejects.toThrow(
      'This queue entry is no longer actively downloading. Clear the stale queue entry instead.',
    );
    expect(arrFetch).not.toHaveBeenCalled();
  });

  it('refuses to cancel external queue rows that are now stale import-blocked leftovers', async () => {
    const arrFetch = vi.fn();
    const queueEntry: QueueCancelRequest = {
      kind: 'external',
      arrItemId: 727,
      id: 'radarr:queue:1996958567',
      queueId: 1996958567,
      sourceService: 'radarr',
      title: 'Dangerous Animals',
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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 1996958567,
          movieId: 727,
          title: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
          status: 'completed',
          trackedDownloadStatus: 'warning',
          trackedDownloadState: 'importPending',
          statusMessages: [
            {
              title: 'Import pending',
              messages: ['Not an upgrade for existing movie file. Existing quality: Bluray-2160p.'],
            },
          ],
          movie: {
            id: 727,
            title: 'Dangerous Animals',
            year: 2025,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(module.cancelQueueEntry(queueEntry)).rejects.toThrow(
      'This queue entry is no longer actively downloading. Clear the stale queue entry instead.',
    );
    expect(arrFetch).not.toHaveBeenCalled();
  });

  it('refuses to cancel external queue rows when Arr reports a recognized terminal import warning', async () => {
    const arrFetch = vi.fn();
    const queueEntry: QueueCancelRequest = {
      kind: 'external',
      arrItemId: 603,
      id: 'radarr:queue:9',
      queueId: 9,
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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 9,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'completed',
          trackedDownloadStatus: 'warning',
          trackedDownloadState: 'importPending',
          statusMessages: [
            {
              title: 'Import pending',
              messages: ['Import failed, destination path already exists.'],
            },
          ],
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(module.cancelQueueEntry(queueEntry)).rejects.toThrow(
      'This queue entry is no longer actively downloading. Clear the stale queue entry instead.',
    );
    expect(arrFetch).not.toHaveBeenCalled();
  });

  it('still allows canceling external queue rows for generic import-pending warnings', async () => {
    const arrFetch = vi.fn().mockResolvedValue({});
    const queueEntry: QueueCancelRequest = {
      kind: 'external',
      arrItemId: 603,
      id: 'radarr:queue:10',
      queueId: 10,
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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 10,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'completed',
          trackedDownloadStatus: 'warning',
          trackedDownloadState: 'importPending',
          statusMessages: [
            {
              title: 'Import pending',
              messages: ['Import failed, temporary permission issue.'],
            },
          ],
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.cancelQueueEntry(queueEntry);

    expect(result).toEqual({
      itemId: 'radarr:queue:10',
      message: '"The Matrix" download was cancelled.',
    });
    expect(arrFetch).toHaveBeenCalledWith('radarr', '/api/v3/queue/10', {
      method: 'DELETE',
    }, {
      blocklist: false,
      removeFromClient: true,
      skipRedownload: false,
    });
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

    expect(result.message).toBe('"The Matrix" download was cancelled and unmonitored.');
    expect(cancelJob).toHaveBeenCalledWith(job);
    expect(arrFetch).toHaveBeenCalledTimes(4);
    expect(arrFetch.mock.calls[0]?.[1]).toBe('/api/v3/queue/7');
    expect(arrFetch.mock.calls[1]?.[1]).toBe('/api/v3/queue/8');
    expect(arrFetch.mock.calls[2]?.[1]).toBe('/api/v3/movie/603');
    expect(arrFetch.mock.calls[3]?.[1]).toBe('/api/v3/movie/603');
  });

  it('cancels only the claimed live movie queue row when queue identity is persisted', async () => {
    const identityTrackedJob: AcquisitionJob = {
      ...job,
      liveQueueId: 8,
      liveDownloadId: 'radarr-download-8',
    };
    const cancelJob = vi.fn().mockReturnValue({
      ...cancelledJob,
      liveQueueId: null,
      liveDownloadId: null,
    });
    const arrFetch = vi
      .fn()
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
        getJob: vi.fn().mockReturnValue(identityTrackedJob),
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
          downloadId: 'radarr-download-7',
          movieId: 603,
          title: 'The.Matrix.1999.1080p.BluRay-OLD',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
        {
          id: 8,
          downloadId: 'radarr-download-8',
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
    const result = await module.cancelAcquisitionJob(identityTrackedJob.id);

    expect(result.message).toBe('"The Matrix" download was cancelled and unmonitored.');
    expect(cancelJob).toHaveBeenCalledWith(identityTrackedJob);
    expect(arrFetch).toHaveBeenCalledTimes(3);
    expect(arrFetch.mock.calls[0]?.[1]).toBe('/api/v3/queue/8');
    expect(arrFetch.mock.calls[1]?.[1]).toBe('/api/v3/movie/603');
    expect(arrFetch.mock.calls[2]?.[1]).toBe('/api/v3/movie/603');
  });

  it('refuses managed queue cancels when the claimed live row only exposes a download id', async () => {
    const identityTrackedJob: AcquisitionJob = {
      ...job,
      liveQueueId: null,
      liveDownloadId: 'radarr-download-8',
    };
    const cancelJob = vi.fn();
    const arrFetch = vi.fn();

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
        getJob: vi.fn().mockReturnValue(identityTrackedJob),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          downloadId: 'radarr-download-8',
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
      queueRecordId: vi.fn().mockReturnValue(null),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(module.cancelAcquisitionJob(identityTrackedJob.id)).rejects.toThrow(
      'This live Arr queue row cannot be cancelled because Arr did not expose a queue id. Refresh the queue and stop it directly in Arr if it is still running.',
    );
    expect(cancelJob).not.toHaveBeenCalled();
    expect(arrFetch).not.toHaveBeenCalled();
  });

  it('rejects stale managed queue cancels when the job is already gone', async () => {
    const arrFetch = vi.fn();
    const queueEntry: QueueCancelRequest = {
      kind: 'managed',
      jobId: 'job-missing',
    };

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
    await expect(module.cancelQueueEntry(queueEntry)).rejects.toThrow(
      'This queue entry is no longer current. Refresh the queue and try again.',
    );
    expect(arrFetch).not.toHaveBeenCalled();
  });

  it('rejects managed queue cancels once the job is already terminal', async () => {
    const arrFetch = vi.fn();
    const queueEntry: QueueCancelRequest = {
      kind: 'managed',
      jobId: 'job-failed',
    };

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
        getJob: vi.fn().mockReturnValue({
          ...job,
          completedAt: '2026-04-13T12:05:00.000Z',
          reasonCode: 'import-blocked',
          status: 'failed',
        }),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn(),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(module.cancelQueueEntry(queueEntry)).rejects.toThrow(
      'This queue entry is no longer current. Refresh the queue and try again.',
    );
    expect(arrFetch).not.toHaveBeenCalled();
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

    expect(result.message).toBe('"Andor" download was cancelled and unmonitored.');
    expect(cancelJob).toHaveBeenCalledWith(seriesJob);
    expect(arrFetch).toHaveBeenCalledTimes(3);
    expect(arrFetch.mock.calls[0]?.[1]).toBe('/api/v3/queue/7');
    expect(arrFetch.mock.calls[1]?.[1]).toBe('/api/v3/series/83867');
    expect(arrFetch.mock.calls[2]?.[1]).toBe('/api/v3/series/83867');
  });

  it('cancels season-pack queue rows for a scoped Sonarr job when the live row exposes only season numbers', async () => {
    const seriesJob: AcquisitionJob = {
      ...job,
      id: 'job-series-season-pack',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Andor',
      sourceService: 'sonarr',
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
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
          id: 9,
          series: {
            id: 83867,
            title: 'Andor',
            year: 2022,
          },
          seriesId: 83867,
          title: 'Andor.S01.1080p.WEB-DL-FLUX',
        },
        {
          id: 10,
          series: {
            id: 83867,
            title: 'Andor',
            year: 2022,
          },
          seriesId: 83867,
          title: 'Andor.S02.1080p.WEB-DL-FLUX',
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

    expect(result.message).toBe('"Andor" download was cancelled and unmonitored.');
    expect(cancelJob).toHaveBeenCalledWith(seriesJob);
    expect(arrFetch).toHaveBeenCalledTimes(3);
    expect(arrFetch.mock.calls[0]?.[1]).toBe('/api/v3/queue/9');
    expect(arrFetch.mock.calls[1]?.[1]).toBe('/api/v3/series/83867');
    expect(arrFetch.mock.calls[2]?.[1]).toBe('/api/v3/series/83867');
  });

  it('does not cancel broader season-pack queue rows that exceed the managed season scope', async () => {
    const seriesJob: AcquisitionJob = {
      ...job,
      id: 'job-series-broader-pack',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Andor',
      sourceService: 'sonarr',
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
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
          id: 10,
          series: {
            id: 83867,
            title: 'Andor',
            year: 2022,
          },
          seriesId: 83867,
          seasonNumbers: [1, 2],
          title: 'Andor.S01-S02.1080p.WEB-DL-FLUX',
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

    expect(result.message).toBe(
      '"Andor" grab was cancelled and unmonitored, but no matching Arr queue rows were found. Refresh the queue if a live download is still running.',
    );
    expect(cancelJob).toHaveBeenCalledWith(seriesJob);
    expect(arrFetch).toHaveBeenCalledTimes(2);
    expect(arrFetch.mock.calls[0]?.[1]).toBe('/api/v3/series/83867');
    expect(arrFetch.mock.calls[1]?.[1]).toBe('/api/v3/series/83867');
  });

  it('reports when a queued managed grab is cancelled before Arr creates a live queue row', async () => {
    const queuedSeriesJob: AcquisitionJob = {
      ...job,
      id: 'job-series-pre-live',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Andor',
      sourceService: 'sonarr',
      status: 'queued',
      queueStatus: 'Queued',
      currentRelease: null,
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
    };
    const cancelledSeriesJob: AcquisitionJob = {
      ...cancelledJob,
      id: queuedSeriesJob.id,
      itemId: queuedSeriesJob.itemId,
      arrItemId: queuedSeriesJob.arrItemId,
      kind: queuedSeriesJob.kind,
      title: queuedSeriesJob.title,
      sourceService: queuedSeriesJob.sourceService,
      currentRelease: queuedSeriesJob.currentRelease,
      targetSeasonNumbers: queuedSeriesJob.targetSeasonNumbers,
      targetEpisodeIds: queuedSeriesJob.targetEpisodeIds,
    };
    const cancelJob = vi.fn().mockReturnValue(cancelledSeriesJob);
    const arrFetch = vi
      .fn()
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
        getJob: vi.fn().mockReturnValue(queuedSeriesJob),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.cancelAcquisitionJob(queuedSeriesJob.id);

    expect(result.message).toBe(
      '"Andor" grab was cancelled and unmonitored before Arr created a live queue entry.',
    );
    expect(cancelJob).toHaveBeenCalledWith(queuedSeriesJob);
    expect(arrFetch).toHaveBeenCalledTimes(2);
  });

  it('warns when a managed grab is cancelled but no matching live Arr queue rows are found', async () => {
    const activeSeriesJob: AcquisitionJob = {
      ...job,
      id: 'job-series-ambiguous-live-row',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Andor',
      sourceService: 'sonarr',
      status: 'grabbing',
      queueStatus: 'Downloading',
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
    };
    const cancelledSeriesJob: AcquisitionJob = {
      ...cancelledJob,
      id: activeSeriesJob.id,
      itemId: activeSeriesJob.itemId,
      arrItemId: activeSeriesJob.arrItemId,
      kind: activeSeriesJob.kind,
      title: activeSeriesJob.title,
      sourceService: activeSeriesJob.sourceService,
      currentRelease: activeSeriesJob.currentRelease,
      targetSeasonNumbers: activeSeriesJob.targetSeasonNumbers,
      targetEpisodeIds: activeSeriesJob.targetEpisodeIds,
    };
    const cancelJob = vi.fn().mockReturnValue(cancelledSeriesJob);
    const arrFetch = vi
      .fn()
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
        getJob: vi.fn().mockReturnValue(activeSeriesJob),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 11,
          series: {
            id: 83867,
            title: 'Andor',
            year: 2022,
          },
          seriesId: 83867,
          title: 'Andor.Release.Alpha.2026-REPACK',
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
    const result = await module.cancelAcquisitionJob(activeSeriesJob.id);

    expect(result.message).toBe(
      '"Andor" grab was cancelled and unmonitored, but no matching Arr queue rows were found. Refresh the queue if a live download is still running.',
    );
    expect(cancelJob).toHaveBeenCalledWith(activeSeriesJob);
    expect(arrFetch).toHaveBeenCalledTimes(2);
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

  it('rejects library deletes when the matching live Arr row has no queue id', async () => {
    const arrFetch = vi.fn();
    const cancelJob = vi.fn();
    const deleteJobsByArrItem = vi.fn();

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
        deleteJobsByArrItem,
        listActiveJobsByArrItem: vi.fn().mockReturnValue([]),
      }),
    }));
    vi.doMock('$lib/server/acquisition-query', () => ({
      getAcquisitionJobsResponse: vi.fn(),
      listQueueAcquisitionJobs: vi.fn(),
    }));
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          downloadId: 'radarr-download-7',
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'completed',
          trackedDownloadStatus: 'warning',
          trackedDownloadState: 'importPending',
          statusMessages: [
            {
              title: 'Import pending',
              messages: ['Import failed, destination path already exists.'],
            },
          ],
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(
      module.deleteArrItem({
        deleteMode: 'library',
        arrItemId: 603,
        id: 'movie:603',
        kind: 'movie',
        sourceService: 'radarr',
        title: 'The Matrix',
      }),
    ).rejects.toThrow(
      'This live Arr queue row cannot be cleared because Arr did not expose a queue id. Refresh the queue and stop it directly in Arr if it is still running.',
    );

    expect(arrFetch).not.toHaveBeenCalled();
    expect(cancelJob).not.toHaveBeenCalled();
    expect(deleteJobsByArrItem).not.toHaveBeenCalled();
  });

  it('does not mutate local acquisition jobs when the tracked Arr delete fails after queue cleanup', async () => {
    const arrFetch = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('500 Internal Server Error'));
    const cancelJob = vi.fn();
    const deleteJobsByArrItem = vi.fn();

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
        deleteJobsByArrItem,
        listActiveJobsByArrItem: vi.fn().mockReturnValue([
          {
            ...job,
            status: 'validating',
          },
        ]),
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
          status: 'downloading',
          trackedDownloadStatus: 'ok',
          trackedDownloadState: 'downloading',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(
      module.deleteArrItem({
        deleteMode: 'library',
        arrItemId: 603,
        id: 'movie:603',
        kind: 'movie',
        sourceService: 'radarr',
        title: 'The Matrix',
      }),
    ).rejects.toThrow('500 Internal Server Error');

    expect(arrFetch).toHaveBeenCalledTimes(2);
    expect(arrFetch.mock.calls[0]?.[1]).toBe('/api/v3/queue/7');
    expect(arrFetch.mock.calls[1]?.[1]).toBe('/api/v3/movie/603');
    expect(cancelJob).not.toHaveBeenCalled();
    expect(deleteJobsByArrItem).not.toHaveBeenCalled();
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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 7,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'completed',
          trackedDownloadStatus: 'warning',
          trackedDownloadState: 'importPending',
          statusMessages: [
            {
              title: 'Import pending',
              messages: ['Not an upgrade for existing movie file. Existing quality: Bluray-2160p.'],
            },
          ],
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
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
      message: '"The Matrix" stale queue entry was removed from Radarr.',
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

  it('rejects queue-entry deletes while the external download is still active', async () => {
    const arrFetch = vi.fn();

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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 7,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'downloading',
          trackedDownloadStatus: 'ok',
          trackedDownloadState: 'downloading',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(
      module.deleteArrItem({
        deleteMode: 'queue-entry',
        id: 'radarr:queue:7',
        kind: 'movie',
        queueId: 7,
        sourceService: 'radarr',
        title: 'The Matrix',
      }),
    ).rejects.toThrow('This queue entry is still active. Cancel the download instead.');
    expect(arrFetch).not.toHaveBeenCalled();
  });

  it('clears recognized terminal import-warning rows through the stale queue-entry delete path', async () => {
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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 9,
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'completed',
          trackedDownloadStatus: 'warning',
          trackedDownloadState: 'importPending',
          statusMessages: [
            {
              title: 'Import pending',
              messages: ['Import failed, destination path already exists.'],
            },
          ],
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.deleteArrItem({
      deleteMode: 'queue-entry',
      id: 'radarr:queue:9',
      kind: 'movie',
      queueId: 9,
      sourceService: 'radarr',
      title: 'The Matrix',
    });

    expect(result).toEqual({
      itemId: 'radarr:queue:9',
      message: '"The Matrix" stale queue entry was removed from Radarr.',
    });
    expect(arrFetch).toHaveBeenCalledTimes(1);
    expect(arrFetch).toHaveBeenCalledWith(
      'radarr',
      '/api/v3/queue/9',
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

  it('resolves stale queue-entry deletes by download id when the queue row id changed', async () => {
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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 12,
          downloadId: 'radarr-download-12',
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'completed',
          trackedDownloadStatus: 'warning',
          trackedDownloadState: 'importPending',
          statusMessages: [
            {
              title: 'Import pending',
              messages: ['Import failed, destination path already exists.'],
            },
          ],
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
      queueRecordArrItemId: vi.fn(),
      queueRecordId: vi.fn().mockImplementation((record: { id: number }) => record.id),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');
    const result = await module.deleteArrItem({
      deleteMode: 'queue-entry',
      downloadId: 'radarr-download-12',
      id: 'radarr:download:radarr-download-12',
      kind: 'movie',
      queueId: null,
      sourceService: 'radarr',
      title: 'The Matrix',
    });

    expect(result).toEqual({
      itemId: 'radarr:download:radarr-download-12',
      message: '"The Matrix" stale queue entry was removed from Radarr.',
    });
    expect(arrFetch).toHaveBeenCalledWith(
      'radarr',
      '/api/v3/queue/12',
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

  it('resolves stale queue-entry deletes by exact entry id before falling back to a shared download id', async () => {
    const arrFetch = vi.fn();

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
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          downloadId: 'download-shared',
          movieId: 603,
          title: 'The.Matrix.1999.1080p.BluRay-OLD',
          status: 'downloading',
          trackedDownloadStatus: 'ok',
          trackedDownloadState: 'downloading',
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
        {
          downloadId: 'download-shared',
          movieId: 603,
          title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
          status: 'completed',
          trackedDownloadStatus: 'warning',
          trackedDownloadState: 'importPending',
          statusMessages: [
            {
              title: 'Import pending',
              messages: ['Import failed, destination path already exists.'],
            },
          ],
          movie: {
            id: 603,
            title: 'The Matrix',
            year: 1999,
          },
        },
      ]),
    }));
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection: vi.fn(),
      getManualReleaseResults: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(
      module.deleteArrItem({
        deleteMode: 'queue-entry',
        downloadId: 'download-shared',
        id: 'radarr:download:download-shared:radarr-603-the-matrix-1999-1080p-web-dl-flux-noscope',
        kind: 'movie',
        queueId: null,
        sourceService: 'radarr',
        title: 'The Matrix',
      }),
    ).rejects.toThrow(
      'This live Arr queue row cannot be cleared because Arr did not expose a queue id. Refresh the queue and stop it directly in Arr if it is still running.',
    );
    expect(arrFetch).not.toHaveBeenCalled();
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

    await expect(module.selectManualRelease(job.id, 'guid-1', 11, 'direct')).rejects.toThrow(
      'can no longer accept manual release selections',
    );
  });

  it('allows replacing a queued manual release before submission starts', async () => {
    const enqueue = vi.fn();
    const updatedJob = {
      ...job,
      queueStatus: 'Manual selection queued',
      queuedManualSelection: {
        decision: {
          accepted: 1,
          considered: 1,
          reason: 'User selected The.Matrix.1999.1080p.WEB-DL-ALT',
          selected: {
            guid: 'guid-2',
            indexer: 'Indexer',
            indexerId: 12,
            languages: ['English'],
            protocol: 'torrent',
            reason: 'User selected The.Matrix.1999.1080p.WEB-DL-ALT',
            score: 520,
            size: 1_200,
            title: 'The.Matrix.1999.1080p.WEB-DL-ALT',
          },
        },
        payload: {
          guid: 'guid-2',
          indexerId: 12,
        },
        selectionMode: 'direct' as const,
        selectedResult: {
          canSelect: false,
          selectionMode: null,
          blockReason: 'already-selected',
          guid: 'guid-2',
          identityStatus: 'exact-match',
          indexer: 'Indexer',
          indexerId: 12,
          languages: ['English'],
          protocol: 'torrent',
          reason: 'User selected The.Matrix.1999.1080p.WEB-DL-ALT',
          scopeStatus: 'not-applicable',
          explanation: {
            summary: 'User selected The.Matrix.1999.1080p.WEB-DL-ALT',
            matchReasons: ['Release title matched The Matrix'],
            warningReasons: [],
            arrReasons: [],
          },
          score: 520,
          size: 1_200,
          status: 'selected',
          title: 'The.Matrix.1999.1080p.WEB-DL-ALT',
        },
      },
      status: 'queued',
      validationSummary: 'User selected The.Matrix.1999.1080p.WEB-DL-ALT',
    };
    const updateJobIfStatus = vi.fn().mockReturnValue({
      updated: true,
      job: updatedJob,
    });
    const persistedSelection = updatedJob.queuedManualSelection;
    const manualSelection = {
      manualResults: [persistedSelection.selectedResult],
      mappedReleases: 1,
      releasesFound: 1,
      selectedGuid: 'guid-2',
      selectedRelease: persistedSelection.decision.selected,
      manualSelectionMode: 'direct' as const,
      selection: {
        decision: persistedSelection.decision,
        payload: persistedSelection.payload,
      },
    };

    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        enqueue,
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
          queueStatus: 'Manual selection queued',
          queuedManualSelection: {
            decision: {
              accepted: 1,
              considered: 1,
              reason: 'User selected The.Matrix.1999.1080p.WEB-DL-FLUX',
              selected: {
                guid: 'guid-selected',
                indexer: 'Indexer',
                indexerId: 11,
                languages: ['English'],
                protocol: 'torrent',
                reason: 'User selected The.Matrix.1999.1080p.WEB-DL-FLUX',
                score: 500,
                size: 1_000,
                title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
              },
            },
            payload: {
              guid: 'guid-selected',
              indexerId: 11,
            },
            selectionMode: 'direct' as const,
            selectedResult: {
              canSelect: false,
              selectionMode: null,
              blockReason: 'already-selected',
              guid: 'guid-selected',
              identityStatus: 'exact-match',
              indexer: 'Indexer',
              indexerId: 11,
              languages: ['English'],
              protocol: 'torrent',
              reason: 'User selected The.Matrix.1999.1080p.WEB-DL-FLUX',
              scopeStatus: 'not-applicable',
              explanation: {
                summary: 'User selected The.Matrix.1999.1080p.WEB-DL-FLUX',
                matchReasons: ['Release title matched The Matrix'],
                warningReasons: [],
                arrReasons: [],
              },
              score: 500,
              size: 1_000,
              status: 'selected',
              title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
            },
          },
          status: 'queued',
        }),
        updateJobIfStatus,
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
    const findManualReleaseSelection = vi.fn().mockResolvedValue(manualSelection);
    const persistManualSelection = vi.fn().mockReturnValue(persistedSelection);
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection,
      getManualReleaseResults: vi.fn(),
      persistManualSelection,
      queuedManualReleaseResults: vi.fn().mockReturnValue(null),
    }));

    const module = await import('$lib/server/acquisition-service');

    const result = await module.selectManualRelease(job.id, 'guid-2', 12, 'direct');

    expect(findManualReleaseSelection).toHaveBeenCalledWith(
      expect.objectContaining({ id: job.id }),
      'guid-2',
      12,
      'direct',
    );
    expect(persistManualSelection).toHaveBeenCalledWith(manualSelection);
    expect(updateJobIfStatus).toHaveBeenCalledWith(
      job.id,
      ['failed', 'queued', 'retrying', 'searching'],
      expect.objectContaining({
        queueStatus: 'Manual selection queued',
        status: 'queued',
        validationSummary: 'User selected The.Matrix.1999.1080p.WEB-DL-ALT',
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(job.id);
    expect(result.message).toBe('Updated manual release The.Matrix.1999.1080p.WEB-DL-ALT.');
  });

  it('passes Arr-rejection overrides through manual selection', async () => {
    const enqueue = vi.fn();
    const updatedJob = {
      ...job,
      queueStatus: 'Manual selection queued',
      queuedManualSelection: null,
      status: 'queued',
      validationSummary: 'User overrode Arr rejection and selected The.Matrix.1999.2160p.WEB-DL-BLOCKED',
    };
    const updateJobIfStatus = vi.fn().mockReturnValue({
      updated: true,
      job: updatedJob,
    });
    const manualSelection = {
      manualResults: [
        {
          canSelect: false,
          selectionMode: null,
          blockReason: 'already-selected',
          guid: 'guid-override',
          identityStatus: 'exact-match',
          indexer: 'Indexer',
          indexerId: 13,
          languages: ['English'],
          protocol: 'torrent',
          reason: 'Would normally score highest, but Arr rejected it.',
          scopeStatus: 'not-applicable',
          explanation: {
            summary: 'Would normally score highest, but Arr rejected it.',
            matchReasons: ['Release title matched The Matrix'],
            warningReasons: [],
            arrReasons: ['Rejected by Arr custom format rules'],
          },
          score: 610,
          size: 1_500,
          status: 'selected' as const,
          title: 'The.Matrix.1999.2160p.WEB-DL-BLOCKED',
        },
      ],
      mappedReleases: 1,
      manualSelectionMode: 'override-arr-rejection' as const,
      releasesFound: 1,
      selectedGuid: 'guid-override',
      selectedRelease: {
        guid: 'guid-override',
        indexer: 'Indexer',
        indexerId: 13,
        languages: ['English'],
        protocol: 'torrent',
        reason: 'Would normally score highest, but Arr rejected it.',
        score: 610,
        size: 1_500,
        title: 'The.Matrix.1999.2160p.WEB-DL-BLOCKED',
      },
      selection: {
        decision: {
          accepted: 0,
          considered: 1,
          reason: 'User overrode Arr rejection and selected The.Matrix.1999.2160p.WEB-DL-BLOCKED',
          selected: {
            guid: 'guid-override',
            indexer: 'Indexer',
            indexerId: 13,
            languages: ['English'],
            protocol: 'torrent',
            reason: 'Would normally score highest, but Arr rejected it.',
            score: 610,
            size: 1_500,
            title: 'The.Matrix.1999.2160p.WEB-DL-BLOCKED',
          },
        },
        payload: {
          guid: 'guid-override',
          indexerId: 13,
        },
      },
    };

    vi.doMock('$lib/server/acquisition-runner', () => ({
      getAcquisitionRunner: () => ({
        enqueue,
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
          status: 'failed',
        }),
        updateJobIfStatus,
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
    const findManualReleaseSelection = vi.fn().mockResolvedValue(manualSelection);
    const persistManualSelection = vi.fn().mockReturnValue({
      decision: manualSelection.selection.decision,
      payload: manualSelection.selection.payload,
      selectionMode: manualSelection.manualSelectionMode,
      selectedResult: manualSelection.manualResults[0],
    });
    vi.doMock('$lib/server/acquisition-selection', () => ({
      findManualReleaseSelection,
      getManualReleaseResults: vi.fn(),
      persistManualSelection,
      queuedManualReleaseResults: vi.fn().mockReturnValue(null),
    }));

    const module = await import('$lib/server/acquisition-service');

    await module.selectManualRelease(job.id, 'guid-override', 13, 'override-arr-rejection');

    expect(findManualReleaseSelection).toHaveBeenCalledWith(
      expect.objectContaining({ id: job.id }),
      'guid-override',
      13,
      'override-arr-rejection',
    );
    expect(updateJobIfStatus).toHaveBeenCalledWith(
      job.id,
      ['failed', 'queued', 'retrying', 'searching'],
      expect.objectContaining({
        attempt: 2,
        validationSummary:
          'User overrode Arr rejection and selected The.Matrix.1999.2160p.WEB-DL-BLOCKED',
      }),
    );
  });

  it('rejects loading manual release results once a job is completed', async () => {
    const getManualReleaseResults = vi.fn();

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
          completedAt: '2026-04-13T12:10:00.000Z',
          reasonCode: 'validated',
          status: 'completed',
          validationSummary: 'Ready to watch.',
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
      getManualReleaseResults,
      persistManualSelection: vi.fn(),
      queuedManualReleaseResults: vi.fn().mockReturnValue(null),
    }));

    const module = await import('$lib/server/acquisition-service');

    await expect(module.getManualReleaseResults(job.id)).rejects.toThrow(
      'can no longer accept manual release selections',
    );
    expect(getManualReleaseResults).not.toHaveBeenCalled();
  });
});
