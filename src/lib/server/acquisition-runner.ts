import {
  isTerminalJobStatus,
  manualSelectionQueuedStatus,
  type PersistedAcquisitionJob,
} from '$lib/server/acquisition-domain';
import {
  findReleaseSelection,
  restoreManualSelection,
  submitSelectedRelease,
  type ReleaseSelectionResult,
} from '$lib/server/acquisition-selection';
import {
  type AcquisitionLifecycle,
  getAcquisitionLifecycle,
} from '$lib/server/acquisition-lifecycle';
import {
  type AcquisitionJobRepository,
  getAcquisitionJobRepository,
} from '$lib/server/acquisition-job-repository';
import {
  probeAttempt,
  waitForAttemptOutcome,
  type WaitForAttemptOutcomeResult,
} from '$lib/server/acquisition-validator';
import type { ValidationProbe } from '$lib/server/acquisition-validator-shared';

type AcquisitionRunnerDependencies = {
  findReleaseSelection: (job: PersistedAcquisitionJob) => Promise<ReleaseSelectionResult>;
  probeAttempt: (job: PersistedAcquisitionJob, attemptStartedAt: string) => Promise<ValidationProbe>;
  submitSelectedRelease: (
    job: PersistedAcquisitionJob,
    selection: ReleaseSelectionResult['selection'],
  ) => Promise<void>;
  waitForAttemptOutcome: (
    job: PersistedAcquisitionJob,
    attemptStartedAt: string,
    onProgress?: (progress: { progress: number | null; queueStatus: string | null }) => void,
  ) => Promise<WaitForAttemptOutcomeResult>;
};

const defaultDependencies: AcquisitionRunnerDependencies = {
  findReleaseSelection,
  probeAttempt,
  submitSelectedRelease,
  waitForAttemptOutcome,
};

export class AcquisitionRunner {
  readonly dependencies: AcquisitionRunnerDependencies;
  readonly jobs: AcquisitionJobRepository;
  readonly lifecycle: AcquisitionLifecycle;
  readonly reconciling = new Set<string>();
  readonly running = new Set<string>();
  private readonly reconciliationSweepMs = 30_000;
  private workersStarted = false;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(
    jobs: AcquisitionJobRepository = getAcquisitionJobRepository(),
    lifecycle: AcquisitionLifecycle = getAcquisitionLifecycle(),
    dependencies: AcquisitionRunnerDependencies = defaultDependencies,
  ) {
    this.jobs = jobs;
    this.lifecycle = lifecycle;
    this.dependencies = dependencies;
  }

  private normalizeProbeResult(probe: ValidationProbe): WaitForAttemptOutcomeResult {
    return {
      outcome: probe.outcome === 'failure' ? 'failure' : 'success',
      preferredReleaser: probe.outcome === 'success' ? probe.preferredReleaser : null,
      progress: probe.progress,
      queueStatus: probe.queueStatus,
      reasonCode:
        probe.reasonCode ??
        (probe.outcome === 'success' ? 'validated' : 'missing-audio'),
      summary:
        probe.summary ??
        (probe.outcome === 'success'
          ? 'Imported and validated'
          : 'Imported release failed validation'),
    };
  }

  private currentAttemptStartedAt(job: PersistedAcquisitionJob): string | null {
    return job.attempts.find((attempt) => attempt.attempt === job.attempt)?.startedAt ?? null;
  }

  private async reconcileJob(jobId: string): Promise<boolean> {
    const job = this.jobs.getJob(jobId);
    if (!job || isTerminalJobStatus(job.status)) {
      return true;
    }

    if (job.status !== 'grabbing' && job.status !== 'validating') {
      return false;
    }

    const attemptStartedAt = this.currentAttemptStartedAt(job);
    if (!attemptStartedAt) {
      return false;
    }

    const probe = await this.dependencies.probeAttempt(job, attemptStartedAt);
    const current = this.jobs.getJob(job.id);
    if (!current || isTerminalJobStatus(current.status)) {
      return true;
    }

    if (probe.progress !== null || probe.queueStatus) {
      this.lifecycle.updateValidationProgress(current.id, probe.progress, probe.queueStatus);
    }

    if (current.status === 'grabbing') {
      this.lifecycle.startValidation(current);
    }

    if (probe.outcome === 'success') {
      this.lifecycle.completeJob(current, this.normalizeProbeResult(probe));
      return true;
    }

    if (probe.outcome === 'failure') {
      this.lifecycle.handleFailedValidation(current, null, this.normalizeProbeResult(probe));
      return true;
    }

    return false;
  }

