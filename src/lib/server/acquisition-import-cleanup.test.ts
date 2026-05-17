import { afterEach, describe, expect, it, vi } from 'vitest';
import * as arrClient from '$lib/server/arr-client';
import { cleanupFailedImportForRetry } from '$lib/server/acquisition-import-cleanup';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';

const baseJob: PersistedAcquisitionJob = {
  id: 'job-1',
  itemId: 'movie:222',
  arrItemId: 222,
  kind: 'movie',
  title: 'Subtitle Failed Title',
  sourceService: 'radarr',
  status: 'validating',
  attempt: 1,
  maxRetries: 3,
  currentRelease: 'Subtitle.Failed.Title.2026.1080p.WEB-DL-BAD',
  selectedReleaser: null,
  preferredReleaser: null,
  reasonCode: null,
  failureReason: null,
  validationSummary: null,
  autoRetrying: false,
  progress: 100,
  queueStatus: 'Imported',
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'English',
  },
  queuedManualSelection: null,
  targetSeasonNumbers: null,
  targetEpisodeIds: null,
  startedAt: '2026-05-09T05:00:00.000Z',
  updatedAt: '2026-05-09T05:00:00.000Z',
  completedAt: null,
  attempts: [],
  failedGuids: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cleanupFailedImportForRetry', () => {
  it('deletes only the current Radarr movie file', async () => {
    const arrFetch = vi
      .spyOn(arrClient, 'arrFetch')
      .mockResolvedValueOnce({ movieFileId: 44 })
      .mockResolvedValueOnce(undefined);

    const result = await cleanupFailedImportForRetry(baseJob);

    expect(result).toEqual({
      deletedFileIds: [44],
      skipped: false,
    });
    expect(arrFetch).toHaveBeenNthCalledWith(1, 'radarr', '/api/v3/movie/222');
    expect(arrFetch).toHaveBeenNthCalledWith(
      2,
      'radarr',
      '/api/v3/moviefile/44',
      { method: 'DELETE' },
      { deleteFiles: true },
    );
  });

  it('deletes only targeted Sonarr episode files', async () => {
    const arrFetch = vi
      .spyOn(arrClient, 'arrFetch')
      .mockResolvedValueOnce([
        { id: 101, seasonNumber: 1, episodeFileId: 5001 },
        { id: 102, seasonNumber: 1, episodeFileId: 5002 },
        { id: 201, seasonNumber: 2, episodeFileId: 6001 },
      ])
      .mockResolvedValue(undefined);
    const seriesJob: PersistedAcquisitionJob = {
      ...baseJob,
      itemId: 'series:333',
      arrItemId: 333,
      kind: 'series',
      sourceService: 'sonarr',
      targetSeasonNumbers: [1],
      targetEpisodeIds: null,
    };

    const result = await cleanupFailedImportForRetry(seriesJob);

    expect(result).toEqual({
      deletedFileIds: [5001, 5002],
      skipped: false,
    });
    expect(arrFetch).toHaveBeenNthCalledWith(1, 'sonarr', '/api/v3/episode', undefined, {
      seriesId: 333,
    });
    expect(arrFetch).toHaveBeenNthCalledWith(
      2,
      'sonarr',
      '/api/v3/episodefile/5001',
      { method: 'DELETE' },
      { deleteFiles: true },
    );
    expect(arrFetch).toHaveBeenNthCalledWith(
      3,
      'sonarr',
      '/api/v3/episodefile/5002',
      { method: 'DELETE' },
      { deleteFiles: true },
    );
  });
});
