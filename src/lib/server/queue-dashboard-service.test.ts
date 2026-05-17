import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AcquisitionJob, MediaItem, QueueItem } from '$lib/shared/types';

const acquisitionRepositoryState = vi.hoisted(() => ({
  jobs: [] as AcquisitionJob[],
}));

const acquisitionRunnerState = vi.hoisted(() => ({
  enqueuedJobIds: [] as string[],
}));

const acquisitionSelectionState = vi.hoisted(() => ({
  findReleaseSelection: vi.fn(),
}));

vi.mock('$lib/server/acquisition-job-repository', () => ({
  getAcquisitionJobRepository: () => ({
    getJob: (jobId: string) =>
      acquisitionRepositoryState.jobs.find((job) => job.id === jobId) ?? null,
    listJobs: () => acquisitionRepositoryState.jobs,
    updateJob: (jobId: string, patch: Partial<AcquisitionJob>) => {
      const index = acquisitionRepositoryState.jobs.findIndex((job) => job.id === jobId);
      if (index === -1) {
        throw new Error(`Missing acquisition job ${jobId}`);
      }

      const current = acquisitionRepositoryState.jobs[index];
      const next = { ...current, ...patch };
      acquisitionRepositoryState.jobs[index] = next;
      return next;
    },
    updateJobIfStatus: (
      jobId: string,
      allowedStatuses: AcquisitionJob['status'][],
      patch: Partial<AcquisitionJob>,
    ) => {
      const index = acquisitionRepositoryState.jobs.findIndex((job) => job.id === jobId);
      if (index === -1) {
        return { job: null, updated: false };
      }

      const current = acquisitionRepositoryState.jobs[index];
      if (!allowedStatuses.includes(current.status)) {
        return { job: current, updated: false };
      }

      const next = { ...current, ...patch };
      acquisitionRepositoryState.jobs[index] = next;
      return { job: next, updated: true };
    },
  }),
}));

vi.mock('$lib/server/acquisition-runner', () => ({
  getAcquisitionRunner: () => ({
    enqueue: (jobId: string) => {
      acquisitionRunnerState.enqueuedJobIds.push(jobId);
    },
  }),
}));

vi.mock('$lib/server/acquisition-selection', () => ({
  findReleaseSelection: acquisitionSelectionState.findReleaseSelection,
}));

afterEach(() => {
  acquisitionRepositoryState.jobs = [];
  acquisitionRunnerState.enqueuedJobIds = [];
  acquisitionSelectionState.findReleaseSelection.mockReset();
  vi.resetAllMocks();
  vi.resetModules();
  vi.useRealTimers();
});

function missingMovieJob(overrides: Partial<AcquisitionJob> = {}): AcquisitionJob {
  return {
    id: 'job-lunopolis',
    itemId: 'movie:959',
    arrItemId: 959,
    kind: 'movie',
    title: 'Lunopolis',
    sourceService: 'radarr',
    status: 'failed',
    attempt: 1,
    maxRetries: 4,
    currentRelease: null,
    selectedReleaser: null,
    preferredReleaser: null,
    reasonCode: 'no-release-available',
    failureReason: 'No manual-search releases were returned by Arr',
    validationSummary: 'No manual-search releases were returned by Arr',
    autoRetrying: false,
    progress: null,
    queueStatus: 'Search failed',
    preferences: {
      preferredLanguage: 'English',
      subtitleLanguage: 'English',
    },
    targetSeasonNumbers: null,
    targetEpisodeIds: null,
    startedAt: '2026-05-16T12:00:00.000Z',
    updatedAt: '2026-05-16T12:10:00.000Z',
    completedAt: '2026-05-16T12:10:00.000Z',
    attempts: [],
    ...overrides,
  };
}

function movieItem(arrItemId: number, title: string): MediaItem {
  return {
    id: `movie:${arrItemId}`,
    arrItemId,
    kind: 'movie',
    title,
    year: 2010,
    rating: null,
    poster: null,
    overview: '',
    status: 'Monitored',
    isExisting: true,
    isRequested: true,
    auditStatus: 'unknown',
    audioLanguages: [],
    subtitleLanguages: [],
    sourceService: 'radarr',
    origin: 'arr',
    inArr: true,
    inPlex: false,
    plexLibraries: [],
    canAdd: false,
    canDeleteFromArr: true,
    detail: null,
    acquiredAt: null,
    requestPayload: {
      title,
    },
  };
}

function mockDashboardDependencies(
  options: { commands?: unknown[]; movieStatus?: string; title?: string } = {},
) {
  acquisitionSelectionState.findReleaseSelection.mockResolvedValue({
    selectedGuid: null,
    selectedRelease: null,
    selection: {
      payload: null,
    },
  });

  const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
    if (path === '/api/v3/command') {
      return options.commands ?? [];
    }

    if (path.startsWith('/api/v3/movie/')) {
      const movieId = Number(path.split('/').at(-1));
      return {
        id: movieId,
        title: options.title ?? 'Lunopolis',
        status: options.movieStatus ?? 'released',
      };
    }

    return { records: [] };
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
    fetchExistingMovie: vi.fn().mockImplementation((arrItemId: number) =>
      Promise.resolve({
        ...movieItem(
          arrItemId,
          options.title ??
            acquisitionRepositoryState.jobs.find((job) => job.arrItemId === arrItemId)?.title ??
            'Lunopolis',
        ),
        requestPayload: {
          title:
            options.title ??
            acquisitionRepositoryState.jobs.find((job) => job.arrItemId === arrItemId)?.title ??
            'Lunopolis',
          status: options.movieStatus ?? 'released',
        },
      }),
    ),
    fetchExistingSeries: vi.fn(),
  }));
  vi.doMock('$lib/server/acquisition-service', () => ({
    ensureAcquisitionWorkers: vi.fn(),
    getQueueAcquisitionJobs: () => [],
  }));

  return arrFetch;
}

