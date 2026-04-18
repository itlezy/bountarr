import { describe, expect, it } from 'vitest';
import { externalQueueEntryCapabilities } from '$lib/server/queue-entry-capabilities';
import type { QueueItem } from '$lib/shared/types';

function buildExternalItem(
  overrides: Partial<
    Pick<
      QueueItem,
      'downloadId' | 'queueId' | 'status' | 'statusDetail' | 'trackedDownloadState' | 'trackedDownloadStatus'
    >
  > = {},
): Pick<
  QueueItem,
  'downloadId' | 'queueId' | 'status' | 'statusDetail' | 'trackedDownloadState' | 'trackedDownloadStatus'
> {
  return {
    downloadId: null,
    queueId: 7,
    status: 'Downloading',
    statusDetail: null,
    trackedDownloadState: 'downloading',
    trackedDownloadStatus: 'ok',
    ...overrides,
  };
}

describe('externalQueueEntryCapabilities', () => {
  it('keeps active queue rows cancelable', () => {
    expect(externalQueueEntryCapabilities(buildExternalItem())).toEqual({
      canCancel: true,
      canRemove: false,
    });
  });

  it('treats recognized import-block rows as removable stale entries', () => {
    expect(
      externalQueueEntryCapabilities(
        buildExternalItem({
          status: 'Completed',
          statusDetail: 'Import failed, destination path already exists.',
          trackedDownloadState: 'importpending',
          trackedDownloadStatus: 'warning',
        }),
      ),
    ).toEqual({
      canCancel: false,
      canRemove: true,
    });
  });

  it('allows download-only rows to stay actionable while they are active', () => {
    expect(
      externalQueueEntryCapabilities(
        buildExternalItem({
          downloadId: 'download-shared',
          queueId: null,
        }),
      ),
    ).toEqual({
      canCancel: true,
      canRemove: false,
    });
  });
});
