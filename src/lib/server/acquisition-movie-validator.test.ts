import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';

const movieJob: PersistedAcquisitionJob = {
  id: 'job-movie-1',
  itemId: 'movie:727',
  arrItemId: 727,
  kind: 'movie',
  title: 'Dangerous Animals',
  sourceService: 'radarr',
  status: 'validating',
  attempt: 1,
  maxRetries: 4,
  currentRelease: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
  selectedReleaser: 'kbox',
  preferredReleaser: null,
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
  queuedManualSelection: null,
  targetSeasonNumbers: null,
  targetEpisodeIds: null,
  startedAt: '2026-04-18T10:40:57.698Z',
  updatedAt: '2026-04-18T10:40:57.698Z',
  completedAt: null,
  attempts: [],
  failedGuids: [],
};

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('validateMovieAttempt', () => {
  it('fails immediately when Radarr leaves the completed download import-pending with a terminal upgrade warning', async () => {
    vi.doMock('$lib/server/acquisition-validator-shared', async () => {
      const actual = await vi.importActual<
        typeof import('$lib/server/acquisition-validator-shared')
      >('$lib/server/acquisition-validator-shared');

      return {
        ...actual,
        fetchHistoryRecords: vi.fn().mockResolvedValue([
          {
            date: '2026-04-18T10:46:11Z',
            eventType: 'grabbed',
            sourceTitle: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
          },
        ]),
        fetchQueueRecords: vi.fn().mockResolvedValue([
          {
            id: 1996958567,
            movieId: 727,
            downloadId: 'SABnzbd_nzo_4lejah9m',
            title: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
            status: 'completed',
            trackedDownloadStatus: 'warning',
            trackedDownloadState: 'importPending',
            statusMessages: [
              {
                title: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
                messages: [
                  'Not an upgrade for existing movie file. Existing quality: Bluray-2160p. New Quality WEBDL-1080p.',
                ],
              },
            ],
            size: 7_845_710_150,
            sizeleft: 0,
            movie: {
              id: 727,
              title: 'Dangerous Animals',
              year: 2025,
            },
          },
        ]),
      };
    });
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-movie-validator');
    const result = await module.validateMovieAttempt(movieJob, '2026-04-18T10:46:04.380Z');

    expect(result).toEqual({
      liveDownloadId: null,
      liveQueueId: null,
      outcome: 'failure',
      preferredReleaser: null,
      progress: 100,
      queueStatus: 'Import blocked',
      reasonCode: 'import-blocked',
      summary:
        'Arr refused to import the release: Not an upgrade for existing movie file. Existing quality: Bluray-2160p. New Quality WEBDL-1080p.',
    });
  });

  it('stays pending while the movie is still downloading and no import block is present', async () => {
    vi.doMock('$lib/server/acquisition-validator-shared', async () => {
      const actual = await vi.importActual<
        typeof import('$lib/server/acquisition-validator-shared')
      >('$lib/server/acquisition-validator-shared');

      return {
        ...actual,
        fetchHistoryRecords: vi.fn().mockResolvedValue([]),
        fetchQueueRecords: vi.fn().mockResolvedValue([
          {
            id: 1996958567,
            movieId: 727,
            downloadId: 'SABnzbd_nzo_4lejah9m',
            title: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
            status: 'downloading',
            trackedDownloadStatus: 'ok',
            trackedDownloadState: 'downloading',
            size: 7_845_710_150,
            sizeleft: 3_922_855_075,
            movie: {
              id: 727,
              title: 'Dangerous Animals',
              year: 2025,
            },
          },
        ]),
      };
    });
    vi.doMock('$lib/server/lookup-service', () => ({
      fetchExistingMovie: vi.fn(),
    }));

    const module = await import('$lib/server/acquisition-movie-validator');
    const result = await module.validateMovieAttempt(movieJob, '2026-04-18T10:46:04.380Z');

    expect(result).toEqual({
      liveDownloadId: 'SABnzbd_nzo_4lejah9m',
      liveQueueId: 1996958567,
      outcome: 'pending',
      preferredReleaser: null,
      progress: 50,
      queueStatus: 'Downloading',
      reasonCode: null,
      summary: null,
    });
  });
});
