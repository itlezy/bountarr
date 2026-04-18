import type { AcquisitionJob, QueueItem } from '$lib/shared/types';

function terminalManagedStatus(status: AcquisitionJob['status']): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}

export function managedQueueHasUnusableLiveRow(
  job: Pick<AcquisitionJob, 'liveDownloadId' | 'liveQueueId'>,
  liveQueueItems: ReadonlyArray<Pick<QueueItem, 'queueId'>> = [],
): boolean {
  if (liveQueueItems.some((item) => item.queueId === null)) {
    return true;
  }

  return liveQueueItems.length === 0 && Boolean(job.liveDownloadId) && (job.liveQueueId ?? null) === null;
}

export function managedQueueEntryCapabilities(
  job: Pick<AcquisitionJob, 'liveDownloadId' | 'liveQueueId' | 'status'>,
  liveQueueItems: ReadonlyArray<Pick<QueueItem, 'queueId'>> = [],
): { canCancel: boolean; canRemove: boolean } {
  const hasUnusableLiveRow = managedQueueHasUnusableLiveRow(job, liveQueueItems);
  return {
    canCancel: !terminalManagedStatus(job.status) && !hasUnusableLiveRow,
    canRemove: !hasUnusableLiveRow,
  };
}
