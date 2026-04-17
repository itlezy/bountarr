import { describe, expect, it } from 'vitest';
import { queueItemMatchesManagedTarget } from '$lib/server/queue-matching';
import type { QueueItem } from '$lib/shared/types';

describe('queue matching', () => {
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
});
