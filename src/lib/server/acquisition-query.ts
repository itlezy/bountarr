import { cloneJob, isTerminalJobStatus } from '$lib/server/acquisition-domain';
import { getAcquisitionEventRepository } from '$lib/server/acquisition-event-repository';
import { getAcquisitionJobRepository } from '$lib/server/acquisition-job-repository';
import type { AcquisitionJob, AcquisitionResponse, MediaKind } from '$lib/shared/types';

export function listAllAcquisitionJobs(): AcquisitionJob[] {
  return getAcquisitionJobRepository().listJobs().map(cloneJob);
}

export function listQueueAcquisitionJobs(): AcquisitionJob[] {
  return getAcquisitionJobRepository()
    .listJobs()
    .filter(
      (job) =>
        !isTerminalJobStatus(job.status) ||
        Date.now() - Date.parse(job.updatedAt) < 24 * 60 * 60_000,
    )
    .map(cloneJob);
}

export async function getAcquisitionJobsResponse(): Promise<AcquisitionResponse> {
  return {
    updatedAt: new Date().toISOString(),
    jobs: listAllAcquisitionJobs(),
  };
}

export function listAcquisitionEvents(jobId: string, limit = 50) {
  return getAcquisitionEventRepository().listByJob(jobId, limit);
}

export function findPreferredReleaser(kind: MediaKind, title: string): string | null {
  return getAcquisitionJobRepository().findPreferredReleaser(kind, title);
}
