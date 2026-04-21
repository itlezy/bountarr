import { acquisitionAttemptTimeoutMinutes, acquisitionPollMs } from '$lib/server/arr-client';
import { validateMovieAttempt } from '$lib/server/acquisition-movie-validator';
import { validateSeriesAttempt } from '$lib/server/acquisition-series-validator';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import type {
  AttemptProgressHandler,
  AttemptValidator,
  ValidationProbe,
  WaitForAttemptOutcomeResult,
} from '$lib/server/acquisition-validator-shared';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validatorForJob(job: PersistedAcquisitionJob): AttemptValidator {
  return job.kind === 'movie' ? validateMovieAttempt : validateSeriesAttempt;
}

export type { WaitForAttemptOutcomeResult } from '$lib/server/acquisition-validator-shared';

export async function probeAttempt(
  job: PersistedAcquisitionJob,
  attemptStartedAt: string,
): Promise<ValidationProbe> {
  const validateAttempt = validatorForJob(job);
  return validateAttempt(job, attemptStartedAt);
}

export async function waitForAttemptOutcome(
  job: PersistedAcquisitionJob,
  attemptStartedAt: string,
  onProgress?: AttemptProgressHandler,
): Promise<WaitForAttemptOutcomeResult> {
  const deadline = Date.now() + acquisitionAttemptTimeoutMinutes() * 60_000;
  const validateAttempt = validatorForJob(job);
  let currentJob = job;

  while (Date.now() < deadline) {
    const validation = await validateAttempt(currentJob, attemptStartedAt);

    if (
      validation.progress !== null ||
      validation.queueStatus ||
      validation.liveDownloadId !== null ||
      validation.liveQueueId !== null
    ) {
      onProgress?.({
        progress: validation.progress,
        queueStatus: validation.queueStatus,
        liveDownloadId: validation.liveDownloadId,
        liveQueueId: validation.liveQueueId,
      });
    }

    currentJob = {
      ...currentJob,
      liveDownloadId: validation.liveDownloadId ?? currentJob.liveDownloadId,
      liveQueueId: validation.liveQueueId ?? currentJob.liveQueueId,
      progress: validation.progress ?? currentJob.progress,
      queueStatus: validation.queueStatus ?? currentJob.queueStatus,
    };

    if (validation.outcome === 'success') {
      return {
        outcome: 'success',
        preferredReleaser: validation.preferredReleaser,
        progress: validation.progress,
        queueStatus: validation.queueStatus,
        reasonCode: validation.reasonCode ?? 'validated',
        summary: validation.summary ?? 'Imported and validated',
      };
    }

    if (validation.outcome === 'failure') {
      return {
        outcome: 'failure',
        preferredReleaser: null,
        progress: validation.progress,
        queueStatus: validation.queueStatus,
        reasonCode: validation.reasonCode ?? 'missing-audio',
        summary: validation.summary ?? 'Imported release failed validation',
      };
    }

    await sleep(acquisitionPollMs());
  }

  return {
    outcome: 'timeout',
    preferredReleaser: null,
    progress: currentJob.progress,
    queueStatus: currentJob.queueStatus,
    liveDownloadId: currentJob.liveDownloadId,
    liveQueueId: currentJob.liveQueueId,
    reasonCode: 'import-timeout',
    summary: `Timed out after ${acquisitionAttemptTimeoutMinutes()} minutes waiting for import`,
  };
}
