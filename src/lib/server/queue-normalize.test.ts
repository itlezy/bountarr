import { describe, expect, it } from 'vitest';
import { normalizeQueueItem } from '$lib/server/queue-normalize';

describe('normalizeQueueItem', () => {
  it('computes progress and detail from Arr queue payloads', () => {
    const item = normalizeQueueItem('sonarr', {
      id: 22,
      downloadId: 'sonarr-download-shared',
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
      downloadId: 'sonarr-download-shared',
      id: 'sonarr:queue:22',
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

  it('falls back to download id when the Arr queue row id is missing', () => {
    const item = normalizeQueueItem('radarr', {
      downloadId: 'radarr-download-7',
      movieId: 793,
      title: 'American.Rickshaw.1989.1080p.BluRay.x265',
      status: 'downloading',
      trackedDownloadStatus: 'ok',
      trackedDownloadState: 'downloading',
    });

    expect(item).toMatchObject({
      id: 'radarr:download:radarr-download-7',
      downloadId: 'radarr-download-7',
      canCancel: false,
      queueId: null,
    });
  });

  it('keeps Radarr queue items when the nested movie payload is missing', () => {
    const item = normalizeQueueItem('radarr', {
      id: 359204595,
      movieId: 793,
      title: 'American.Rickshaw.1989.1080p.BluRay.x265',
      status: 'downloading',
      trackedDownloadStatus: 'ok',
      trackedDownloadState: 'downloading',
      size: 1_776_895_918,
      sizeLeft: 808_168_980,
      timeLeft: '00:04:06',
      estimatedCompletionTime: '2026-04-13T14:21:27Z',
    });

    expect(item).toMatchObject({
      kind: 'movie',
      arrItemId: 793,
      title: 'American.Rickshaw.1989.1080p.BluRay.x265',
      status: 'Downloading',
      progress: expect.any(Number),
      timeLeft: '00:04:06',
      estimatedCompletionTime: '2026-04-13T14:21:27Z',
      detail: null,
    });
    expect(item?.progress).toBeCloseTo(54.52, 1);
  });

  it('preserves Arr warning detail from queue status messages', () => {
    const item = normalizeQueueItem('radarr', {
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
    });

    expect(item).toMatchObject({
      status: 'Completed',
      statusDetail:
        'Import pending: Not an upgrade for existing movie file. Existing quality: Bluray-2160p.',
      detail: null,
    });
  });

  it('omits redundant release-name prefixes from Arr warning detail', () => {
    const item = normalizeQueueItem('radarr', {
      id: 1996958567,
      movieId: 727,
      title: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
      status: 'completed',
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importPending',
      statusMessages: [
        {
          title: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
          messages: ['Not an upgrade for existing movie file. Existing quality: Bluray-2160p.'],
        },
      ],
    });

    expect(item?.statusDetail).toBe(
      'Not an upgrade for existing movie file. Existing quality: Bluray-2160p.',
    );
  });
});
