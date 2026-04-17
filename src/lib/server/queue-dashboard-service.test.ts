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

  it('keeps unmatched Arr downloads as external entries after managed matches are consumed', async () => {
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
      id: 'radarr:queue:2',
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

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: 'managed',
      liveQueueItems: [matchingQueueItem],
      liveSummary: {
        rowCount: 1,
        progress: 58,
      },
    });
    expect(entries[1]).toEqual({
      kind: 'external',
      id: externalQueueItem.id,
      item: externalQueueItem,
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

  it('keeps unrelated queue rows on the same series external when episode scope does not overlap', async () => {
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
      id: 'sonarr:queue:2',
      queueId: 3,
      detail: 'Andor.S01E03.1080p.WEB-DL-FLUX',
      episodeIds: [103],
    };

    const entries = composeQueueEntries([acquisitionJob], [matchingQueueItem, unrelatedQueueItem]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: 'managed',
      liveQueueItems: [matchingQueueItem],
    });
    expect(entries[1]).toEqual({
      kind: 'external',
      id: unrelatedQueueItem.id,
      item: unrelatedQueueItem,
      canCancel: true,
      canRemove: false,
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
