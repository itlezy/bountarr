import type { AcquisitionAttempt, AcquisitionJob } from '$lib/shared/types';

export type ArrService = 'radarr' | 'sonarr';

export type PersistedAcquisitionJob = AcquisitionJob & {
  failedGuids: string[];
};

export type RequestItemOptions = {
  qualityProfileId?: number | null;
};

export function cloneJob(job: PersistedAcquisitionJob): AcquisitionJob {
  const { failedGuids: _failedGuids, ...publicJob } = job;
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
