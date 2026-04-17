import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';

const seriesJob: PersistedAcquisitionJob = {
  id: 'job-series-1',
  itemId: 'series:701',
  arrItemId: 701,
  kind: 'series',
  title: 'Andor',
  sourceService: 'sonarr',
  status: 'validating',
  attempt: 1,
  maxRetries: 4,
  currentRelease: 'Andor.S01.1080p.WEB-DL-FLUX',
  selectedReleaser: 'flux',
  preferredReleaser: 'flux',
  reasonCode: null,
  failureReason: null,
  validationSummary: null,
  autoRetrying: false,
  progress: 10,
  queueStatus: 'Downloading',
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'English',
  },
  targetSeasonNumbers: [1],
  targetEpisodeIds: [101, 102],
  startedAt: '2026-04-13T12:00:00.000Z',
  updatedAt: '2026-04-13T12:00:00.000Z',
  completedAt: null,
  attempts: [],
  failedGuids: [],
};

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('validateSeriesAttempt', () => {
  it('keeps a targeted series job pending until every targeted episode imports', async () => {
    const fetchEpisodeFile = vi.fn();

    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchHistoryRecords: vi.fn().mockResolvedValue([
        {
          date: '2026-04-13T12:05:00.000Z',
          episodeFileId: 5001,
          sourceTitle: 'Andor.S01E01.1080p.WEB-DL-FLUX',
        },
      ]),
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 7,
          seriesId: 701,
          status: 'Downloading',
          trackedDownloadStatus: 'downloading',
          size: 1000,
          sizeleft: 750,
          title: 'Andor',
        },
        {
          id: 8,
          seriesId: 701,
          status: 'Downloading',
          trackedDownloadStatus: 'downloading',
          size: 1000,
          sizeleft: 250,
          title: 'Andor',
        },
      ]),
      findQueueRecordsForArrItem: vi.fn().mockImplementation((records: Array<Record<string, unknown>>, _service: string, arrItemId: number) =>
        records.filter((record) => record.seriesId === arrItemId),
      ),
      historySince: vi.fn().mockImplementation((records: Array<Record<string, unknown>>) => records),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchEpisodeFile,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue([
        { episodeFileId: 5001, id: 101, seasonNumber: 1 },
        { episodeFileId: 5002, id: 102, seasonNumber: 1 },
        { episodeFileId: 6001, id: 201, seasonNumber: 2 },
      ]),
    }));

    const module = await import('$lib/server/acquisition-series-validator');
    const result = await module.validateSeriesAttempt(
      seriesJob,
      '2026-04-13T12:00:00.000Z',
    );

    expect(result).toEqual({
      outcome: 'pending',
      preferredReleaser: null,
      progress: 50,
      queueStatus: 'Downloading',
      reasonCode: null,
      summary: 'Imported 1 of 2 targeted episodes',
    });
    expect(fetchEpisodeFile).not.toHaveBeenCalled();
  });

  it('validates only the targeted imported episodes for a series job', async () => {
    const fetchEpisodeFile = vi
      .fn()
      .mockImplementation(async (episodeFileId: number) => {
        if (episodeFileId === 5001 || episodeFileId === 5002) {
          return {
            mediaInfo: {
              audioLanguages: ['English'],
              subtitles: ['English'],
            },
          };
        }

        return {
          mediaInfo: {
            audioLanguages: ['French'],
            subtitles: [],
          },
        };
      });

    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchHistoryRecords: vi.fn().mockResolvedValue([
        {
          date: '2026-04-13T12:05:00.000Z',
          episodeFileId: 5001,
          sourceTitle: 'Andor.S01E01.1080p.WEB-DL-FLUX',
        },
        {
          date: '2026-04-13T12:06:00.000Z',
          episodeFileId: 5002,
          sourceTitle: 'Andor.S01E02.1080p.WEB-DL-FLUX',
        },
        {
          date: '2026-04-13T12:07:00.000Z',
          episodeFileId: 6001,
          sourceTitle: 'Andor.S02E01.1080p.WEB-DL-FLUX',
        },
      ]),
      fetchQueueRecords: vi.fn().mockResolvedValue([]),
      findQueueRecordsForArrItem: vi.fn().mockReturnValue([]),
      historySince: vi.fn().mockImplementation((records: Array<Record<string, unknown>>) => records),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchEpisodeFile,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue([
        { episodeFileId: 5001, id: 101, seasonNumber: 1 },
        { episodeFileId: 5002, id: 102, seasonNumber: 1 },
        { episodeFileId: 6001, id: 201, seasonNumber: 2 },
      ]),
    }));

    const module = await import('$lib/server/acquisition-series-validator');
    const result = await module.validateSeriesAttempt(
      seriesJob,
      '2026-04-13T12:00:00.000Z',
    );

    expect(result).toEqual({
      outcome: 'success',
      preferredReleaser: 'flux',
      progress: 100,
      queueStatus: 'Imported',
      reasonCode: 'validated',
      summary: 'Validated 2 targeted episodes',
    });
    expect(fetchEpisodeFile).toHaveBeenCalledTimes(2);
    expect(fetchEpisodeFile).toHaveBeenNthCalledWith(1, 5001);
    expect(fetchEpisodeFile).toHaveBeenNthCalledWith(2, 5002);
  });
});
