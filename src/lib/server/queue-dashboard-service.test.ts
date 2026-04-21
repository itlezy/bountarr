import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AcquisitionJob, QueueItem } from '$lib/shared/types';

afterEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
});

describe('queue dashboard service', () => {
  it('merges matching acquisition jobs and Arr queue items into one managed entry', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-1',
      itemId: 'movie:603',
      arrItemId: 603,
      kind: 'movie',
      title: 'The Matrix',
      sourceService: 'radarr',
      status: 'validating',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      title: 'The Matrix',
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
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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

  it('keeps stale sibling movie queue rows external after the current re-grab row is claimed', async () => {
    const { composeQueueEntries } = await import('$lib/server/queue-dashboard-service');

    const acquisitionJob: AcquisitionJob = {
      id: 'job-movie-reregrab',
      itemId: 'movie:603',
      arrItemId: 603,
      kind: 'movie',
      title: 'The Matrix',
      sourceService: 'radarr',
      status: 'validating',
      attempt: 2,
      maxRetries: 4,
      currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      title: 'The Matrix',
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
      detail: 'The.Matrix.1999.1080p.BluRay-OLD',
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
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      title: 'The Matrix',
      sourceService: 'radarr',
      status: 'validating',
      attempt: 1,
      maxRetries: 4,
      currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      title: 'The.Matrix.1999.1080p.BluRay-OLD',
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
      title: 'Dangerous Animals',
      sourceService: 'radarr',
      status: 'failed',
      attempt: 2,
      maxRetries: 4,
      currentRelease: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
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
      title: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
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
      detail: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
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
          title: 'Dangerous Animals',
          detail: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
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
      title: 'The Matrix',
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
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      title: 'The Matrix',
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
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      title: 'The Matrix',
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
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      title: 'The Matrix',
      sourceService: 'radarr',
      status: 'grabbing',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      title: 'The Matrix',
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
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      title: 'The Matrix',
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
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      id: 'sonarr:download:download-shared:sonarr-83867-andor-s01e01-1080p-web-dl-flux-episodes-101',
      downloadId: 'download-shared',
      arrItemId: 83867,
      canCancel: false,
      kind: 'series',
      title: 'Andor',
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
      detail: 'Andor.S01E01.1080p.WEB-DL-FLUX',
      episodeIds: [101],
      seasonNumbers: [1],
    };
    const secondQueueItem: QueueItem = {
      ...firstQueueItem,
      id: 'sonarr:download:download-shared:sonarr-83867-andor-s01e02-1080p-web-dl-flux-episodes-102',
      detail: 'Andor.S01E02.1080p.WEB-DL-FLUX',
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
      title: 'The Matrix',
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
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
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
      title: 'Andor',
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
      detail: 'Andor.S01.1080p.WEB-DL-FLUX',
      episodeIds: [101, 102],
      seasonNumbers: [1],
    };
    const externalQueueItem: QueueItem = {
      id: 'radarr:queue:1',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'The Matrix',
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
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 2,
      maxRetries: 3,
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
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
      detail: 'Andor.S01E01.1080p.WEB-DL-FLUX',
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
      detail: 'Andor.S01E02.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 2,
      maxRetries: 3,
      currentRelease: 'Andor.S01E01.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
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
      detail: 'Andor.S01E01.1080p.WEB-DL-FLUX',
      episodeIds: [101],
      seasonNumbers: [1],
    };
    const unrelatedQueueItem: QueueItem = {
      ...matchingQueueItem,
      id: 'sonarr:queue:3',
      queueId: 3,
      detail: 'Andor.S01E03.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
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
      detail: 'Andor.S01.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: [1],
    };
    const unrelatedSeasonQueueItem: QueueItem = {
      ...seasonPackQueueItem,
      id: 'sonarr:queue:12',
      queueId: 12,
      detail: 'Andor.S02.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
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
      detail: 'Andor.S01-S02.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
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
      title: 'Andor.Release.Old',
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
      detail: 'Andor.S01E01.1080p.WEB-DL-OLD',
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
      title: 'Andor',
      sourceService: 'sonarr',
      status: 'grabbing',
      attempt: 1,
      maxRetries: 3,
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
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
      detail: 'Andor.S01E01.1080p.WEB-DL-FLUX',
      episodeIds: [101],
      seasonNumbers: [1],
    };
    const siblingQueueItem: QueueItem = {
      ...matchingQueueItem,
      id: 'sonarr:queue:22',
      queueId: 22,
      detail: 'Andor.S01E02.1080p.WEB-DL-FLUX',
      episodeIds: [102],
    };
    const unrelatedQueueItem: QueueItem = {
      ...matchingQueueItem,
      id: 'sonarr:queue:23',
      queueId: 23,
      detail: 'Andor.S02E01.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
      sourceService: 'sonarr',
      status: 'validating',
      attempt: 2,
      maxRetries: 3,
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
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
      title: 'Andor',
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
      detail: 'Andor.S01E01.1080p.WEB-DL-FLUX',
      episodeIds: [101],
      seasonNumbers: [1],
    };
    const staleSiblingQueueItem: QueueItem = {
      ...matchingQueueItem,
      id: 'sonarr:queue:22',
      downloadId: 'download-old',
      queueId: 22,
      detail: 'Andor.S01E02.1080p.WEB-DL-OLD',
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
              sourceTitle: 'Sharing.the.Secret.2000.1080p.AMZN.WEB-DL.DDP2.0.H.264-TEPES',
              movie: {
                id: 933,
                title: 'Sharing the Secret',
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
        title: 'Sharing the Secret',
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
          title: 'Sharing the Secret',
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
          title: 'Sharing the Secret',
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
            title: 'Sharing the Secret',
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
      title: 'Sharing the Secret',
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
              sourceTitle:
                'Dangerous.Animals.2025.UHD.BluRay.2160p.DD.5.1.DV.HDR10Plus.x265-BHDStudio',
              movie: {
                id: 727,
                title: 'Dangerous Animals',
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
              title: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
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
        title: 'Dangerous Animals',
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
          title: 'Dangerous Animals',
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
      title: 'Dangerous Animals',
    });
  });

  it('merges Plex search matches onto dashboard cards when the library item is not recent', async () => {
    const arrFetch = vi.fn().mockImplementation(async (_service: string, path: string) => {
      if (path === '/api/v3/history') {
        return {
          records: [
            {
              movieId: 727,
              sourceTitle:
                'Dangerous.Animals.2025.UHD.BluRay.2160p.DD.5.1.DV.HDR10Plus.x265-BHDStudio',
              movie: {
                id: 727,
                title: 'Dangerous Animals',
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
        title: 'Dangerous Animals',
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
          title: 'Dangerous Animals',
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
          title: 'Dangerous Animals',
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
            title: 'Dangerous Animals',
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
      title: 'Dangerous Animals',
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
              sourceTitle:
                'Dangerous.Animals.2025.UHD.BluRay.2160p.DD.5.1.DV.HDR10Plus.x265-BHDStudio',
              movie: {
                id: 727,
                title: 'Dangerous Animals',
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
            title: 'Dangerous Animals',
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
        title: 'Dangerous Animals',
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
          title: 'Dangerous Animals',
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

    expect(searchPlex).toHaveBeenCalledWith('Dangerous Animals', 'movie');
    expect(searchPlex).toHaveBeenCalledWith('Animales Peligrosos', 'movie');
    expect(dashboard.items[0]).toMatchObject({
      title: 'Dangerous Animals',
      inArr: true,
      inPlex: true,
      origin: 'merged',
      plexLibraries: ['Movies ITA'],
    });
  });
});
