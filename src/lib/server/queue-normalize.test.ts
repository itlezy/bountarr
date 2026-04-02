import { describe, expect, it } from 'vitest';
import { normalizeQueueItem } from '$lib/server/queue-normalize';

describe('normalizeQueueItem', () => {
  it('computes progress and detail from Arr queue payloads', () => {
    const item = normalizeQueueItem('sonarr', {
      id: 22,
      title: 'Episode source title',
      status: 'downloading',
      size: 2_000,
      sizeleft: 500,
      timeleft: '10m',
      estimatedCompletionTime: '2026-04-02T12:00:00.000Z',
      series: {
        title: 'Andor',
        year: 2022,
        images: [{ coverType: 'poster', remoteUrl: 'https://img.example/andor.jpg' }],
      },
      episode: {
        title: 'One Way Out',
      },
    });

    expect(item).toMatchObject({
      kind: 'series',
      title: 'Andor',
      year: 2022,
      poster: 'https://img.example/andor.jpg',
      status: 'Downloading',
      progress: 75,
      timeLeft: '10m',
      detail: 'Episode source title',
    });
  });
});
