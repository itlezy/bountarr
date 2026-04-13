import { createAreaLogger, getErrorMessage, toErrorLogContext } from '$lib/server/logger';
import {
  getAcquisitionEventRepository,
  type AcquisitionEventRepository,
} from '$lib/server/acquisition-event-repository';
import {
  getAcquisitionJobRepository,
  type ClaimAttemptReleaseSubmissionResult,
  type AcquisitionJobRepository,
} from '$lib/server/acquisition-job-repository';
import { extractReleaser } from '$lib/server/media-identity';
import {
  selectionLogContext,
  type ReleaseSelectionResult,
} from '$lib/server/acquisition-selection';
import {
  isTerminalJobStatus,
  manualSelectionQueuedStatus,
  type PersistedAcquisitionJob,
} from '$lib/server/acquisition-domain';
import type { WaitForAttemptOutcomeResult } from '$lib/server/acquisition-validator-shared';
import type { AcquisitionReasonCode } from '$lib/shared/types';

const logger = createAreaLogger('acquisition');

function acquisitionLogContext(job: PersistedAcquisitionJob): Record<string, unknown> {
  return {
    arrItemId: job.arrItemId,
    attempt: job.attempt,
    autoRetrying: job.autoRetrying,
    itemTitle: job.title,
    jobId: job.id,
    kind: job.kind,
    maxRetries: job.maxRetries,
    reasonCode: job.reasonCode,
    service: job.sourceService,
  };
}

function selectionFailureReasonCode(
  releaseSelection: ReleaseSelectionResult,
): AcquisitionReasonCode {
  return releaseSelection.mappedReleases === 0 ? 'no-release-available' : 'no-acceptable-release';
}

export class AcquisitionLifecycle {
  readonly events: AcquisitionEventRepository;
  readonly jobs: AcquisitionJobRepository;

  constructor(
    jobs: AcquisitionJobRepository = getAcquisitionJobRepository(),
    events: AcquisitionEventRepository = getAcquisitionEventRepository(),
  ) {
    this.jobs = jobs;
    this.events = events;
  }

  private getCurrentJob(jobId: string): PersistedAcquisitionJob | null {
    return this.jobs.getJob(jobId);
  }

  private getMutableJob(jobId: string): PersistedAcquisitionJob | null {
    const current = this.getCurrentJob(jobId);
    if (!current || isTerminalJobStatus(current.status)) {
      return null;
    }

    return current;
  }

  private log(
    job: PersistedAcquisitionJob,
    kind: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> = {},
  ): void {
    const logContext = {
      ...acquisitionLogContext(job),
      ...context,
    };

    logger.log(level, message, logContext);
    this.events.append(job.id, kind, level, message, logContext);
  }

  recordJobCreated(job: PersistedAcquisitionJob): void {
    this.log(job, 'job.created', 'info', 'Created acquisition job', {
      preferredReleaser: job.preferredReleaser,
    });
  }

  startSearch(job: PersistedAcquisitionJob): PersistedAcquisitionJob | null {
    const current = this.getCurrentJob(job.id);
    if (
      !current ||
      (current.status !== 'queued' && current.status !== 'retrying' && current.status !== 'searching')
    ) {
      return null;
    }

    const claimResult = this.jobs.claimAttemptSearch(current.id, current.attempt);
    if (claimResult !== 'claimed') {
      return null;
    }

    const result = this.jobs.updateJobIfStatus(job.id, ['queued', 'retrying', 'searching'], {
      autoRetrying: current.autoRetrying,
      failureReason: null,
      progress: null,
      queueStatus: 'Searching releases',
      status: 'searching',
    });
    const next = result.job;
    if (!next || !result.updated) {
      return null;
    }

    this.log(next, 'search.started', 'info', 'Searching manual releases for acquisition attempt');
    return next;
  }

  recordSearchCompleted(
    job: PersistedAcquisitionJob,
    releaseSelection: ReleaseSelectionResult,
  ): void {
    this.log(job, 'search.completed', 'info', 'Manual release search completed', {
      mappedReleases: releaseSelection.mappedReleases,
      rejectedGuids: job.failedGuids.length,
      releasesFound: releaseSelection.releasesFound,
    });
  }

  failNoSelection(
    job: PersistedAcquisitionJob,
    releaseSelection: ReleaseSelectionResult,
  ): PersistedAcquisitionJob {
    const current = this.getCurrentJob(job.id);
    if (
      !current ||
      !(
        current.status === 'searching' ||
        (current.status === 'queued' && current.queueStatus === manualSelectionQueuedStatus)
      )
    ) {
      return current ?? job;
    }

    const next = this.jobs.updateJob(current.id, {
      autoRetrying: false,
      completedAt: new Date().toISOString(),
      reasonCode: selectionFailureReasonCode(releaseSelection),
      failureReason: releaseSelection.selection.decision.reason,
      status: 'failed',
      validationSummary: releaseSelection.selection.decision.reason,
    });

    this.log(next, 'selection.rejected', 'warn', 'No acceptable release passed local selection', {
      ...selectionLogContext(releaseSelection),
      mappedReleases: releaseSelection.mappedReleases,
    });

    return next;
  }

