import { acquisitionAttemptTimeoutMinutes, acquisitionPollMs } from '$lib/server/arr-client';
import { validateMovieAttempt } from '$lib/server/acquisition-movie-validator';
import { validateSeriesAttempt } from '$lib/server/acquisition-series-validator';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import type {
  AttemptProgressHandler,
  AttemptValidator,
  WaitForAttemptOutcomeResult,
} from '$lib/server/acquisition-validator-shared';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validatorForJob(job: PersistedAcquisitionJob): AttemptValidator {
  return job.kind === 'movie' ? validateMovieAttempt : validateSeriesAttempt;
}

export type { WaitForAttemptOutcomeResult } from '$lib/server/acquisition-validator-shared';

export async function waitForAttemptOutcome(
  job: PersistedAcquisitionJob,
  attemptStartedAt: string,
  onProgress?: AttemptProgressHandler,
): Promise<WaitForAttemptOutcomeResult> {
  const deadline = Date.now() + acquisitionAttemptTimeoutMinutes() * 60_000;
  const validateAttempt = validatorForJob(job);

  while (Date.now() < deadline) {
    const validation = await validateAttempt(job, attemptStartedAt);

    if (validation.progress !== null || validation.queueStatus) {
      onProgress?.({
        progress: validation.progress,
        queueStatus: validation.queueStatus,
      });
    }

    if (validation.outcome === 'success') {
      return {
        outcome: 'success',
        preferredReleaser: validation.preferredReleaser,
        progress: validation.progress,
        queueStatus: validation.queueStatus,
        summary: validation.summary ?? 'Imported and validated',
      };
    }

    if (validation.outcome === 'failure') {
      return {
        outcome: 'failure',
        preferredReleaser: null,
        progress: validation.progress,
        queueStatus: validation.queueStatus,
        summary: validation.summary ?? 'Imported release failed validation',
      };
    }

    await sleep(acquisitionPollMs());
  }

  return {
    outcome: 'timeout',
    preferredReleaser: null,
    progress: job.progress,
    queueStatus: job.queueStatus,
    summary: `Timed out after ${acquisitionAttemptTimeoutMinutes()} minutes waiting for import`,
  };
}
