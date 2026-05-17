import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';

const baseJob: PersistedAcquisitionJob = {
  id: 'job-active',
  itemId: 'movie:101',
  arrItemId: 101,
  kind: 'movie',
  title: 'Active Movie',
  sourceService: 'radarr',
  status: 'validating',
  attempt: 1,
  maxRetries: 4,
  currentRelease: null,
  selectedReleaser: null,
  preferredReleaser: null,
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
  recoverySelection: null,
  recoveryAttempted: false,
  recoveryStatus: null,
  releaseCandidates: [],
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'English',
  },
  targetSeasonNumbers: null,
  targetEpisodeIds: null,
  startedAt: '2026-05-17T10:00:00.000Z',
  updatedAt: '2026-05-17T10:00:00.000Z',
  completedAt: null,
  attempts: [],
  failedGuids: [],
};

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('acquisition query helpers', () => {
  it('uses runnable jobs for the queue view instead of recent terminal history', async () => {
    const runnable = baseJob;
    const completed: PersistedAcquisitionJob = {
      ...baseJob,
      id: 'job-completed',
      status: 'completed',
      completedAt: '2026-05-17T10:05:00.000Z',
      updatedAt: '2026-05-17T10:05:00.000Z',
    };

    vi.doMock('$lib/server/acquisition-job-repository', () => ({
      getAcquisitionJobRepository: () => ({
        listJobs: () => [completed, runnable],
        listRunnableJobs: () => [runnable],
      }),
    }));

    const { listAllAcquisitionJobs, listQueueAcquisitionJobs } = await import(
      '$lib/server/acquisition-query'
    );

    expect(listAllAcquisitionJobs().map((job) => job.id)).toEqual(['job-completed', 'job-active']);
    expect(listQueueAcquisitionJobs().map((job) => job.id)).toEqual(['job-active']);
  });
});