  chooseRelease(
    job: PersistedAcquisitionJob,
    releaseSelection: ReleaseSelectionResult,
  ): { attemptStartedAt: string; job: PersistedAcquisitionJob } | null {
    const selectedRelease = releaseSelection.selectedRelease;
    if (!selectedRelease || !releaseSelection.selectedGuid) {
      throw new Error('A selected release is required before choosing it');
    }

    const current = this.getCurrentJob(job.id);
    if (
      !current ||
      !(
        current.status === 'searching' ||
        (current.status === 'queued' && current.queueStatus === manualSelectionQueuedStatus)
      )
    ) {
      return null;
    }

    const attemptStartedAt = new Date().toISOString();
    const releaser = extractReleaser(selectedRelease.title);
    const result = this.jobs.updateJobIfStatus(job.id, ['searching', 'queued'], {
      autoRetrying: current.autoRetrying,
      completedAt: null,
      currentRelease: selectedRelease.title,
      failureReason: null,
      queueStatus: 'Grabbing release',
      selectedReleaser: releaser,
      status: 'grabbing',
      validationSummary: releaseSelection.selection.decision.reason,
    });
    const next = result.job;
    if (!next || !result.updated) {
      return null;
    }

    this.jobs.upsertAttempt(job.id, {
      attempt: current.attempt,
      finishedAt: null,
      reasonCode: null,
      reason: null,
      releaseTitle: selectedRelease.title,
      releaser,
      startedAt: attemptStartedAt,
      status: 'grabbing',
    });

    this.log(next, 'selection.chosen', 'info', 'Selected release for acquisition attempt', {
      ...selectionLogContext(releaseSelection),
      selectedGuid: releaseSelection.selectedGuid,
    });

    return {
      attemptStartedAt,
      job: next,
    };
  }

  recordGrabSubmitted(
    job: PersistedAcquisitionJob,
    selectedGuid: string,
    selectedTitle: string,
  ): void {
    this.log(job, 'grab.submitted', 'info', 'Submitted selected release to Arr', {
      selectedGuid,
      selectedTitle,
    });
  }

  claimGrabSubmission(
    job: PersistedAcquisitionJob,
    selectedGuid: string,
    indexerId: number,
    selectedTitle: string,
  ): ClaimAttemptReleaseSubmissionResult {
    const claimResult = this.jobs.claimAttemptReleaseSubmission(
      job.id,
      job.attempt,
      selectedGuid,
      indexerId,
    );

    if (claimResult === 'already-claimed') {
      this.log(
        job,
        'grab.submit_skipped',
        'warn',
        'Skipped duplicate Arr release submission for an already claimed acquisition attempt',
        {
          indexerId,
          selectedGuid,
          selectedTitle,
        },
      );
    }

    return claimResult;
  }

  startValidation(job: PersistedAcquisitionJob): PersistedAcquisitionJob {
    const result = this.jobs.updateJobIfStatus(job.id, ['grabbing'], {
      queueStatus: 'Waiting for download',
      status: 'validating',
    });
    return result.job ?? job;
  }

  updateValidationProgress(
    jobId: string,
    progress: number | null,
    queueStatus: string | null,
  ): PersistedAcquisitionJob | null {
    const current = this.getMutableJob(jobId);
    if (!current) {
      return null;
    }

    if (current.status !== 'grabbing' && current.status !== 'validating') {
      return current;
    }

    return this.jobs.updateJob(jobId, {
      progress,
      queueStatus,
      status: 'validating',
    });
  }

  completeJob(
    job: PersistedAcquisitionJob,
    waitResult: WaitForAttemptOutcomeResult,
  ): PersistedAcquisitionJob {
    const current = this.getMutableJob(job.id);
    if (!current) {
      return job;
    }

    this.jobs.upsertAttempt(current.id, {
      attempt: current.attempt,
      finishedAt: new Date().toISOString(),
      reasonCode: waitResult.reasonCode,
      reason: waitResult.summary,
      status: 'completed',
    });

    const next = this.jobs.updateJob(current.id, {
      autoRetrying: false,
      completedAt: new Date().toISOString(),
      reasonCode: waitResult.reasonCode,
      failureReason: null,
      preferredReleaser: waitResult.preferredReleaser ?? current.selectedReleaser,
      progress: waitResult.progress ?? 100,
      queueStatus: waitResult.queueStatus ?? 'Imported',
      status: 'completed',
      validationSummary: waitResult.summary,
    });

    this.log(next, 'job.completed', 'info', 'Acquisition attempt completed successfully', {
      preferredReleaser: waitResult.preferredReleaser,
      progress: waitResult.progress,
      queueStatus: waitResult.queueStatus,
      summary: waitResult.summary,
    });

    return next;
  }