  private async processJob(jobId: string): Promise<void> {
    let job = this.jobs.getJob(jobId);
    if (!job || isTerminalJobStatus(job.status)) {
      return;
    }

    while (job && !isTerminalJobStatus(job.status)) {
      const manualSelection =
        job.status === 'queued' &&
        job.queueStatus === manualSelectionQueuedStatus &&
        job.queuedManualSelection
          ? restoreManualSelection(job.queuedManualSelection)
          : null;

      try {
        if (
          job.status === 'queued' &&
          job.queueStatus === manualSelectionQueuedStatus &&
          !manualSelection
        ) {
          this.lifecycle.failLostManualSelection(job);
          return;
        }

        let releaseSelection: ReleaseSelectionResult;
        if (manualSelection) {
          releaseSelection = manualSelection;
        } else {
          const searchingJob = this.lifecycle.startSearch(job);
          if (!searchingJob) {
            return;
          }
          job = searchingJob;
          releaseSelection = await this.dependencies.findReleaseSelection(job);
          this.lifecycle.recordSearchCompleted(job, releaseSelection);
          const refreshedAfterSearch = this.jobs.getJob(job.id);
          if (!refreshedAfterSearch || isTerminalJobStatus(refreshedAfterSearch.status)) {
            return;
          }

          if (
            (refreshedAfterSearch.status === 'queued' &&
              refreshedAfterSearch.queueStatus === manualSelectionQueuedStatus)
          ) {
            job = refreshedAfterSearch;
            continue;
          }
          if (refreshedAfterSearch.status !== 'searching') {
            job = refreshedAfterSearch;
            continue;
          }

          job = refreshedAfterSearch;
        }

        if (
          !releaseSelection.selection.payload ||
          !releaseSelection.selectedRelease ||
          !releaseSelection.selectedGuid
        ) {
          this.lifecycle.failNoSelection(job, releaseSelection);
          return;
        }

        const chosen = manualSelection
          ? this.lifecycle.chooseQueuedManualRelease(job, releaseSelection)
          : this.lifecycle.chooseAutomaticRelease(job, releaseSelection);
        if (!chosen) {
          return;
        }
        job = chosen.job;

        // Claim the Arr handoff in durable attempt state before the network call so a re-entered
        // attempt cannot post the same release twice.
        const submitClaim = this.lifecycle.claimGrabSubmission(
          job,
          releaseSelection.selectedGuid,
          releaseSelection.selectedRelease.indexerId,
          releaseSelection.selectedRelease.title,
        );
        if (submitClaim === 'missing') {
          return;
        }

        if (submitClaim === 'claimed') {
          await this.dependencies.submitSelectedRelease(job, releaseSelection.selection);
        }
        const submittedJob = this.jobs.getJob(job.id);
        if (!submittedJob || isTerminalJobStatus(submittedJob.status)) {
          return;
        }
        job = submittedJob;
        if (submitClaim === 'claimed') {
          this.lifecycle.recordGrabSubmitted(
            job,
            releaseSelection.selectedGuid,
            releaseSelection.selectedRelease.title,
          );
        }

        job = this.lifecycle.startValidation(job);
        let waitResult = await this.dependencies.waitForAttemptOutcome(
          job,
          chosen.attemptStartedAt,
          (progressUpdate) => {
            this.lifecycle.updateValidationProgress(
              jobId,
              progressUpdate.progress,
              progressUpdate.queueStatus,
            );
          },
        );
        const refreshedJob = this.jobs.getJob(job.id);
        if (!refreshedJob || isTerminalJobStatus(refreshedJob.status)) {
          return;
        }
        job = refreshedJob;

        if (waitResult.outcome === 'success') {
          this.lifecycle.completeJob(job, waitResult);
          return;
        }

        if (waitResult.outcome === 'timeout') {
          waitResult = {
            ...waitResult,
            progress: job.progress,
            queueStatus: job.queueStatus,
          };
        }

        job = this.lifecycle.handleFailedValidation(job, releaseSelection.selectedGuid, waitResult);
        if (isTerminalJobStatus(job.status)) {
          return;
        }
      } catch (error) {
        if (!job) {
          return;
        }

        this.lifecycle.handleCrash(job, error);
        return;
      }

      job = this.jobs.getJob(job.id);
    }
  }

  enqueue(jobId: string): void {
    if (this.running.has(jobId)) {
      return;
    }

    this.running.add(jobId);
    queueMicrotask(() => {
      void this.processJob(jobId).finally(() => {
        this.running.delete(jobId);
        const job = this.jobs.getJob(jobId);
        if (job && !isTerminalJobStatus(job.status)) {
          this.enqueue(job.id);
        }
      });
    });
  }

  private scheduleReconciliation(jobId: string): void {
    if (this.running.has(jobId) || this.reconciling.has(jobId)) {
      return;
    }

    this.reconciling.add(jobId);
    queueMicrotask(() => {
      void this.reconcileJob(jobId)
        .then((handled) => {
          if (!handled) {
            this.enqueue(jobId);
          }
        })
        .finally(() => {
          this.reconciling.delete(jobId);
        });
    });
  }

  private sweepRunnableJobs(): void {
    for (const job of this.jobs.listRunnableJobs()) {
      this.scheduleReconciliation(job.id);
    }
  }

  ensureWorkers(): void {
    if (this.workersStarted) {
      return;
    }

    this.workersStarted = true;
    this.sweepRunnableJobs();
    this.sweeper = setInterval(() => {
      this.sweepRunnableJobs();
    }, this.reconciliationSweepMs);
    this.sweeper.unref?.();
  }

  dispose(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }

    this.workersStarted = false;
  }
}

let runnerSingleton: AcquisitionRunner | null = null;

export function getAcquisitionRunner(): AcquisitionRunner {
  if (!runnerSingleton) {
    runnerSingleton = new AcquisitionRunner();
  }

  return runnerSingleton;
}
