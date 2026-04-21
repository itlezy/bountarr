import { describe, expect, it } from 'vitest';
import { queueItemMatchesManagedTarget } from '$lib/server/queue-matching';
import type { QueueItem } from '$lib/shared/types';

describe('queue matching', () => {
  it('keeps movie ownership pinned to the persisted live queue row once it is known', () => {
    const target = {
      arrItemId: 603,
      currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      kind: 'movie' as const,
      liveDownloadId: 'radarr-download-2',
      liveQueueId: 22,
      sourceService: 'radarr' as const,
      targetEpisodeIds: null,
      targetSeasonNumbers: null,
    };
    const claimedItem: QueueItem = {
      id: 'radarr:queue:22',
      downloadId: 'radarr-download-2',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 61,
      timeLeft: '8m',
      estimatedCompletionTime: '2026-04-13T12:08:00.000Z',
      size: 3_400_000_000,
      sizeLeft: 1_326_000_000,
      queueId: 22,
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };
    const siblingItem: QueueItem = {
      ...claimedItem,
      id: 'radarr:queue:21',
      downloadId: 'radarr-download-1',
      queueId: 21,
      detail: 'The.Matrix.1999.1080p.BluRay-OLD',
    };

    expect(queueItemMatchesManagedTarget(target, claimedItem)).toBe(true);
    expect(queueItemMatchesManagedTarget(target, siblingItem)).toBe(false);
  });

  it('does not fall back to movie release text once live queue identity is known', () => {
    const target = {
      arrItemId: 603,
      currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      kind: 'movie' as const,
      liveDownloadId: 'radarr-download-2',
      liveQueueId: 22,
      sourceService: 'radarr' as const,
      targetEpisodeIds: null,
      targetSeasonNumbers: null,
    };
    const sameReleaseDifferentDownload: QueueItem = {
      id: 'radarr:queue:23',
      downloadId: 'radarr-download-3',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 42,
      timeLeft: '12m',
      estimatedCompletionTime: '2026-04-13T12:12:00.000Z',
      size: 3_400_000_000,
      sizeLeft: 1_972_000_000,
      queueId: 23,
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };

    expect(queueItemMatchesManagedTarget(target, sameReleaseDifferentDownload)).toBe(false);
  });

  it('does not match sibling movie rows before identity is known unless the release text matches', () => {
    const target = {
      arrItemId: 603,
      currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      kind: 'movie' as const,
      sourceService: 'radarr' as const,
      targetEpisodeIds: null,
      targetSeasonNumbers: null,
    };
    const matchingItem: QueueItem = {
      id: 'radarr:queue:22',
      downloadId: 'radarr-download-2',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 61,
      timeLeft: '8m',
      estimatedCompletionTime: '2026-04-13T12:08:00.000Z',
      size: 3_400_000_000,
      sizeLeft: 1_326_000_000,
      queueId: 22,
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };
    const siblingItem: QueueItem = {
      ...matchingItem,
      id: 'radarr:queue:21',
      downloadId: 'radarr-download-1',
      queueId: 21,
      detail: 'The.Matrix.1999.1080p.BluRay-OLD',
    };

    expect(queueItemMatchesManagedTarget(target, matchingItem)).toBe(true);
    expect(queueItemMatchesManagedTarget(target, siblingItem)).toBe(false);
  });

  it('does not match scope-less series rows when the release text is only a partial title match', () => {
    const target = {
      arrItemId: 83867,
      currentRelease: 'Andor.Release.Alpha.2026',
      kind: 'series' as const,
      sourceService: 'sonarr' as const,
      targetEpisodeIds: [101],
      targetSeasonNumbers: [1],
    };
    const item: QueueItem = {
      id: 'sonarr:queue:14',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Andor',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 41,
      timeLeft: '14m',
      estimatedCompletionTime: '2026-04-13T12:14:00.000Z',
      size: 2_400_000_000,
      sizeLeft: 1_416_000_000,
      queueId: 14,
      detail: 'Andor.Release.Alpha',
      episodeIds: null,
      seasonNumbers: null,
    };

    expect(queueItemMatchesManagedTarget(target, item)).toBe(false);
  });

  it('matches scope-less series rows only when the release text is exact', () => {
    const target = {
      arrItemId: 83867,
      currentRelease: 'Andor.Release.Alpha.2026',
      kind: 'series' as const,
      sourceService: 'sonarr' as const,
      targetEpisodeIds: [101],
      targetSeasonNumbers: [1],
    };
    const item: QueueItem = {
      id: 'sonarr:queue:15',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Andor',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 61,
      timeLeft: '8m',
      estimatedCompletionTime: '2026-04-13T12:08:00.000Z',
      size: 3_400_000_000,
      sizeLeft: 1_326_000_000,
      queueId: 15,
      detail: 'Andor.Release.Alpha.2026',
      episodeIds: null,
      seasonNumbers: null,
    };

    expect(queueItemMatchesManagedTarget(target, item)).toBe(true);
  });

  it('does not match same-scope series rows before identity is known unless the release family matches', () => {
    const target = {
      arrItemId: 83867,
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
      kind: 'series' as const,
      sourceService: 'sonarr' as const,
      targetEpisodeIds: [101, 102],
      targetSeasonNumbers: [1],
    };
    const matchingEpisodeRow: QueueItem = {
      id: 'sonarr:queue:15',
      downloadId: 'sonarr-download-1',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Andor',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 61,
      timeLeft: '8m',
      estimatedCompletionTime: '2026-04-13T12:08:00.000Z',
      size: 3_400_000_000,
      sizeLeft: 1_326_000_000,
      queueId: 15,
      detail: 'Andor.S01E01.1080p.WEB-DL-FLUX',
      episodeIds: [101],
      seasonNumbers: [1],
    };
    const staleSiblingRow: QueueItem = {
      ...matchingEpisodeRow,
      id: 'sonarr:queue:16',
      downloadId: 'sonarr-download-old',
      queueId: 16,
      detail: 'Andor.S01E01.1080p.WEB-DL-OLD',
    };

    expect(queueItemMatchesManagedTarget(target, matchingEpisodeRow)).toBe(true);
    expect(queueItemMatchesManagedTarget(target, staleSiblingRow)).toBe(false);
  });

  it('does not match same-scope series rows before identity is known when no current release has been chosen', () => {
    const target = {
      arrItemId: 83867,
      currentRelease: null,
      kind: 'series' as const,
      sourceService: 'sonarr' as const,
      targetEpisodeIds: [101, 102],
      targetSeasonNumbers: [1],
    };
    const item: QueueItem = {
      id: 'sonarr:queue:18',
      downloadId: 'sonarr-download-1',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Andor',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 61,
      timeLeft: '8m',
      estimatedCompletionTime: '2026-04-13T12:08:00.000Z',
      size: 3_400_000_000,
      sizeLeft: 1_326_000_000,
      queueId: 18,
      detail: 'Andor.S01E01.1080p.WEB-DL-FLUX',
      episodeIds: [101],
      seasonNumbers: [1],
    };

    expect(queueItemMatchesManagedTarget(target, item)).toBe(false);
  });

  it('still matches same-download sibling Sonarr queue rows after one live row has been claimed', () => {
    const target = {
      arrItemId: 83867,
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
      kind: 'series' as const,
      liveDownloadId: 'sonarr-download-shared',
      liveQueueId: 15,
      sourceService: 'sonarr' as const,
      targetEpisodeIds: [101, 102],
      targetSeasonNumbers: [1],
    };
    const siblingItem: QueueItem = {
      id: 'sonarr:queue:16',
      downloadId: 'sonarr-download-shared',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Andor',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 61,
      timeLeft: '8m',
      estimatedCompletionTime: '2026-04-13T12:08:00.000Z',
      size: 3_400_000_000,
      sizeLeft: 1_326_000_000,
      queueId: 16,
      detail: 'Andor.S01E02.1080p.WEB-DL-FLUX',
      episodeIds: [102],
      seasonNumbers: [1],
    };

    expect(queueItemMatchesManagedTarget(target, siblingItem)).toBe(true);
  });

  it('does not match same-scope Sonarr sibling rows after one live row has been claimed when the identity differs', () => {
    const target = {
      arrItemId: 83867,
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
      kind: 'series' as const,
      liveDownloadId: 'sonarr-download-shared',
      liveQueueId: 15,
      sourceService: 'sonarr' as const,
      targetEpisodeIds: [101, 102],
      targetSeasonNumbers: [1],
    };
    const staleSiblingItem: QueueItem = {
      id: 'sonarr:queue:17',
      downloadId: 'sonarr-download-old',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Andor',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 61,
      timeLeft: '8m',
      estimatedCompletionTime: '2026-04-13T12:08:00.000Z',
      size: 3_400_000_000,
      sizeLeft: 1_326_000_000,
      queueId: 17,
      detail: 'Andor.S01E02.1080p.WEB-DL-OLD',
      episodeIds: [102],
      seasonNumbers: [1],
    };

    expect(queueItemMatchesManagedTarget(target, staleSiblingItem)).toBe(false);
  });

  it('does not fall back to scope-less series release text once live queue identity is known', () => {
    const target = {
      arrItemId: 83867,
      currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
      kind: 'series' as const,
      liveDownloadId: 'sonarr-download-shared',
      liveQueueId: 15,
      sourceService: 'sonarr' as const,
      targetEpisodeIds: [101, 102],
      targetSeasonNumbers: [1],
    };
    const sameReleaseDifferentDownload: QueueItem = {
      id: 'sonarr:queue:19',
      downloadId: 'sonarr-download-other',
      arrItemId: 83867,
      canCancel: true,
      kind: 'series',
      title: 'Andor',
      year: 2022,
      poster: null,
      sourceService: 'sonarr',
      status: 'Downloading',
      progress: 38,
      timeLeft: '22m',
      estimatedCompletionTime: '2026-04-13T12:22:00.000Z',
      size: 3_400_000_000,
      sizeLeft: 2_108_000_000,
      queueId: 19,
      detail: 'Andor.S01.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };

    expect(queueItemMatchesManagedTarget(target, sameReleaseDifferentDownload)).toBe(false);
  });
});
