import { describe, expect, it } from 'vitest';
import { managedQueueEntryCapabilities } from '$lib/shared/queue-entry-capabilities';
import type { AcquisitionJob, QueueItem } from '$lib/shared/types';

function buildJob(
  overrides: Partial<Pick<AcquisitionJob, 'liveDownloadId' | 'liveQueueId' | 'status'>> = {},
): Pick<AcquisitionJob, 'liveDownloadId' | 'liveQueueId' | 'status'> {
  return {
    status: 'grabbing',
    liveQueueId: null,
    liveDownloadId: null,
    ...overrides,
  };
}

function buildLiveRow(queueId: number | null): Pick<QueueItem, 'queueId'> {
  return { queueId };
}

describe('managedQueueEntryCapabilities', () => {
  it('allows both actions for active managed jobs without unusable live rows', () => {
    expect(managedQueueEntryCapabilities(buildJob())).toEqual({
      canCancel: true,
      canRemove: true,
    });
  });

  it('suppresses both actions when only a download id is known', () => {
    expect(
      managedQueueEntryCapabilities(
        buildJob({
          liveDownloadId: 'download-shared',
        }),
      ),
    ).toEqual({
      canCancel: false,
      canRemove: false,
    });
  });

  it('suppresses both actions when an attached live row has no queue id', () => {
    expect(
      managedQueueEntryCapabilities(
        buildJob({
          liveDownloadId: 'download-shared',
        }),
        [buildLiveRow(null)],
      ),
    ).toEqual({
      canCancel: false,
      canRemove: false,
    });
  });

  it('keeps remove enabled for terminal jobs without unusable live rows', () => {
    expect(
      managedQueueEntryCapabilities(
        buildJob({
          status: 'completed',
        }),
        [buildLiveRow(12)],
      ),
    ).toEqual({
      canCancel: false,
      canRemove: true,
    });
  });
});
