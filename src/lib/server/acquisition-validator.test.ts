import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import type { ValidationProbe } from '$lib/server/acquisition-validator-shared';

function buildMovieJob(): PersistedAcquisitionJob {
  return {
    id: 'job-identity',
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
    progress: null,
    queueStatus: 'Waiting for download',
    liveQueueId: null,
    liveDownloadId: null,
    qualityProfileId: null,
    queuedManualSelection: null,
    targetSeasonNumbers: null,
    targetEpisodeIds: null,
    preferences: {
      preferredLanguage: 'English',
      subtitleLanguage: 'English',
    },
    startedAt: '2026-04-13T10:00:00.000Z',
    updatedAt: '2026-04-13T10:00:00.000Z',
    completedAt: null,
    attempts: [],
    failedGuids: [],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.resetModules();
});

describe('acquisition validator', () => {
  it('carries observed live queue identity into the next wait-loop probe', async () => {
    const seenJobs: PersistedAcquisitionJob[] = [];
    const pendingProbe: ValidationProbe = {
      outcome: 'pending',
      preferredReleaser: null,
      progress: 34,
      queueStatus: 'Downloading',
      liveDownloadId: 'radarr-download-77',
      liveQueueId: 77,
      reasonCode: null,
      summary: null,
    };
    const successProbe: ValidationProbe = {
      outcome: 'success',
      preferredReleaser: 'flux',
      progress: 100,
      queueStatus: 'Imported',
      liveDownloadId: null,
      liveQueueId: null,
      reasonCode: 'validated',
      summary: 'Imported and validated',
    };
    const validateMovieAttempt = vi
      .fn()
      .mockImplementation(async (job: PersistedAcquisitionJob) => {
        seenJobs.push(structuredClone(job));
        return seenJobs.length === 1 ? pendingProbe : successProbe;
      });

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionAttemptTimeoutMinutes: () => 1,
      acquisitionPollMs: () => 0,
    }));
    vi.doMock('$lib/server/acquisition-movie-validator', () => ({
      validateMovieAttempt,
    }));
    vi.doMock('$lib/server/acquisition-series-validator', () => ({
      validateSeriesAttempt: vi.fn(),
    }));

    const { waitForAttemptOutcome } = await import('$lib/server/acquisition-validator');
    const progress = vi.fn();
    const result = await waitForAttemptOutcome(
      buildMovieJob(),
      '2026-04-13T10:00:00.000Z',
      progress,
    );

    expect(result.outcome).toBe('success');
    expect(validateMovieAttempt).toHaveBeenCalledTimes(2);
    expect(seenJobs[0]).toMatchObject({
      liveDownloadId: null,
      liveQueueId: null,
    });
    expect(seenJobs[1]).toMatchObject({
      liveDownloadId: 'radarr-download-77',
      liveQueueId: 77,
      progress: 34,
      queueStatus: 'Downloading',
    });
    expect(progress).toHaveBeenCalledWith({
      liveDownloadId: 'radarr-download-77',
      liveQueueId: 77,
      progress: 34,
      queueStatus: 'Downloading',
    });
  });

  it('returns the latest observed live queue state when an attempt times out', async () => {
    const pendingProbe: ValidationProbe = {
      outcome: 'pending',
      preferredReleaser: null,
      progress: 48,
      queueStatus: 'Downloading',
      liveDownloadId: 'radarr-download-48',
      liveQueueId: 48,
      reasonCode: null,
      summary: null,
    };
    const validateMovieAttempt = vi.fn().mockResolvedValue(pendingProbe);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(0);
    now.mockReturnValueOnce(1);
    now.mockReturnValue(60_001);

    vi.doMock('$lib/server/arr-client', () => ({
      acquisitionAttemptTimeoutMinutes: () => 1,
      acquisitionPollMs: () => 0,
    }));
    vi.doMock('$lib/server/acquisition-movie-validator', () => ({
      validateMovieAttempt,
    }));
    vi.doMock('$lib/server/acquisition-series-validator', () => ({
      validateSeriesAttempt: vi.fn(),
    }));

    const { waitForAttemptOutcome } = await import('$lib/server/acquisition-validator');
    const result = await waitForAttemptOutcome(buildMovieJob(), '2026-04-13T10:00:00.000Z');

    expect(validateMovieAttempt).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: 'timeout',
      liveDownloadId: 'radarr-download-48',
      liveQueueId: 48,
      progress: 48,
      queueStatus: 'Downloading',
      reasonCode: 'import-timeout',
    });
  });
});
