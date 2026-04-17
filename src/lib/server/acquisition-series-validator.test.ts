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
  completionEpisodeIds: [101, 102],
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'English',
  },
  queuedManualSelection: null,
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
          episode: {
            id: 101,
            seasonNumber: 1,
            title: 'Kassa',
          },
          seriesId: 701,
          trackedDownloadStatus: 'downloading',
          size: 1000,
          sizeleft: 750,
          title: 'Andor.S01E01.1080p.WEB-DL-FLUX',
          series: {
            id: 701,
            title: 'Andor',
            year: 2022,
          },
        },
        {
          id: 8,
          episode: {
            id: 102,
            seasonNumber: 1,
            title: 'That Would Be Me',
          },
          seriesId: 701,
          status: 'Downloading',
          trackedDownloadStatus: 'downloading',
          size: 1000,
          sizeleft: 250,
          title: 'Andor.S01E02.1080p.WEB-DL-FLUX',
          series: {
            id: 701,
            title: 'Andor',
            year: 2022,
          },
        },
        {
          id: 9,
          episode: {
            id: 201,
            seasonNumber: 2,
            title: 'One Year Later',
          },
          seriesId: 701,
          status: 'Downloading',
          trackedDownloadStatus: 'downloading',
          size: 1000,
          sizeleft: 100,
          title: 'Andor.S02E01.1080p.WEB-DL-FLUX',
          series: {
            id: 701,
            title: 'Andor',
            year: 2022,
          },
        },
      ]),
      historySince: vi.fn().mockImplementation((records: Array<Record<string, unknown>>) => records),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchEpisodeFile,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue([
        { airDateUtc: '2026-04-01T00:00:00.000Z', episodeFileId: 5001, id: 101, seasonNumber: 1 },
        { airDateUtc: '2026-04-08T00:00:00.000Z', episodeFileId: 5002, id: 102, seasonNumber: 1 },
        { airDateUtc: '2026-04-15T00:00:00.000Z', episodeFileId: 6001, id: 201, seasonNumber: 2 },
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
      historySince: vi.fn().mockImplementation((records: Array<Record<string, unknown>>) => records),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchEpisodeFile,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue([
        { airDateUtc: '2026-04-01T00:00:00.000Z', episodeFileId: 5001, id: 101, seasonNumber: 1 },
        { airDateUtc: '2026-04-08T00:00:00.000Z', episodeFileId: 5002, id: 102, seasonNumber: 1 },
        { airDateUtc: '2026-04-15T00:00:00.000Z', episodeFileId: 6001, id: 201, seasonNumber: 2 },
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

  it('ignores unrelated same-series queue rows when reporting targeted validation progress', async () => {
    vi.doMock('$lib/server/acquisition-validator-shared', () => ({
      fetchHistoryRecords: vi.fn().mockResolvedValue([]),
      fetchQueueRecords: vi.fn().mockResolvedValue([
        {
          id: 10,
          seasonNumbers: [1],
          series: {
            id: 701,
            title: 'Andor',
            year: 2022,
          },
          seriesId: 701,
          size: 4000,
          sizeleft: 2000,
          status: 'Downloading',
          title: 'Andor.S01.1080p.WEB-DL-FLUX',
        },
        {
          id: 11,
          episode: {
            id: 201,
            seasonNumber: 2,
            title: 'One Year Later',
          },
          series: {
            id: 701,
            title: 'Andor',
            year: 2022,
          },
          seriesId: 701,
          size: 1000,
          sizeleft: 50,
          status: 'Downloading',
          title: 'Andor.S02E01.1080p.WEB-DL-FLUX',
        },
      ]),
      historySince: vi.fn().mockImplementation((records: Array<Record<string, unknown>>) => records),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchEpisodeFile: vi.fn(),
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue([
        { airDateUtc: '2026-04-01T00:00:00.000Z', episodeFileId: 5001, id: 101, seasonNumber: 1 },
        { airDateUtc: '2026-04-08T00:00:00.000Z', episodeFileId: 5002, id: 102, seasonNumber: 1 },
        { airDateUtc: '2026-04-15T00:00:00.000Z', episodeFileId: 6001, id: 201, seasonNumber: 2 },
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
      summary: null,
    });
  });

  it('uses the persisted completion scope instead of re-deriving target episodes from attempt time', async () => {
    const fetchEpisodeFile = vi
      .fn()
      .mockResolvedValue({
        mediaInfo: {
          audioLanguages: ['English'],
          subtitles: ['English'],
        },
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
          episodeFileId: 5003,
          sourceTitle: 'Andor.S01E03.1080p.WEB-DL-FLUX',
        },
      ]),
      fetchQueueRecords: vi.fn().mockResolvedValue([]),
      historySince: vi.fn().mockImplementation((records: Array<Record<string, unknown>>) => records),
    }));
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchEpisodeFile,
      fetchSeriesEpisodeRecords: vi.fn().mockResolvedValue([
        { airDateUtc: '2026-04-01T00:00:00.000Z', episodeFileId: 5001, id: 101, seasonNumber: 1 },
        { airDateUtc: '2026-04-08T00:00:00.000Z', episodeFileId: 5002, id: 102, seasonNumber: 1 },
        { airDateUtc: '2026-04-10T00:00:00.000Z', episodeFileId: 5003, id: 103, seasonNumber: 1 },
        { airDateUtc: '2026-04-20T00:00:00.000Z', episodeFileId: 5004, id: 104, seasonNumber: 1 },
      ]),
    }));

    const module = await import('$lib/server/acquisition-series-validator');
    const result = await module.validateSeriesAttempt(
      {
        ...seriesJob,
        completionEpisodeIds: [101, 102, 103],
      },
      '2026-04-13T12:00:00.000Z',
    );

    expect(result).toEqual({
      outcome: 'success',
      preferredReleaser: 'flux',
      progress: 100,
      queueStatus: 'Imported',
      reasonCode: 'validated',
      summary: 'Validated 3 targeted episodes',
    });
    expect(fetchEpisodeFile).toHaveBeenCalledTimes(3);
    expect(fetchEpisodeFile).not.toHaveBeenCalledWith(5004);
  });
});
