import { isTerminalJobStatus, type PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import {
  findReleaseSelection,
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
  waitForAttemptOutcome,
  type WaitForAttemptOutcomeResult,
} from '$lib/server/acquisition-validator';

type AcquisitionRunnerDependencies = {
  findReleaseSelection: (job: PersistedAcquisitionJob) => Promise<ReleaseSelectionResult>;
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
  submitSelectedRelease,
  waitForAttemptOutcome,
};

export class AcquisitionRunner {
  readonly dependencies: AcquisitionRunnerDependencies;
  readonly jobs: AcquisitionJobRepository;
  readonly lifecycle: AcquisitionLifecycle;
  readonly manualSelectionOverrides = new Map<string, ReleaseSelectionResult>();
  readonly running = new Set<string>();

  constructor(
    jobs: AcquisitionJobRepository = getAcquisitionJobRepository(),
    lifecycle: AcquisitionLifecycle = getAcquisitionLifecycle(),
    dependencies: AcquisitionRunnerDependencies = defaultDependencies,
  ) {
    this.jobs = jobs;
    this.lifecycle = lifecycle;
    this.dependencies = dependencies;
  }

  private async processJob(jobId: string): Promise<void> {
    let job = this.jobs.getJob(jobId);
    if (!job || isTerminalJobStatus(job.status)) {
      return;
    }

    while (job && !isTerminalJobStatus(job.status)) {
      const manualSelection = this.manualSelectionOverrides.get(job.id) ?? null;
      if (manualSelection) {
        this.manualSelectionOverrides.delete(job.id);
      }

      try {
        let releaseSelection: ReleaseSelectionResult;
        if (manualSelection) {
          releaseSelection = manualSelection;
        } else {
          job = this.lifecycle.startSearch(job);
          releaseSelection = await this.dependencies.findReleaseSelection(job);
          this.lifecycle.recordSearchCompleted(job, releaseSelection);
        }

        if (
          !releaseSelection.selection.payload ||
          !releaseSelection.selectedRelease ||
          !releaseSelection.selectedGuid
        ) {
          this.lifecycle.failNoSelection(job, releaseSelection);
          return;
        }

        const chosen = this.lifecycle.chooseRelease(job, releaseSelection);
        job = chosen.job;

        await this.dependencies.submitSelectedRelease(job, releaseSelection.selection);
        const submittedJob = this.jobs.getJob(job.id);
        if (!submittedJob || isTerminalJobStatus(submittedJob.status)) {
          return;
        }
        job = submittedJob;
        this.lifecycle.recordGrabSubmitted(
          job,
          releaseSelection.selectedGuid,
          releaseSelection.selectedRelease.title,
        );

        job = this.lifecycle.startValidation(job);
        const waitResult = await this.dependencies.waitForAttemptOutcome(
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

  enqueueSelectedRelease(jobId: string, releaseSelection: ReleaseSelectionResult): void {
    this.manualSelectionOverrides.set(jobId, releaseSelection);
    this.enqueue(jobId);
  }

  ensureWorkers(): void {
    for (const jobId of this.jobs.listRunnableJobIds()) {
      this.enqueue(jobId);
    }
  }
}

let runnerSingleton: AcquisitionRunner | null = null;

export function getAcquisitionRunner(): AcquisitionRunner {
  if (!runnerSingleton) {
    runnerSingleton = new AcquisitionRunner();
  }

  return runnerSingleton;
}