describe('queue dashboard service', () => {
  it('merges matching acquisition jobs and Arr queue items into one managed entry', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-1',
      itemId: 'movie:603',
      arrItemId: 603,
      kind: 'movie',
      title: 'Fixture Movie',
      sourceService: 'radarr',
      status: 'validating',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      selectedReleaser: 'flux',
      preferredReleaser: 'flux',
      reasonCode: null,
      failureReason: null,
      validationSummary: null,
      autoRetrying: false,
      progress: 20,
      queueStatus: 'Queued',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: null,
      targetEpisodeIds: null,
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:05:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const queueItem: QueueItem = {
      id: 'radarr:queue:1',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'Fixture Movie',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 75,
      timeLeft: '10m',
      estimatedCompletionTime: '2026-04-13T12:10:00.000Z',
      size: 1_000_000_000,
      sizeLeft: 250_000_000,
      queueId: 1,
      detail: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };

    const entries = composeQueueEntries([acquisitionJob], [queueItem]);

    expect(entries).toEqual([
      {
        kind: 'managed',
        id: acquisitionJob.id,
        job: acquisitionJob,
        liveQueueItems: [queueItem],
        liveSummary: {
          rowCount: 1,
          progress: 75,
          status: 'Downloading',
          timeLeft: '10m',
          estimatedCompletionTime: '2026-04-13T12:10:00.000Z',
          size: 1_000_000_000,
          sizeLeft: 250_000_000,
          byteMetricsPartial: false,
        },
        canCancel: true,
        canRemove: true,
      },
    ]);
  });

  it('sorts queue entries by acquisition time newest first', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const olderJob: AcquisitionJob = {
      id: 'job-old',
      itemId: 'movie:111',
      arrItemId: 111,
      kind: 'movie',
      title: 'Older Managed Fixture',
      sourceService: 'radarr',
      status: 'validating',
      attempt: 1,
      maxRetries: 3,
      currentRelease: null,
      selectedReleaser: null,
      preferredReleaser: null,
      reasonCode: null,
      failureReason: null,
      validationSummary: null,
      autoRetrying: false,
      progress: 90,
      queueStatus: 'Downloading',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: null,
      targetEpisodeIds: null,
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:20:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const newerJob: AcquisitionJob = {
      ...olderJob,
      id: 'job-new',
      itemId: 'movie:222',
      arrItemId: 222,
      title: 'Newer Managed Fixture',
      progress: 10,
      startedAt: '2026-04-13T12:10:00.000Z',
      updatedAt: '2026-04-13T12:10:00.000Z',
    };
    const externalItem: QueueItem = {
      id: 'radarr:queue:333',
      arrItemId: 333,
      canCancel: true,
      kind: 'movie',
      title: 'Middle External Fixture',
      year: 2026,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 50,
      timeLeft: '10m',
      estimatedCompletionTime: '2026-04-13T12:15:00.000Z',
      addedAt: '2026-04-13T12:05:00.000Z',
      size: 1_000,
      sizeLeft: 500,
      queueId: 333,
      detail: null,
      episodeIds: null,
      seasonNumbers: null,
    };

    const entries = composeQueueEntries([olderJob, newerJob], [externalItem]);

    expect(entries.map((entry) => entry.id)).toEqual(['job-new', externalItem.id, 'job-old']);
  });

  it('keeps stale sibling movie queue rows external after the current re-grab row is claimed', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-movie-reregrab',
      itemId: 'movie:603',
      arrItemId: 603,
      kind: 'movie',
      title: 'Fixture Movie',
      sourceService: 'radarr',
      status: 'validating',
      attempt: 2,
      maxRetries: 4,
      currentRelease: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      liveQueueId: 22,
      liveDownloadId: 'radarr-download-2',
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
      updatedAt: '2026-04-13T12:05:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const staleQueueItem: QueueItem = {
      id: 'radarr:queue:21',
      downloadId: 'radarr-download-1',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'Fixture Movie',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 35,
      timeLeft: '30m',
      estimatedCompletionTime: '2026-04-13T12:30:00.000Z',
      size: 4_000_000_000,
      sizeLeft: 2_600_000_000,
      queueId: 21,
      detail: 'Fixture.Movie.1999.1080p.BluRay-OLD',
      episodeIds: null,
      seasonNumbers: null,
    };
    const currentQueueItem: QueueItem = {
      ...staleQueueItem,
      id: 'radarr:queue:22',
      downloadId: 'radarr-download-2',
      progress: 72,
      timeLeft: '8m',
      estimatedCompletionTime: '2026-04-13T12:08:00.000Z',
      sizeLeft: 1_120_000_000,
      queueId: 22,
      detail: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
    };

    const entries = composeQueueEntries([acquisitionJob], [staleQueueItem, currentQueueItem]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: 'managed',
      liveQueueItems: [currentQueueItem],
    });
    expect(entries[1]).toEqual({
      kind: 'external',
      id: staleQueueItem.id,
      item: staleQueueItem,
      canCancel: true,
      canRemove: false,
    });
  });

  it('does not attach a wrong-release sibling movie row before the managed live identity is known', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-movie-bootstrap',
      itemId: 'movie:603',
      arrItemId: 603,
      kind: 'movie',
      title: 'Fixture Movie',
      sourceService: 'radarr',
      status: 'validating',
      attempt: 1,
      maxRetries: 4,
      currentRelease: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      liveQueueId: null,
      liveDownloadId: null,
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
      updatedAt: '2026-04-13T12:05:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const siblingQueueItem: QueueItem = {
      id: 'radarr:queue:21',
      downloadId: 'radarr-download-1',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'Fixture.Movie.1999.1080p.BluRay-OLD',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 35,
      timeLeft: '30m',
      estimatedCompletionTime: '2026-04-13T12:30:00.000Z',
      size: 4_000_000_000,
      sizeLeft: 2_600_000_000,
      queueId: 21,
      detail: null,
      episodeIds: null,
      seasonNumbers: null,
    };

    const entries = composeQueueEntries([acquisitionJob], [siblingQueueItem]);

    expect(entries).toEqual([
      {
        kind: 'managed',
        id: acquisitionJob.id,
        job: acquisitionJob,
        liveQueueItems: [],
        liveSummary: null,
        canCancel: true,
        canRemove: true,
      },
      {
        kind: 'external',
        id: siblingQueueItem.id,
        item: siblingQueueItem,
        canCancel: true,
        canRemove: false,
      },
    ]);
  });

  it('leaves stale Arr rows external once the managed job is terminal', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const failedJob: AcquisitionJob = {
      id: 'job-terminal-1',
      itemId: 'movie:727',
      arrItemId: 727,
      kind: 'movie',
      title: 'Fixture Queue',
      sourceService: 'radarr',
      status: 'failed',
      attempt: 2,
      maxRetries: 4,
      currentRelease: 'Fixture.Queue.2025.1080p.WEB.H264-KBOX',
      liveQueueId: null,
      liveDownloadId: null,
      selectedReleaser: 'kbox',
      preferredReleaser: null,
      reasonCode: 'import-blocked',
      failureReason: 'Arr refused to import the release: Not an upgrade for existing movie file.',
      validationSummary:
        'Arr refused to import the release: Not an upgrade for existing movie file.',
      autoRetrying: false,
      progress: 100,
      queueStatus: 'Import blocked',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: null,
      targetEpisodeIds: null,
      startedAt: '2026-04-18T10:40:57.698Z',
      updatedAt: '2026-04-18T11:05:28.375Z',
      completedAt: '2026-04-18T11:05:28.375Z',
      attempts: [],
    };
    const staleQueueItem: QueueItem = {
      id: 'radarr:queue:1996958567',
      downloadId: 'SABnzbd_nzo_4lejah9m',
      arrItemId: 727,
      canCancel: true,
      kind: 'movie',
      title: 'Fixture.Queue.2025.1080p.WEB.H264-KBOX',
      year: 2025,
      poster: null,
      sourceService: 'radarr',
      status: 'Completed',
      statusDetail: 'Not an upgrade for existing movie file. Existing quality: Bluray-2160p.',
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importpending',
      progress: 100,
      timeLeft: '00:00:00',
      estimatedCompletionTime: '2026-04-18T11:05:28Z',
      size: 7_845_710_150,
      sizeLeft: 0,
      queueId: 1996958567,
      detail: 'Fixture.Queue.2025.1080p.WEB.H264-KBOX',
      episodeIds: null,
      seasonNumbers: null,
    };

    const entries = composeQueueEntries([failedJob], [staleQueueItem]);

    expect(entries).toEqual([
      {
        kind: 'managed',
        id: failedJob.id,
        job: failedJob,
        liveQueueItems: [],
        liveSummary: null,
        canCancel: false,
        canRemove: true,
      },
      {
        kind: 'external',
        id: staleQueueItem.id,
        item: {
          ...staleQueueItem,
          title: 'Fixture Queue',
          detail: 'Fixture.Queue.2025.1080p.WEB.H264-KBOX',
        },
        canCancel: false,
        canRemove: true,
      },
    ]);
  });

  it('keeps import-pending completed rows cancelable when Arr has not reported a terminal import block', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const queueItem: QueueItem = {
      id: 'radarr:queue:44',
      downloadId: 'radarr-download-44',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'Fixture Movie',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Completed',
      statusDetail: 'Import pending',
      trackedDownloadStatus: 'ok',
      trackedDownloadState: 'importpending',
      progress: 100,
      timeLeft: '00:00:00',
      estimatedCompletionTime: '2026-04-13T12:10:00.000Z',
      size: 1_000_000_000,
      sizeLeft: 0,
      queueId: 44,
      detail: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };

    expect(composeQueueEntries([], [queueItem])).toEqual([
      {
        kind: 'external',
        id: queueItem.id,
        item: queueItem,
        canCancel: true,
        canRemove: false,
      },
    ]);
  });

  it('marks recognized terminal Arr import warnings as stale external entries', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const queueItem: QueueItem = {
      id: 'radarr:queue:45',
      downloadId: 'radarr-download-45',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'Fixture Movie',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Completed',
      statusDetail: 'Import failed, destination path already exists.',
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importpending',
      progress: 100,
      timeLeft: '00:00:00',
      estimatedCompletionTime: '2026-04-13T12:10:00.000Z',
      size: 1_000_000_000,
      sizeLeft: 0,
      queueId: 45,
      detail: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };

    expect(composeQueueEntries([], [queueItem])).toEqual([
      {
        kind: 'external',
        id: queueItem.id,
        item: queueItem,
        canCancel: false,
        canRemove: true,
      },
    ]);
  });

  it('keeps download-id-only external rows cancelable when they are still active', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const queueItem: QueueItem = {
      id: 'radarr:download:download-shared',
      downloadId: 'download-shared',
      arrItemId: 603,
      canCancel: false,
      kind: 'movie',
      title: 'Fixture Movie',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 50,
      timeLeft: '10m',
      estimatedCompletionTime: '2026-04-13T12:10:00.000Z',
      size: 1_000_000_000,
      sizeLeft: 500_000_000,
      queueId: null,
      detail: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };

    expect(composeQueueEntries([], [queueItem])).toEqual([
      {
        kind: 'external',
        id: queueItem.id,
        item: queueItem,
        canCancel: true,
        canRemove: false,
      },
    ]);
  });

  it('disables managed cancel when the attached live Arr row has no queue id', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-download-only',
      itemId: 'movie:603',
      arrItemId: 603,
      kind: 'movie',
      title: 'Fixture Movie',
      sourceService: 'radarr',
      status: 'grabbing',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      selectedReleaser: 'flux',
      preferredReleaser: 'flux',
      reasonCode: null,
      failureReason: null,
      validationSummary: null,
      autoRetrying: false,
      progress: 50,
      queueStatus: 'Downloading',
      liveQueueId: null,
      liveDownloadId: 'download-shared',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: null,
      targetEpisodeIds: null,
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:01:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const queueItem: QueueItem = {
      id: 'radarr:download:download-shared',
      downloadId: 'download-shared',
      arrItemId: 603,
      canCancel: false,
      kind: 'movie',
      title: 'Fixture Movie',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 50,
      timeLeft: '10m',
      estimatedCompletionTime: '2026-04-13T12:10:00.000Z',
      size: 1_000_000_000,
      sizeLeft: 500_000_000,
      queueId: null,
      detail: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };

    expect(composeQueueEntries([acquisitionJob], [queueItem])).toEqual([
      expect.objectContaining({
        kind: 'managed',
        id: acquisitionJob.id,
        liveQueueItems: [queueItem],
        canCancel: false,
        canRemove: false,
      }),
    ]);
  });

  it('keeps download-id-only stale external rows removable', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const queueItem: QueueItem = {
      id: 'radarr:download:download-shared',
      downloadId: 'download-shared',
      arrItemId: 603,
      canCancel: false,
      kind: 'movie',
      title: 'Fixture Movie',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Completed',
      statusDetail: 'Import failed, destination path already exists.',
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importpending',
      progress: 100,
      timeLeft: '00:00:00',
      estimatedCompletionTime: '2026-04-13T12:10:00.000Z',
      size: 1_000_000_000,
      sizeLeft: 0,
      queueId: null,
      detail: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };

    expect(composeQueueEntries([], [queueItem])).toEqual([
      {
        kind: 'external',
        id: queueItem.id,
        item: queueItem,
        canCancel: false,
        canRemove: true,
      },
    ]);
  });

  it('keeps distinct download-only external rows when Arr reuses one download id without queue ids', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const firstQueueItem: QueueItem = {
      id: 'sonarr:download:download-shared:sonarr-83867-Fixture Series-s01e01-1080p-web-dl-flux-episodes-101',
      downloadId: 'download-shared',
      arrItemId: 83867,
      canCancel: false,
      kind: 'series',
      title: 'Fixture Series',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 25,
      timeLeft: '18m',
      estimatedCompletionTime: '2026-04-13T12:18:00.000Z',
      size: 2_000_000_000,
      sizeLeft: 1_500_000_000,
      queueId: null,
      detail: 'Fixture Series.S01E01.1080p.WEB-DL-FLUX',
      episodeIds: [101],
      seasonNumbers: [1],
    };
    const secondQueueItem: QueueItem = {
      ...firstQueueItem,
      id: 'sonarr:download:download-shared:sonarr-83867-Fixture Series-s01e02-1080p-web-dl-flux-episodes-102',
      detail: 'Fixture Series.S01E02.1080p.WEB-DL-FLUX',
      episodeIds: [102],
    };

    expect(composeQueueEntries([], [firstQueueItem, secondQueueItem])).toEqual([
      {
        kind: 'external',
        id: firstQueueItem.id,
        item: firstQueueItem,
        canCancel: true,
        canRemove: false,
      },
      {
        kind: 'external',
        id: secondQueueItem.id,
        item: secondQueueItem,
        canCancel: true,
        canRemove: false,
      },
    ]);
  });

  it('keeps generic Arr warning rows cancelable until they match a known terminal import warning', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const queueItem: QueueItem = {
      id: 'radarr:queue:46',
      downloadId: 'radarr-download-46',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'Fixture Movie',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Completed',
      statusDetail: 'Import failed, temporary permission issue.',
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importpending',
      progress: 100,
      timeLeft: '00:00:00',
      estimatedCompletionTime: '2026-04-13T12:10:00.000Z',
      size: 1_000_000_000,
      sizeLeft: 0,
      queueId: 46,
      detail: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };

    expect(composeQueueEntries([], [queueItem])).toEqual([
      {
        kind: 'external',
        id: queueItem.id,
        item: queueItem,
        canCancel: true,
        canRemove: false,
      },
    ]);
  });

  it('keeps same-scope Sonarr rows external until a managed release has been chosen', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-1',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Fixture Series',
      sourceService: 'sonarr',
      status: 'searching',
      attempt: 1,
      maxRetries: 3,
      currentRelease: null,
      selectedReleaser: null,
      preferredReleaser: 'flux',
      reasonCode: null,
      failureReason: null,
      validationSummary: 'Waiting for a manual release choice.',
      autoRetrying: false,
      progress: null,
      queueStatus: 'Queued',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:05:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const matchingQueueItem: QueueItem = {
      id: 'sonarr:queue:1',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Fixture Series',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 58,
      timeLeft: '18m',
      estimatedCompletionTime: '2026-04-13T12:18:00.000Z',
      size: 4_000_000_000,
      sizeLeft: 1_200_000_000,
      queueId: 2,
      detail: 'Fixture Series.S01.1080p.WEB-DL-FLUX',
      episodeIds: [101, 102],
      seasonNumbers: [1],
    };
    const externalQueueItem: QueueItem = {
      id: 'radarr:queue:1',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'Fixture Movie',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 75,
      timeLeft: '10m',
      estimatedCompletionTime: '2026-04-13T12:10:00.000Z',
      size: 1_000_000_000,
      sizeLeft: 250_000_000,
      queueId: 1,
      detail: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };

    const entries = composeQueueEntries([acquisitionJob], [externalQueueItem, matchingQueueItem]);

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      kind: 'managed',
      liveQueueItems: [],
      liveSummary: null,
    });
    expect(entries[1]).toEqual({
      kind: 'external',
      id: 'radarr:queue:1',
      item: externalQueueItem,
      canCancel: true,
      canRemove: false,
    });
    expect(entries[2]).toMatchObject({
      kind: 'external',
      item: matchingQueueItem,
      canCancel: true,
      canRemove: false,
    });
  });

  it('aggregates multiple matching Arr queue rows into one managed entry', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-2',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Fixture Series',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 2,
      maxRetries: 3,
      currentRelease: 'Fixture Series.S01.1080p.WEB-DL-FLUX',
      selectedReleaser: 'flux',
      preferredReleaser: 'flux',
      reasonCode: null,
      failureReason: null,
      validationSummary: 'Sending to downloader',
      autoRetrying: false,
      progress: 45,
      queueStatus: 'Queued',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:05:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const firstQueueItem: QueueItem = {
      id: 'sonarr:queue:1',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Fixture Series',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 25,
      timeLeft: '18m',
      estimatedCompletionTime: '2026-04-13T12:18:00.000Z',
      size: 2_000_000_000,
      sizeLeft: 1_500_000_000,
      queueId: 2,
      detail: 'Fixture Series.S01E01.1080p.WEB-DL-FLUX',
      episodeIds: [101],
      seasonNumbers: [1],
    };
    const secondQueueItem: QueueItem = {
      ...firstQueueItem,
      id: 'sonarr:queue:2',
      episodeIds: [102],
      progress: 75,
      timeLeft: '8m',
      estimatedCompletionTime: '2026-04-13T12:08:00.000Z',
      sizeLeft: 500_000_000,
      queueId: 3,
      detail: 'Fixture Series.S01E02.1080p.WEB-DL-FLUX',
    };

    const entries = composeQueueEntries([acquisitionJob], [firstQueueItem, secondQueueItem]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'managed',
      liveQueueItems: [firstQueueItem, secondQueueItem],
      liveSummary: {
        rowCount: 2,
        progress: 50,
        status: 'Downloading',
        timeLeft: '8m',
        estimatedCompletionTime: '2026-04-13T12:08:00.000Z',
        size: 4_000_000_000,
        sizeLeft: 2_000_000_000,
        byteMetricsPartial: false,
      },
    });
  });

  it('merges same-season queue rows into one managed series entry', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-3',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Fixture Series',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 2,
      maxRetries: 3,
      currentRelease: 'Fixture Series.S01E01.1080p.WEB-DL-FLUX',
      selectedReleaser: 'flux',
      preferredReleaser: 'flux',
      reasonCode: null,
      failureReason: null,
      validationSummary: 'Sending to downloader',
      autoRetrying: false,
      progress: 45,
      queueStatus: 'Queued',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:05:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const matchingQueueItem: QueueItem = {
      id: 'sonarr:queue:1',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Fixture Series',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 25,
      timeLeft: '18m',
      estimatedCompletionTime: '2026-04-13T12:18:00.000Z',
      size: 2_000_000_000,
      sizeLeft: 1_500_000_000,
      queueId: 2,
      detail: 'Fixture Series.S01E01.1080p.WEB-DL-FLUX',
      episodeIds: [101],
      seasonNumbers: [1],
    };
    const unrelatedQueueItem: QueueItem = {
      ...matchingQueueItem,
      id: 'sonarr:queue:3',
      queueId: 3,
      detail: 'Fixture Series.S01E03.1080p.WEB-DL-FLUX',
      episodeIds: [103],
    };

    const entries = composeQueueEntries([acquisitionJob], [matchingQueueItem, unrelatedQueueItem]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'managed',
      liveQueueItems: [matchingQueueItem, unrelatedQueueItem],
    });
  });

  it('matches season-pack queue rows even when the managed series job persists target episode ids', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-4',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Fixture Series',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'Fixture Series.S01.1080p.WEB-DL-FLUX',
      selectedReleaser: 'flux',
      preferredReleaser: 'flux',
      reasonCode: null,
      failureReason: null,
      validationSummary: null,
      autoRetrying: false,
      progress: 15,
      queueStatus: 'Queued',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:05:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const seasonPackQueueItem: QueueItem = {
      id: 'sonarr:queue:11',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Fixture Series',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 61,
      timeLeft: '22m',
      estimatedCompletionTime: '2026-04-13T12:22:00.000Z',
      size: 8_000_000_000,
      sizeLeft: 3_120_000_000,
      queueId: 11,
      detail: 'Fixture Series.S01.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: [1],
    };
    const unrelatedSeasonQueueItem: QueueItem = {
      ...seasonPackQueueItem,
      id: 'sonarr:queue:12',
      queueId: 12,
      detail: 'Fixture Series.S02.1080p.WEB-DL-FLUX',
      seasonNumbers: [2],
    };

    const entries = composeQueueEntries(acquisitionJob ? [acquisitionJob] : [], [
      seasonPackQueueItem,
      unrelatedSeasonQueueItem,
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: 'managed',
      liveQueueItems: [seasonPackQueueItem],
      liveSummary: {
        rowCount: 1,
        progress: 61,
      },
    });
    expect(entries[1]).toEqual({
      kind: 'external',
      id: unrelatedSeasonQueueItem.id,
      item: unrelatedSeasonQueueItem,
      canCancel: true,
      canRemove: false,
    });
  });

  it('keeps broader season-pack queue rows external when they exceed the managed target scope', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-4b',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Fixture Series',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'Fixture Series.S01.1080p.WEB-DL-FLUX',
      selectedReleaser: 'flux',
      preferredReleaser: 'flux',
      reasonCode: null,
      failureReason: null,
      validationSummary: null,
      autoRetrying: false,
      progress: 15,
      queueStatus: 'Queued',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:05:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const broaderSeasonPackQueueItem: QueueItem = {
      id: 'sonarr:queue:13',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Fixture Series',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 33,
      timeLeft: '36m',
      estimatedCompletionTime: '2026-04-13T12:36:00.000Z',
      size: 12_000_000_000,
      sizeLeft: 8_040_000_000,
      queueId: 13,
      detail: 'Fixture Series.S01-S02.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: [1, 2],
    };

    const entries = composeQueueEntries([acquisitionJob], [broaderSeasonPackQueueItem]);

    expect(entries).toEqual([
      expect.objectContaining({
        kind: 'managed',
        liveQueueItems: [],
        liveSummary: null,
      }),
      {
        kind: 'external',
        id: broaderSeasonPackQueueItem.id,
        item: broaderSeasonPackQueueItem,
        canCancel: true,
        canRemove: false,
      },
    ]);
  });

  it('does not attach same-scope Sonarr sibling rows before the managed live identity is known unless the release family matches', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-series-bootstrap',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Fixture Series',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'Fixture Series.S01.1080p.WEB-DL-FLUX',
      selectedReleaser: 'flux',
      preferredReleaser: 'flux',
      reasonCode: null,
      failureReason: null,
      validationSummary: null,
      autoRetrying: false,
      progress: 15,
      queueStatus: 'Queued',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:05:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const staleSiblingQueueItem: QueueItem = {
      id: 'sonarr:queue:13',
      downloadId: 'download-old',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Fixture Series.Release.Old',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 33,
      timeLeft: '36m',
      estimatedCompletionTime: '2026-04-13T12:36:00.000Z',
      size: 12_000_000_000,
      sizeLeft: 8_040_000_000,
      queueId: 13,
      detail: 'Fixture Series.S01E01.1080p.WEB-DL-OLD',
      episodeIds: [101],
      seasonNumbers: [1],
    };

    const entries = composeQueueEntries([acquisitionJob], [staleSiblingQueueItem]);

    expect(entries).toEqual([
      expect.objectContaining({
        kind: 'managed',
        liveQueueItems: [],
        liveSummary: null,
      }),
      {
        kind: 'external',
        id: staleSiblingQueueItem.id,
        item: staleSiblingQueueItem,
        canCancel: true,
        canRemove: false,
      },
    ]);
  });

  it('keeps distinct queue rows when Arr reuses one download id across multiple queue ids', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-5',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Fixture Series',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'Fixture Series.S01.1080p.WEB-DL-FLUX',
      selectedReleaser: 'flux',
      preferredReleaser: 'flux',
      reasonCode: null,
      failureReason: null,
      validationSummary: null,
      autoRetrying: false,
      progress: 40,
      queueStatus: 'Queued',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:05:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const sharedDownloadId = 'download-shared';
    const matchingQueueItem: QueueItem = {
      id: 'sonarr:queue:21',
      downloadId: sharedDownloadId,
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Fixture Series',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 25,
      timeLeft: '18m',
      estimatedCompletionTime: '2026-04-13T12:18:00.000Z',
      size: 2_000_000_000,
      sizeLeft: 1_500_000_000,
      queueId: 21,
      detail: 'Fixture Series.S01E01.1080p.WEB-DL-FLUX',
      episodeIds: [101],
      seasonNumbers: [1],
    };
    const siblingQueueItem: QueueItem = {
      ...matchingQueueItem,
      id: 'sonarr:queue:22',
      queueId: 22,
      detail: 'Fixture Series.S01E02.1080p.WEB-DL-FLUX',
      episodeIds: [102],
    };
    const unrelatedQueueItem: QueueItem = {
      ...matchingQueueItem,
      id: 'sonarr:queue:23',
      queueId: 23,
      detail: 'Fixture Series.S02E01.1080p.WEB-DL-FLUX',
      episodeIds: [201],
      seasonNumbers: [2],
    };

    const entries = composeQueueEntries(acquisitionJob ? [acquisitionJob] : [], [
      matchingQueueItem,
      siblingQueueItem,
      unrelatedQueueItem,
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: 'managed',
      liveQueueItems: [matchingQueueItem, siblingQueueItem],
    });
    expect(entries[1]).toEqual({
      kind: 'external',
      id: 'sonarr:queue:23',
      item: unrelatedQueueItem,
      canCancel: true,
      canRemove: false,
    });
  });

  it('keeps wrong same-scope Sonarr sibling rows external after the managed live identity is known', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-series-reregrab',
      itemId: 'series:83867',
      arrItemId: 83867,
      kind: 'series',
      title: 'Fixture Series',
      sourceService: 'sonarr',
      status: 'validating',
      attempt: 2,
      maxRetries: 3,
      currentRelease: 'Fixture Series.S01.1080p.WEB-DL-FLUX',
      liveQueueId: 21,
      liveDownloadId: 'download-shared',
      selectedReleaser: 'flux',
      preferredReleaser: 'flux',
      reasonCode: null,
      failureReason: null,
      validationSummary: null,
      autoRetrying: false,
      progress: 40,
      queueStatus: 'Downloading',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:05:00.000Z',
      completedAt: null,
      attempts: [],
    };
    const matchingQueueItem: QueueItem = {
      id: 'sonarr:queue:21',
      downloadId: 'download-shared',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Fixture Series',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 25,
      timeLeft: '18m',
      estimatedCompletionTime: '2026-04-13T12:18:00.000Z',
      size: 2_000_000_000,
      sizeLeft: 1_500_000_000,
      queueId: 21,
      detail: 'Fixture Series.S01E01.1080p.WEB-DL-FLUX',
      episodeIds: [101],
      seasonNumbers: [1],
    };
    const staleSiblingQueueItem: QueueItem = {
      ...matchingQueueItem,
      id: 'sonarr:queue:22',
      downloadId: 'download-old',
      queueId: 22,
      detail: 'Fixture Series.S01E02.1080p.WEB-DL-OLD',
      episodeIds: [102],
    };

    const entries = composeQueueEntries(
      [acquisitionJob],
      [matchingQueueItem, staleSiblingQueueItem],
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: 'managed',
      liveQueueItems: [matchingQueueItem],
    });
    expect(entries[1]).toEqual({
      kind: 'external',
      id: staleSiblingQueueItem.id,
      item: staleSiblingQueueItem,
      canCancel: true,
      canRemove: false,
    });
  });

  it('keeps Arr ids on dashboard fallback items so audit cards can delete them', async () => {
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/history') {
        return {
          records: [
            {
              movieId: 603,
              sourceTitle: 'Fixture.Movie.1999.1080p.WEB-DL-FLUX',
              movie: {
                title: 'Fixture Movie',
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
      title: 'Fixture Movie',
    });
  });

  it('sorts dashboard checks by acquisition time newest first', async () => {
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/history') {
        return {
          records: [
            {
              date: '2026-04-13T12:00:00.000Z',
              movieId: 111,
              sourceTitle: 'Alpha.Fixture.2026.1080p.WEB-DL-OLD',
              movie: {
                title: 'Alpha Fixture',
                year: 2026,
              },
            },
            {
              date: '2026-04-13T12:10:00.000Z',
              movieId: 222,
              sourceTitle: 'Beta.Fixture.2026.1080p.WEB-DL-NEW',
              movie: {
                title: 'Beta Fixture',
                year: 2026,
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

    expect(dashboard.items.map((item) => item.title)).toEqual(['Beta Fixture', 'Alpha Fixture']);
    expect(dashboard.items.map((item) => item.acquiredAt)).toEqual([
      '2026-04-13T12:10:00.000Z',
      '2026-04-13T12:00:00.000Z',
    ]);
  });

  it('shows one check card for a recent Bountarr grab even when Arr history is empty', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T15:00:00.000Z'));

    const job: AcquisitionJob = {
      id: 'job-soylent-green',
      itemId: 'movie:961',
      arrItemId: 961,
      kind: 'movie',
      title: 'Soylent Green',
      sourceService: 'radarr',
      status: 'completed',
      attempt: 3,
      maxRetries: 3,
      currentRelease: 'Soylent.Green.1973.1080p.BluRay.x265.DDP1.0-R1GY3B',
      selectedReleaser: 'r1gy3b',
      preferredReleaser: null,
      reasonCode: 'validated',
      failureReason: null,
      validationSummary: 'Verified English audio and English subtitles.',
      autoRetrying: false,
      progress: 100,
      queueStatus: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      targetSeasonNumbers: null,
      targetEpisodeIds: null,
      startedAt: '2026-05-17T14:00:00.000Z',
      updatedAt: '2026-05-17T14:48:49.113Z',
      completedAt: '2026-05-17T14:48:49.113Z',
      attempts: [],
    };
    acquisitionRepositoryState.jobs = [
      {
        ...job,
        id: 'job-soylent-green-old',
        currentRelease: 'Soylent.Green.1973.1080p.BluRay.x264-OLD',
        completedAt: '2026-05-17T14:10:00.000Z',
        updatedAt: '2026-05-17T14:10:00.000Z',
      },
      job,
    ];

    const soylentGreen: MediaItem = {
      id: 'movie:961',
      arrItemId: 961,
      kind: 'movie',
      title: 'Soylent Green',
      year: 1973,
      rating: 7.0,
      poster: null,
      overview: '',
      status: 'Downloaded',
      isExisting: true,
      isRequested: true,
      auditStatus: 'verified',
      audioLanguages: ['English'],
      subtitleLanguages: ['English'],
      sourceService: 'radarr',
      origin: 'arr',
      inArr: true,
      inPlex: false,
      plexLibraries: [],
      canAdd: false,
      canDeleteFromArr: true,
      detail: 'Soylent.Green.1973.1080p.BluRay.x265.DDP1.0-R1GY3B.mkv',
      acquiredAt: null,
      requestPayload: {
        title: 'Soylent Green',
        tmdbId: 12101,
      },
    };

    const arrFetch = vi.fn().mockResolvedValue({ records: [] });
    const fetchExistingMovie = vi.fn().mockResolvedValue(soylentGreen);

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
      fetchExistingMovie,
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

    expect(fetchExistingMovie).toHaveBeenCalledTimes(1);
    expect(dashboard.items).toHaveLength(1);
    expect(dashboard.items[0]).toMatchObject({
      arrItemId: 961,
      auditStatus: 'verified',
      detail: 'Soylent.Green.1973.1080p.BluRay.x265.DDP1.0-R1GY3B.mkv',
      title: 'Soylent Green',
    });
    expect(dashboard.items[0]?.acquiredAt).toBe('2026-05-17T14:48:49.113Z');
  });

  it('shows no-release acquisition jobs as not found instead of unknown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T15:00:00.000Z'));

    acquisitionRepositoryState.jobs = [
      {
        id: 'job-lunopolis',
        itemId: 'movie:959',
        arrItemId: 959,
        kind: 'movie',
        title: 'Lunopolis',
        sourceService: 'radarr',
        status: 'failed',
        attempt: 1,
        maxRetries: 4,
        currentRelease: null,
        selectedReleaser: null,
        preferredReleaser: null,
        reasonCode: 'no-release-available',
        failureReason: 'No manual-search releases were returned by Arr',
        validationSummary: 'No manual-search releases were returned by Arr',
        autoRetrying: false,
        progress: null,
        queueStatus: 'Search failed',
        preferences: {
          preferredLanguage: 'English',
          subtitleLanguage: 'English',
        },
        targetSeasonNumbers: null,
        targetEpisodeIds: null,
        startedAt: '2026-05-17T14:30:00.000Z',
        updatedAt: '2026-05-17T14:40:11.310Z',
        completedAt: '2026-05-17T14:40:11.310Z',
        attempts: [],
      },
    ];

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch: vi.fn().mockResolvedValue({ records: [] }),
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
      fetchExistingMovie: vi.fn().mockResolvedValue({
        id: 'movie:959',
        arrItemId: 959,
        kind: 'movie',
        title: 'Lunopolis',
        year: 2010,
        rating: null,
        poster: null,
        overview: '',
        status: 'Monitored',
        isExisting: true,
        isRequested: true,
        auditStatus: 'unknown',
        audioLanguages: [],
        subtitleLanguages: [],
        sourceService: 'radarr',
        origin: 'arr',
        inArr: true,
        inPlex: false,
        plexLibraries: [],
        canAdd: false,
        canDeleteFromArr: true,
        detail: null,
        acquiredAt: null,
        requestPayload: {
          title: 'Lunopolis',
          tmdbId: 83399,
        },
      } satisfies MediaItem),
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

    expect(dashboard.items).toHaveLength(1);
    expect(dashboard.items[0]).toMatchObject({
      auditStatus: 'not-found',
      detail: 'No manual-search releases were returned by Arr',
      title: 'Lunopolis',
    });
    expect(dashboard.summary).toMatchObject({
      attention: 1,
      pending: 0,
    });
  });

  it('queues a daily search for a stale missing released Radarr movie on dashboard refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T15:00:00.000Z'));

    acquisitionRepositoryState.jobs = [missingMovieJob()];
    mockDashboardDependencies();

    const module = await import('$lib/server/queue-dashboard-service');
    await module.getDashboard(
      {
        cardsView: 'rounded',
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
        theme: 'system',
      },
      { force: true },
    );

    expect(acquisitionRepositoryState.jobs[0]).toMatchObject({
      attempt: 2,
      completedAt: null,
      failureReason: null,
      queueStatus: 'Queued daily release search',
      reasonCode: null,
      status: 'queued',
      validationSummary: null,
    });
    expect(acquisitionRunnerState.enqueuedJobIds).toEqual(['job-lunopolis']);
  });

  it('skips the daily search when Bountarr searched the missing movie in the last 24 hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T15:00:00.000Z'));

    acquisitionRepositoryState.jobs = [
      missingMovieJob({
        attempts: [
          {
            attempt: 1,
            detectedAudioLanguages: [],
            detectedSubtitleLanguages: [],
            finishedAt: '2026-05-17T14:30:00.000Z',
            manualSelectionMode: null,
            reason: 'No manual-search releases were returned by Arr',
            reasonCode: 'no-release-available',
            releaseTitle: null,
            releaser: null,
            startedAt: '2026-05-17T14:29:00.000Z',
            status: 'failed',
            submittedGuid: null,
            submittedIndexerId: null,
            submissionClaimedAt: null,
          },
        ],
        completedAt: '2026-05-17T14:30:00.000Z',
        updatedAt: '2026-05-17T14:30:00.000Z',
      }),
    ];
    const arrFetch = mockDashboardDependencies();

    const module = await import('$lib/server/queue-dashboard-service');
    await module.getDashboard(
      {
        cardsView: 'rounded',
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
        theme: 'system',
      },
      { force: true },
    );

    expect(acquisitionRepositoryState.jobs[0]?.status).toBe('failed');
    expect(acquisitionRunnerState.enqueuedJobIds).toEqual([]);
    expect(arrFetch).not.toHaveBeenCalledWith('radarr', '/api/v3/command');
  });

  it('skips the daily search when Radarr recently searched the missing movie', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T15:00:00.000Z'));

    acquisitionRepositoryState.jobs = [missingMovieJob()];
    mockDashboardDependencies({
      commands: [
        {
          body: {
            movieIds: [959],
          },
          name: 'MoviesSearch',
          startedAt: '2026-05-17T14:00:00.000Z',
        },
      ],
    });

    const module = await import('$lib/server/queue-dashboard-service');
    await module.getDashboard(
      {
        cardsView: 'rounded',
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
        theme: 'system',
      },
      { force: true },
    );

    expect(acquisitionRepositoryState.jobs[0]?.status).toBe('failed');
    expect(acquisitionRunnerState.enqueuedJobIds).toEqual([]);
  });

  it('keeps unreleased missing movies visible without queuing daily manual review searches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T15:00:00.000Z'));

    acquisitionRepositoryState.jobs = [
      missingMovieJob({
        arrItemId: 956,
        id: 'job-obsession',
        itemId: 'movie:956',
        title: 'Obsession',
      }),
    ];
    mockDashboardDependencies({
      movieStatus: 'announced',
      title: 'Obsession',
    });

    const module = await import('$lib/server/queue-dashboard-service');
    const dashboard = await module.getDashboard(
      {
        cardsView: 'rounded',
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
        theme: 'system',
      },
      { force: true },
    );

    expect(acquisitionRepositoryState.jobs[0]?.status).toBe('failed');
    expect(acquisitionRunnerState.enqueuedJobIds).toEqual([]);
    expect(dashboard.items[0]).toMatchObject({
      auditStatus: 'not-released',
      title: 'Obsession',
    });
  });

  it('shows old Bountarr grabs only when all-grabs checks mode is requested', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T15:00:00.000Z'));

    acquisitionRepositoryState.jobs = [
      missingMovieJob({
        id: 'job-old',
        itemId: 'movie:101',
        arrItemId: 101,
        title: 'Old Bountarr Grab',
        startedAt: '2026-04-01T12:00:00.000Z',
        updatedAt: '2026-04-01T12:10:00.000Z',
        completedAt: '2026-04-01T12:10:00.000Z',
      }),
      missingMovieJob({
        id: 'job-new',
        itemId: 'movie:102',
        arrItemId: 102,
        title: 'Recent Bountarr Grab',
        startedAt: '2026-05-17T12:00:00.000Z',
        updatedAt: '2026-05-17T12:10:00.000Z',
        completedAt: '2026-05-17T12:10:00.000Z',
      }),
    ];
    mockDashboardDependencies();

    const module = await import('$lib/server/queue-dashboard-service');
    const recent = await module.getDashboard({
      cardsView: 'rounded',
      preferredLanguage: 'English',
      subtitleLanguage: 'English',
      theme: 'system',
    });
    const all = await module.getDashboard(
      {
        cardsView: 'rounded',
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
        theme: 'system',
      },
      { includeAllBountarr: true },
    );

    expect(recent.items.map((item) => item.title)).toEqual(['Recent Bountarr Grab']);
    expect(all.items.map((item) => item.title)).toEqual([
      'Recent Bountarr Grab',
      'Old Bountarr Grab',
    ]);
    expect(all.items.map((item) => item.id)).toEqual([
      'acquisition:job-new',
      'acquisition:job-old',
    ]);
    expect(all.items[0]?.requestPayload).toMatchObject({
      acquisitionJob: expect.objectContaining({
        id: 'job-new',
        title: 'Recent Bountarr Grab',
      }),
      acquisitionJobId: 'job-new',
      acquisitionJobStatus: 'failed',
    });
  });

  it('skips daily missing searches for movies that already need manual review', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T15:00:00.000Z'));

    acquisitionRepositoryState.jobs = [
      missingMovieJob({
        releaseCandidates: [
          {
            arrRejected: true,
            attempt: null,
            detectedAudioLanguages: [],
            detectedSubtitleLanguages: [],
            failedAt: null,
            failureReason: null,
            firstSeenAt: '2026-05-16T12:10:00.000Z',
            guid: 'guid-lunopolis',
            indexer: 'Indexer',
            indexerId: 4,
            languages: ['English'],
            lastSeenAt: '2026-05-16T12:10:00.000Z',
            protocol: 'usenet',
            reason: 'Arr rejected this release.',
            score: -10_000,
            selectionMode: 'override-arr-rejection',
            size: 700_000_000,
            status: 'available',
            title: 'Lunopolis.2009.480p.WEB-DL.x264-mSD-ORHk',
          },
        ],
      }),
    ];
    const arrFetch = mockDashboardDependencies();

    const module = await import('$lib/server/queue-dashboard-service');
    await module.getDashboard(
      {
        cardsView: 'rounded',
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
        theme: 'system',
      },
      { force: true },
    );

    expect(acquisitionRepositoryState.jobs[0]?.status).toBe('failed');
    expect(acquisitionRunnerState.enqueuedJobIds).toEqual([]);
    expect(arrFetch).not.toHaveBeenCalledWith('radarr', '/api/v3/movie/959');
  });

  it('queues an automatic retry when a release-blocked movie now has an auto-selected release', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T15:00:00.000Z'));

    const releaseCandidate = {
      arrRejected: true,
      arrOverrideMode: 'adjacent-year' as const,
      attempt: null,
      autoBlockedReason: null,
      autoDecision: 'auto-selected' as const,
      detectedAudioLanguages: [],
      detectedSubtitleLanguages: [],
      failedAt: null,
      failureReason: null,
      firstSeenAt: '2026-05-16T12:10:00.000Z',
      guid: 'guid-lunopolis',
      indexer: 'Indexer',
      indexerId: 4,
      languages: ['English'],
      lastSeenAt: '2026-05-16T12:10:00.000Z',
      protocol: 'usenet',
      reason: 'Structured adjacent-year fallback',
      score: 124,
      selectionMode: 'override-arr-rejection' as const,
      size: 700_000_000,
      status: 'available' as const,
      title: 'Lunopolis.2009.480p.WEB-DL.x264-mSD-ORHk',
      yearMatch: 'adjacent' as const,
    };
    acquisitionRepositoryState.jobs = [
      missingMovieJob({
        releaseCandidates: [releaseCandidate],
      }),
    ];
    mockDashboardDependencies();
    acquisitionSelectionState.findReleaseSelection.mockResolvedValue({
      manualResults: [releaseCandidate],
      selectedGuid: releaseCandidate.guid,
      selectedRelease: releaseCandidate,
      selection: {
        payload: {
          guid: releaseCandidate.guid,
          indexerId: releaseCandidate.indexerId,
        },
      },
    });

    const module = await import('$lib/server/queue-dashboard-service');
    await module.getDashboard(
      {
        cardsView: 'rounded',
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
        theme: 'system',
      },
      { force: true },
    );

    expect(acquisitionSelectionState.findReleaseSelection).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-lunopolis' }),
    );
    expect(acquisitionRepositoryState.jobs[0]).toMatchObject({
      attempt: 2,
      queueStatus: 'Queued automatic release retry',
      reasonCode: null,
      status: 'queued',
    });
    expect(acquisitionRunnerState.enqueuedJobIds).toEqual(['job-lunopolis']);
  });

  it('queues an automatic retry for a crashed adjacent-year movie after the override payload is fixed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T15:00:00.000Z'));

    const releaseCandidate = {
      arrRejected: true,
      arrOverrideMode: 'adjacent-year' as const,
      attempt: null,
      autoBlockedReason: null,
      autoDecision: 'auto-selected' as const,
      detectedAudioLanguages: [],
      detectedSubtitleLanguages: [],
      failedAt: null,
      failureReason: null,
      firstSeenAt: '2026-05-16T12:10:00.000Z',
      guid: 'guid-lunopolis',
      indexer: 'Indexer',
      indexerId: 4,
      languages: ['English'],
      lastSeenAt: '2026-05-16T12:10:00.000Z',
      protocol: 'usenet',
      reason: 'Structured adjacent-year fallback',
      score: 124,
      selectionMode: 'override-arr-rejection' as const,
      size: 700_000_000,
      status: 'available' as const,
      title: 'Lunopolis.2009.480p.WEB-DL.x264-mSD-ORHk',
      yearMatch: 'adjacent' as const,
    };
    acquisitionRepositoryState.jobs = [
      missingMovieJob({
        failureReason: 'radarr 500: Value can not be null. (Parameter release.MovieId)',
        reasonCode: 'crashed',
        releaseCandidates: [releaseCandidate],
      }),
    ];
    mockDashboardDependencies();
    acquisitionSelectionState.findReleaseSelection.mockResolvedValue({
      manualResults: [releaseCandidate],
      selectedGuid: releaseCandidate.guid,
      selectedRelease: releaseCandidate,
      selection: {
        payload: {
          guid: releaseCandidate.guid,
          indexerId: releaseCandidate.indexerId,
        },
      },
    });

    const module = await import('$lib/server/queue-dashboard-service');
    await module.getDashboard(
      {
        cardsView: 'rounded',
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
        theme: 'system',
      },
      { force: true },
    );

    expect(acquisitionRepositoryState.jobs[0]).toMatchObject({
      attempt: 2,
      queueStatus: 'Queued automatic release retry',
      reasonCode: null,
      status: 'queued',
    });
    expect(acquisitionRunnerState.enqueuedJobIds).toEqual(['job-lunopolis']);
  });

  it('shows no-release jobs with later release candidates as needing manual review', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-17T15:00:00.000Z'));

    acquisitionRepositoryState.jobs = [
      {
        id: 'job-lunopolis',
        itemId: 'movie:959',
        arrItemId: 959,
        kind: 'movie',
        title: 'Lunopolis',
        sourceService: 'radarr',
        status: 'failed',
        attempt: 1,
        maxRetries: 4,
        currentRelease: null,
        selectedReleaser: null,
        preferredReleaser: null,
        reasonCode: 'no-release-available',
        failureReason: 'No manual-search releases were returned by Arr',
        validationSummary: 'No manual-search releases were returned by Arr',
        autoRetrying: false,
        progress: null,
        queueStatus: 'Search failed',
        preferences: {
          preferredLanguage: 'English',
          subtitleLanguage: 'English',
        },
        targetSeasonNumbers: null,
        targetEpisodeIds: null,
        startedAt: '2026-05-17T14:30:00.000Z',
        updatedAt: '2026-05-17T14:40:11.310Z',
        completedAt: '2026-05-17T14:40:11.310Z',
        attempts: [],
        releaseCandidates: [
          {
            arrRejected: true,
            attempt: null,
            detectedAudioLanguages: [],
            detectedSubtitleLanguages: [],
            failedAt: null,
            failureReason: null,
            firstSeenAt: '2026-05-17T14:40:11.310Z',
            guid: 'guid-lunopolis',
            indexer: 'Indexer',
            indexerId: 4,
            languages: ['English'],
            lastSeenAt: '2026-05-17T14:40:11.310Z',
            protocol: 'usenet',
            reason: 'Arr rejected this release.',
            score: -10_000,
            selectionMode: 'override-arr-rejection',
            size: 700_000_000,
            status: 'available',
            title: 'Lunopolis.2009.480p.WEB-DL.x264-mSD-ORHk',
          },
        ],
      },
      {
        id: 'job-obsession',
        itemId: 'movie:956',
        arrItemId: 956,
        kind: 'movie',
        title: 'Obsession',
        sourceService: 'radarr',
        status: 'failed',
        attempt: 1,
        maxRetries: 4,
        currentRelease: null,
        selectedReleaser: null,
        preferredReleaser: null,
        reasonCode: 'no-release-available',
        failureReason: 'No manual-search releases were returned by Arr',
        validationSummary: 'No manual-search releases were returned by Arr',
        autoRetrying: false,
        progress: null,
        queueStatus: 'Search failed',
        preferences: {
          preferredLanguage: 'English',
          subtitleLanguage: 'English',
        },
        targetSeasonNumbers: null,
        targetEpisodeIds: null,
        startedAt: '2026-05-17T14:20:00.000Z',
        updatedAt: '2026-05-17T14:30:00.000Z',
        completedAt: '2026-05-17T14:30:00.000Z',
        attempts: [],
        releaseCandidates: [
          {
            arrRejected: true,
            attempt: null,
            detectedAudioLanguages: [],
            detectedSubtitleLanguages: [],
            failedAt: null,
            failureReason: null,
            firstSeenAt: '2026-05-17T14:30:00.000Z',
            guid: 'guid-obsession',
            indexer: 'Indexer',
            indexerId: 4,
            languages: ['English'],
            lastSeenAt: '2026-05-17T14:30:00.000Z',
            protocol: 'usenet',
            reason: 'Release title points to WhatsApp Obsession',
            score: -10_000,
            selectionMode: 'override-arr-rejection',
            size: 700_000_000,
            status: 'available',
            title: 'WhatsApp.Obsession.The.Murder.Of.Stephanie.Hansen.2026.1080p.WEB.H264-CBFM',
            identityStatus: 'mismatch',
          } as NonNullable<AcquisitionJob['releaseCandidates']>[number] & {
            identityStatus: 'mismatch';
          },
        ],
      },
    ];

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch: vi.fn().mockResolvedValue({ records: [] }),
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
      fetchExistingMovie: vi.fn().mockImplementation((arrItemId: number) => {
        const title = arrItemId === 956 ? 'Obsession' : 'Lunopolis';
        return Promise.resolve({
          id: `movie:${arrItemId}`,
          arrItemId,
          kind: 'movie',
          title,
          year: arrItemId === 956 ? 2019 : 2010,
          rating: null,
          poster: null,
          overview: '',
          status: 'Monitored',
          isExisting: true,
          isRequested: true,
          auditStatus: 'unknown',
          audioLanguages: [],
          subtitleLanguages: [],
          sourceService: 'radarr',
          origin: 'arr',
          inArr: true,
          inPlex: false,
          plexLibraries: [],
          canAdd: false,
          canDeleteFromArr: true,
          detail: null,
          acquiredAt: null,
          requestPayload: {
            title,
          },
        } satisfies MediaItem);
      }),
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

    const lunopolis = dashboard.items.find((item) => item.title === 'Lunopolis');
    const obsession = dashboard.items.find((item) => item.title === 'Obsession');

    expect(lunopolis).toMatchObject({
      auditStatus: 'release-blocked',
      detail: '1 release option need manual review.',
      title: 'Lunopolis',
    });
    expect(obsession).toMatchObject({
      auditStatus: 'not-found',
      detail: 'No manual-search releases were returned by Arr',
      title: 'Obsession',
    });
    expect(dashboard.summary).toMatchObject({
      attention: 2,
    });
  });

  it('keeps dashboard queue card ids stable when Arr later adds a queue id', async () => {
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/history') {
        return {
          records: [],
        };
      }

      if (path === '/api/v3/queue') {
        return {
          records: [
            {
              id: 359204595,
              downloadId: 'radarr-download-7',
              movieId: 793,
              title: 'American.Rickshaw.1989.1080p.BluRay.x265',
              status: 'downloading',
              movie: {
                id: 793,
                title: 'American Rickshaw',
                year: 1989,
              },
            },
          ],
        };
      }

      return { records: [] };
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
      fetchExistingMovie: vi.fn(),
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
      id: 'movie:queue:radarr:download:radarr-download-7:radarr-793-american-rickshaw-1989-1080p-bluray-x265-noscope',
      title: 'American Rickshaw',
      inArr: true,
    });
  });

  it('merges matching recent Plex items onto dashboard cards', async () => {
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/history') {
        return {
          records: [
            {
              movieId: 933,
              sourceTitle: 'Fixture.Secret.2000.1080p.AMZN.WEB-DL.DDP2.0.H.264-TEPES',
              movie: {
                id: 933,
                title: 'Fixture Secret',
                year: 2000,
              },
            },
          ],
        };
      }

      if (path === '/api/v3/queue') {
        return { records: [] };
      }

      return { records: [] };
    });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: true,
        radarrConfigured: true,
        sonarrConfigured: false,
      }),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn().mockResolvedValue({
        id: 'movie:933',
        arrItemId: 933,
        kind: 'movie',
        title: 'Fixture Secret',
        year: 2000,
        rating: 6.2,
        poster: null,
        overview: '',
        status: 'Downloaded',
        isExisting: true,
        isRequested: true,
        auditStatus: 'verified',
        audioLanguages: ['eng'],
        subtitleLanguages: ['eng'],
        sourceService: 'radarr',
        origin: 'arr',
        inArr: true,
        inPlex: false,
        plexLibraries: [],
        canAdd: false,
        canDeleteFromArr: true,
        detail: null,
        requestPayload: {
          title: 'Fixture Secret',
          year: 2000,
          imdbId: 'tt0240894',
          tmdbId: 299024,
        },
      }),
      fetchExistingSeries: vi.fn(),
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      getRecentPlexItems: vi.fn().mockResolvedValue([
        {
          id: 'plex:movie:123861',
          arrItemId: null,
          kind: 'movie',
          title: 'Fixture Secret',
          year: 2000,
          rating: 6.3,
          poster: null,
          overview: '',
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
          canDeleteFromArr: false,
          detail: null,
          requestPayload: {
            title: 'Fixture Secret',
            year: 2000,
          },
        },
      ]),
      searchPlex: vi.fn().mockResolvedValue([]),
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
      title: 'Fixture Secret',
      inArr: true,
      inPlex: true,
      origin: 'merged',
      plexLibraries: ['Movies'],
    });
  });

  it('does not emit an Untitled dashboard queue card when a sparse Arr queue row matches a tracked movie', async () => {
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/history') {
        return {
          records: [
            {
              movieId: 727,
              sourceTitle: 'Fixture.Queue.2025.UHD.BluRay.2160p.DD.5.1.DV.HDR10Plus.x265-BHDStudio',
              movie: {
                id: 727,
                title: 'Fixture Queue',
                year: 2025,
              },
            },
          ],
        };
      }

      if (path === '/api/v3/queue') {
        return {
          records: [
            {
              id: 1996958567,
              movieId: 727,
              title: 'Fixture.Queue.2025.1080p.WEB.H264-KBOX',
              status: 'completed',
              trackedDownloadStatus: 'warning',
              trackedDownloadState: 'importPending',
            },
          ],
        };
      }

      return { records: [] };
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
      fetchExistingMovie: vi.fn().mockResolvedValue({
        id: 'movie:727',
        arrItemId: 727,
        kind: 'movie',
        title: 'Fixture Queue',
        year: 2025,
        rating: 6.4,
        poster: null,
        overview: '',
        status: 'Downloaded',
        isExisting: true,
        isRequested: true,
        auditStatus: 'verified',
        audioLanguages: ['eng'],
        subtitleLanguages: [],
        sourceService: 'radarr',
        origin: 'arr',
        inArr: true,
        inPlex: false,
        plexLibraries: [],
        canAdd: false,
        canDeleteFromArr: true,
        detail: null,
        requestPayload: {
          title: 'Fixture Queue',
          year: 2025,
          imdbId: 'tt32299316',
          tmdbId: 1285965,
        },
      }),
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

    expect(dashboard.items).toHaveLength(1);
    expect(dashboard.items[0]).toMatchObject({
      arrItemId: 727,
      id: 'movie:727',
      title: 'Fixture Queue',
    });
  });

  it('merges Plex search matches onto dashboard cards when the library item is not recent', async () => {
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/history') {
        return {
          records: [
            {
              movieId: 727,
              sourceTitle: 'Fixture.Queue.2025.UHD.BluRay.2160p.DD.5.1.DV.HDR10Plus.x265-BHDStudio',
              movie: {
                id: 727,
                title: 'Fixture Queue',
                year: 2025,
              },
            },
          ],
        };
      }

      if (path === '/api/v3/queue') {
        return { records: [] };
      }

      return { records: [] };
    });

    vi.doMock('$lib/server/arr-client', () => ({
      arrFetch,
    }));
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: true,
        radarrConfigured: true,
        sonarrConfigured: false,
      }),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn().mockResolvedValue({
        id: 'movie:727',
        arrItemId: 727,
        kind: 'movie',
        title: 'Fixture Queue',
        year: 2025,
        rating: 6.4,
        poster: null,
        overview: '',
        status: 'Downloaded',
        isExisting: true,
        isRequested: true,
        auditStatus: 'verified',
        audioLanguages: ['eng'],
        subtitleLanguages: [],
        sourceService: 'radarr',
        origin: 'arr',
        inArr: true,
        inPlex: false,
        plexLibraries: [],
        canAdd: false,
        canDeleteFromArr: true,
        detail: null,
        requestPayload: {
          title: 'Fixture Queue',
          year: 2025,
          imdbId: 'tt32299316',
          tmdbId: 1285965,
        },
      }),
      fetchExistingSeries: vi.fn(),
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      getRecentPlexItems: vi.fn().mockResolvedValue([]),
      searchPlex: vi.fn().mockResolvedValue([
        {
          id: 'plex:movie:727',
          arrItemId: null,
          kind: 'movie',
          title: 'Fixture Queue',
          year: 2025,
          rating: 6.4,
          poster: null,
          overview: '',
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
          canDeleteFromArr: false,
          detail: null,
          requestPayload: {
            title: 'Fixture Queue',
            year: 2025,
            imdbId: 'tt32299316',
            tmdbId: 1285965,
          },
        },
      ]),
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
      title: 'Fixture Queue',
      inArr: true,
      inPlex: true,
      origin: 'merged',
      plexLibraries: ['Movies'],
    });
  });

  it('uses alternate titles when backfilling dashboard Plex state', async () => {
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/history') {
        return {
          records: [
            {
              movieId: 727,
              sourceTitle: 'Fixture.Queue.2025.UHD.BluRay.2160p.DD.5.1.DV.HDR10Plus.x265-BHDStudio',
              movie: {
                id: 727,
                title: 'Fixture Queue',
                year: 2025,
              },
            },
          ],
        };
      }

      if (path === '/api/v3/queue') {
        return { records: [] };
      }

      return { records: [] };
    });

    const searchPlex = vi.fn().mockImplementation(async (term: string) => {
      if (term === 'Animales Peligrosos') {
        return [
          {
            id: 'plex:movie:727',
            arrItemId: null,
            kind: 'movie',
            title: 'Fixture Queue',
            year: 2025,
            rating: 6.4,
            poster: null,
            overview: '',
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
            canDeleteFromArr: false,
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
    vi.doMock('$lib/server/runtime', () => ({
      getConfiguredServiceFlags: () => ({
        configured: true,
        plexConfigured: true,
        radarrConfigured: true,
        sonarrConfigured: false,
      }),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn().mockResolvedValue({
        id: 'movie:727',
        arrItemId: 727,
        kind: 'movie',
        title: 'Fixture Queue',
        year: 2025,
        rating: 6.4,
        poster: null,
        overview: '',
        status: 'Downloaded',
        isExisting: true,
        isRequested: true,
        auditStatus: 'verified',
        audioLanguages: ['eng'],
        subtitleLanguages: [],
        sourceService: 'radarr',
        origin: 'arr',
        inArr: true,
        inPlex: false,
        plexLibraries: [],
        canAdd: false,
        canDeleteFromArr: true,
        detail: null,
        requestPayload: {
          title: 'Fixture Queue',
          year: 2025,
          imdbId: 'tt32299316',
          tmdbId: 1285965,
          alternateTitles: [{ title: 'Animales Peligrosos' }],
        },
      }),
      fetchExistingSeries: vi.fn(),
    }));
    vi.doMock('$lib/server/plex-service', () => ({
      getRecentPlexItems: vi.fn().mockResolvedValue([]),
      searchPlex,
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

    expect(searchPlex).toHaveBeenCalledWith('Fixture Queue', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Animales Peligrosos', 'movie');
    expect(dashboard.items[0]).toMatchObject({
      title: 'Fixture Queue',
      inArr: true,
      inPlex: true,
      origin: 'merged',
      plexLibraries: ['Movies ITA'],
    });
  });
});
