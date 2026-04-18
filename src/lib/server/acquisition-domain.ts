import type {
  AcquisitionAttempt,
  AcquisitionJob,
  ManualReleaseResult,
  ManualReleaseSelectionMode,
  ReleaseDecision,
  ReleaseDecisionCandidate,
} from '$lib/shared/types';

export type ArrService = 'radarr' | 'sonarr';

export type PersistedManualSelection = {
  decision: ReleaseDecision & {
    selected: ReleaseDecisionCandidate;
  };
  payload: Record<string, unknown>;
  selectionMode: ManualReleaseSelectionMode;
  selectedResult: ManualReleaseResult;
};

export type PersistedAcquisitionJob = AcquisitionJob & {
  failedGuids: string[];
  queuedManualSelection: PersistedManualSelection | null;
};

export type GrabItemOptions = {
  qualityProfileId?: number | null;
  seasonNumbers?: number[];
};

export const manualSelectionQueuedStatus = 'Manual selection queued';

export class AcquisitionGrabError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AcquisitionGrabError';
    this.status = status;
  }
}

export function isAcquisitionGrabError(error: unknown): error is AcquisitionGrabError {
  if (!(error instanceof Error)) {
    return false;
  }

  const status = (error as { status?: unknown }).status;
  return (
    error instanceof AcquisitionGrabError ||
    (error.name === 'AcquisitionGrabError' &&
      typeof status === 'number' &&
      Number.isFinite(status))
  );
}

export function cloneJob(job: PersistedAcquisitionJob): AcquisitionJob {
  const {
    failedGuids: _failedGuids,
    queuedManualSelection: _queuedManualSelection,
    ...publicJob
  } = job;
  return structuredClone(publicJob);
}

export function sortJobs(jobs: PersistedAcquisitionJob[]): PersistedAcquisitionJob[] {
  return [...jobs].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return rightTime - leftTime;
  });
}

export function isTerminalJobStatus(status: AcquisitionJob['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

const allowedStatusTransitions: Record<AcquisitionJob['status'], AcquisitionJob['status'][]> = {
  cancelled: [],
  completed: [],
  failed: ['queued'],
  grabbing: ['cancelled', 'completed', 'failed', 'retrying', 'validating'],
  queued: ['cancelled', 'failed', 'grabbing', 'queued', 'searching'],
  retrying: ['cancelled', 'failed', 'queued', 'searching'],
  searching: ['cancelled', 'failed', 'grabbing', 'queued'],
  validating: ['cancelled', 'completed', 'failed', 'retrying', 'validating'],
};

export function canTransitionJobStatus(
  currentStatus: AcquisitionJob['status'],
  nextStatus: AcquisitionJob['status'],
): boolean {
  return currentStatus === nextStatus || allowedStatusTransitions[currentStatus].includes(nextStatus);
}

export function jobStatusLabel(status: AcquisitionJob['status']): string {
  return status.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function updateAttempt(
  attempts: AcquisitionAttempt[],
  attemptNumber: number,
  updater: (attempt: AcquisitionAttempt) => AcquisitionAttempt,
): AcquisitionAttempt[] {
  return attempts.map((attempt) =>
    attempt.attempt === attemptNumber ? updater(attempt) : attempt,
  );
}
