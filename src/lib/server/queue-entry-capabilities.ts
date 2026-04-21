import { queueItemIsStaleExternal } from '$lib/server/queue-normalize';
import type { QueueItem } from '$lib/shared/types';

export function externalQueueEntryCapabilities(
  item: Pick<
    QueueItem,
    | 'downloadId'
    | 'queueId'
    | 'status'
    | 'statusDetail'
    | 'trackedDownloadState'
    | 'trackedDownloadStatus'
  >,
): { canCancel: boolean; canRemove: boolean } {
  const actionable = item.queueId !== null || Boolean(item.downloadId);
  const stale = queueItemIsStaleExternal(item);
  return {
    canCancel: actionable && !stale,
    canRemove: actionable && stale,
  };
}