  handleFailedValidation(
    job: PersistedAcquisitionJob,
    selectedGuid: string | null,
    waitResult: WaitForAttemptOutcomeResult,
  ): PersistedAcquisitionJob {
    const current = this.getMutableJob(job.id);
    if (!current) {
      return job;
    }

    if (current.status !== 'grabbing' && current.status !== 'validating') {
      return current;
    }

    if (selectedGuid) {
      this.jobs.addFailedGuid(current.id, selectedGuid);
    }
    const nextAttempt = current.attempt + 1;
    const terminal = nextAttempt > current.maxRetries;

    this.jobs.upsertAttempt(current.id, {
      attempt: current.attempt,
      finishedAt: new Date().toISOString(),
      reasonCode: waitResult.reasonCode,
      reason: waitResult.summary,
      status: terminal ? 'failed' : 'retrying',
    });

    const next = this.jobs.updateJob(current.id, {
      attempt: nextAttempt,
      autoRetrying: !terminal,
      completedAt: terminal ? new Date().toISOString() : null,
      reasonCode: waitResult.reasonCode,
      failureReason: waitResult.summary,
      progress: waitResult.progress,
      queueStatus: waitResult.queueStatus,
      status: terminal ? 'failed' : 'retrying',
      validationSummary: waitResult.summary,
    });

    this.log(
      next,
      terminal ? 'job.failed' : 'job.retrying',
      terminal ? 'error' : 'warn',
      terminal
        ? 'Acquisition attempt failed and retries are exhausted'
        : 'Acquisition attempt failed; retry scheduled',
      {
        nextAttempt: next.attempt,
        progress: waitResult.progress,
        queueStatus: waitResult.queueStatus,
        reasonCode: waitResult.reasonCode,
        summary: waitResult.summary,
      },
    );

    return next;
  }

  handleCrash(job: PersistedAcquisitionJob, error: unknown): PersistedAcquisitionJob {
    const current = this.getCurrentJob(job.id);
    if (!current || isTerminalJobStatus(current.status)) {
      return job;
    }

    const message = getErrorMessage(error, 'Acquisition failed');

    if (current.attempts.some((attempt) => attempt.attempt === current.attempt)) {
      this.jobs.upsertAttempt(current.id, {
        attempt: current.attempt,
        finishedAt: new Date().toISOString(),
        reasonCode: 'crashed',
        reason: message,
        status: 'failed',
      });
    }

    const next = this.jobs.updateJob(current.id, {
      autoRetrying: false,
      completedAt: new Date().toISOString(),
      reasonCode: 'crashed',
      failureReason: message,
      status: 'failed',
      validationSummary: message,
    });

    this.log(next, 'job.crashed', 'error', 'Acquisition flow crashed', {
      ...toErrorLogContext(error),
    });

    return next;
  }

  failLostManualSelection(
    job: PersistedAcquisitionJob,
    reason = 'The queued manual release selection was lost before it could be submitted.',
  ): PersistedAcquisitionJob {
    const current = this.getCurrentJob(job.id);
    if (!current || isTerminalJobStatus(current.status)) {
      return current ?? job;
    }

    this.jobs.upsertAttempt(current.id, {
      attempt: current.attempt,
      finishedAt: new Date().toISOString(),
      reasonCode: 'manual-selection-lost',
      reason,
      status: 'failed',
    });

    const next = this.jobs.updateJob(current.id, {
      autoRetrying: false,
      completedAt: new Date().toISOString(),
      reasonCode: 'manual-selection-lost',
      failureReason: reason,
      progress: null,
      queueStatus: 'Manual selection lost',
      status: 'failed',
      validationSummary: reason,
    });

    this.log(next, 'manual-selection.lost', 'warn', 'Queued manual release selection was lost');
    return next;
  }

  cancelJob(job: PersistedAcquisitionJob, reason = 'Cancelled by user'): PersistedAcquisitionJob {
    const current = this.getCurrentJob(job.id);
    if (!current || isTerminalJobStatus(current.status)) {
      return current ?? job;
    }

    this.jobs.upsertAttempt(current.id, {
      attempt: current.attempt,
      finishedAt: new Date().toISOString(),
      reasonCode: 'cancelled',
      reason,
      status: 'cancelled',
    });

    const next = this.jobs.updateJob(current.id, {
      autoRetrying: false,
      completedAt: new Date().toISOString(),
      reasonCode: 'cancelled',
      failureReason: reason,
      progress: null,
      queueStatus: 'Cancelled',
      status: 'cancelled',
      validationSummary: reason,
    });

    this.log(next, 'job.cancelled', 'warn', 'Acquisition job was cancelled by the user');
    return next;
  }
}

let lifecycleSingleton: AcquisitionLifecycle | null = null;

export function getAcquisitionLifecycle(): AcquisitionLifecycle {
  if (!lifecycleSingleton) {
    lifecycleSingleton = new AcquisitionLifecycle();
  }

  return lifecycleSingleton;
}

export function resetAcquisitionLifecycleForTests(): void {
  lifecycleSingleton = null;
}
