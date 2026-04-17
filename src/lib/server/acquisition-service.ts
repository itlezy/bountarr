import type {
  ArrDeleteTarget,
  AcquisitionJobActionResponse,
  AcquisitionResponse,
  GrabResponse,
  ManualReleaseListResponse,
  MediaItemActionResponse,
  MediaItem,
  Preferences,
  QueueCancelRequest,
  QueueItem,
  QueueActionResponse,
} from '$lib/shared/types';
import { queueCache } from '$lib/server/app-cache';
import type { GrabItemOptions } from '$lib/server/acquisition-domain';
import { manualSelectionQueuedStatus } from '$lib/server/acquisition-domain';
import { getAcquisitionRunner } from '$lib/server/acquisition-runner';
import {
  getAcquisitionJobsResponse,
  listQueueAcquisitionJobs,
} from '$lib/server/acquisition-query';
import { getAcquisitionLifecycle } from '$lib/server/acquisition-lifecycle';
import { getAcquisitionJobRepository } from '$lib/server/acquisition-job-repository';
import { arrFetch } from '$lib/server/arr-client';
import {
  fetchQueueRecords,
  queueRecordArrItemId,
  queueRecordId,
} from '$lib/server/acquisition-validator-shared';
import { asArray, asRecord } from '$lib/server/raw';
import { grabItem as grabItemInternal } from '$lib/server/acquisition-grab-service';
import {
  findManualReleaseSelection,
  getManualReleaseResults as getManualReleaseResultsInternal,
} from '$lib/server/acquisition-selection';

export function ensureAcquisitionWorkers(): void {
  getAcquisitionRunner().ensureWorkers();
}

export function getQueueAcquisitionJobs() {
  ensureAcquisitionWorkers();
  return listQueueAcquisitionJobs();
}

export async function getAcquisitionJobs(): Promise<AcquisitionResponse> {
  ensureAcquisitionWorkers();
  return getAcquisitionJobsResponse();
}

export async function grabItem(
  item: MediaItem,
  preferences?: Partial<Preferences>,
  options?: GrabItemOptions,
): Promise<GrabResponse> {
  return grabItemInternal(item, preferences, options);
}

async function unmonitorTrackedItem(
  service: 'radarr' | 'sonarr',
  arrItemId: number,
): Promise<boolean> {
  try {
    if (service === 'radarr') {
      const movie = asRecord(await arrFetch<unknown>('radarr', `/api/v3/movie/${arrItemId}`));
      await arrFetch<unknown>('radarr', `/api/v3/movie/${arrItemId}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...movie,
          monitored: false,
        }),
      });
      return true;
    }

    const series = asRecord(await arrFetch<unknown>('sonarr', `/api/v3/series/${arrItemId}`));
    await arrFetch<unknown>('sonarr', `/api/v3/series/${arrItemId}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...series,
        monitored: false,
        seasons: asArray(series.seasons).map((season) => ({
          ...asRecord(season),
          monitored: false,
        })),
      }),
    });
    return true;
  } catch (error) {
    if (isMissingArrItemError(error)) {
      return false;
    }

    throw error;
  }
}

async function deleteQueueEntry(service: 'radarr' | 'sonarr', queueId: number): Promise<boolean> {
  try {
    await arrFetch<unknown>(
      service,
      `/api/v3/queue/${queueId}`,
      {
        method: 'DELETE',
      },
      {
        blocklist: false,
        removeFromClient: true,
        skipRedownload: false,
      },
    );
    return true;
  } catch (error) {
    if (isMissingArrItemError(error)) {
      return false;
    }

    throw error;
  }
}

async function deleteTrackedItem(
  service: 'radarr' | 'sonarr',
  arrItemId: number,
  deleteFiles: boolean,
): Promise<void> {
  await arrFetch<unknown>(
    service,
    service === 'radarr' ? `/api/v3/movie/${arrItemId}` : `/api/v3/series/${arrItemId}`,
    {
      method: 'DELETE',
    },
    {
      addImportExclusion: false,
      deleteFiles,
    },
  );
}

function isMissingArrItemError(error: unknown): boolean {
  return error instanceof Error && /\b404\b/.test(error.message);
}

function invalidateQueueCache(): void {
  queueCache.delete('queue');
}

async function findQueueEntryIdsForArrItem(
  service: 'radarr' | 'sonarr',
  arrItemId: number,
): Promise<number[]> {
  const queueRecords = await fetchQueueRecords(service);
  return [
    ...new Set(
      queueRecords
        .filter((record) => queueRecordArrItemId(service, record) === arrItemId)
        .map((record) => queueRecordId(record))
        .filter((queueId): queueId is number => queueId !== null),
    ),
  ];
}

async function deleteQueueEntries(
  service: 'radarr' | 'sonarr',
  queueIds: number[],
): Promise<number> {
  const uniqueQueueIds = [...new Set(queueIds)];
  if (uniqueQueueIds.length === 0) {
    return 0;
  }

  invalidateQueueCache();
  const deleted = await Promise.all(uniqueQueueIds.map((queueId) => deleteQueueEntry(service, queueId)));
  return deleted.filter(Boolean).length;
}

export async function getManualReleaseResults(jobId: string): Promise<ManualReleaseListResponse> {
  ensureAcquisitionWorkers();
  const job = getAcquisitionJobRepository().getJob(jobId);
  if (!job) {
    throw new Error(`Acquisition job ${jobId} was not found.`);
  }

  return getManualReleaseResultsInternal(job);
}

export async function selectManualRelease(
  jobId: string,
  guid: string,
  indexerId: number,
): Promise<AcquisitionJobActionResponse> {
  ensureAcquisitionWorkers();
  const jobs = getAcquisitionJobRepository();
  const job = jobs.getJob(jobId);
  if (!job) {
    throw new Error(`Acquisition job ${jobId} was not found.`);
  }
  if (!['failed', 'queued', 'retrying', 'searching'].includes(job.status)) {
    throw new Error(`Acquisition job ${jobId} can no longer accept manual release selections.`);
  }

  const selection = await findManualReleaseSelection(job, guid, indexerId);
  const resumed = jobs.updateJob(job.id, {
    autoRetrying: false,
    completedAt: null,
    reasonCode: null,
    failureReason: null,
    progress: null,
    queueStatus: manualSelectionQueuedStatus,
    status: 'queued',
    validationSummary: selection.selection.decision.reason,
  });

  getAcquisitionRunner().enqueueSelectedRelease(resumed.id, selection);
  return {
    job: resumed,
    message: `Queued manual release ${selection.selectedRelease?.title ?? guid}.`,
  };
}

export async function cancelAcquisitionJob(jobId: string): Promise<AcquisitionJobActionResponse> {
  ensureAcquisitionWorkers();
  invalidateQueueCache();
  const jobs = getAcquisitionJobRepository();
  const job = jobs.getJob(jobId);
  if (!job) {
    throw new Error(`Acquisition job ${jobId} was not found.`);
  }

  await deleteQueueEntries(
    job.sourceService,
    await findQueueEntryIdsForArrItem(job.sourceService, job.arrItemId),
  );
  await unmonitorTrackedItem(job.sourceService, job.arrItemId);
  const cancelled = getAcquisitionLifecycle().cancelJob(job);

  return {
    job: cancelled,
    message: `${job.title} download was cancelled and unmonitored.`,
  };
}

async function cancelExternalQueueItem(
  item: Pick<QueueItem, 'arrItemId' | 'id' | 'queueId' | 'sourceService' | 'title'>,
): Promise<QueueActionResponse> {
  if (item.queueId === null) {
    throw new Error('This download cannot be cancelled.');
  }

  await deleteQueueEntries(item.sourceService, [item.queueId]);

  return {
    itemId: item.id,
    message: `${item.title} download was cancelled.`,
  };
}

export async function cancelQueueEntry(entry: QueueCancelRequest): Promise<QueueActionResponse> {
  if (entry.kind === 'managed') {
    invalidateQueueCache();
    const job = getAcquisitionJobRepository().getJob(entry.jobId);
    if (job) {
      const result = await cancelAcquisitionJob(entry.jobId);
      return {
        itemId: entry.jobId,
        message: result.message,
      };
    }

    await deleteQueueEntries(
      entry.sourceService,
      await findQueueEntryIdsForArrItem(entry.sourceService, entry.arrItemId),
    );
    await unmonitorTrackedItem(entry.sourceService, entry.arrItemId);
    return {
      itemId: entry.jobId,
      message: `${entry.title} download was cancelled and unmonitored.`,
    };
  }

  return cancelExternalQueueItem({
    arrItemId: entry.arrItemId,
    id: entry.id,
    queueId: entry.queueId,
    sourceService: entry.sourceService,
    title: entry.title,
  });
}

export async function deleteArrItem(item: ArrDeleteTarget): Promise<MediaItemActionResponse> {
  invalidateQueueCache();
  const jobs =
    item.arrItemId !== null
      ? getAcquisitionJobRepository().listActiveJobsByArrItem(
          item.arrItemId,
          item.kind,
          item.sourceService,
        )
      : [];
  const serviceLabel = item.sourceService === 'radarr' ? 'Radarr' : 'Sonarr';
  const queueIds =
    item.queueId !== null && item.queueId !== undefined
      ? [item.queueId]
      : item.arrItemId !== null
        ? await findQueueEntryIdsForArrItem(item.sourceService, item.arrItemId)
        : [];
  await deleteQueueEntries(item.sourceService, queueIds);

  if (item.arrItemId !== null) {
    for (const job of jobs) {
      getAcquisitionLifecycle().cancelJob(job, 'Deleted from Arr by user');
    }
  }

  if (item.arrItemId === null) {
    return {
      itemId: item.id,
      message: `${item.title} stale queue entry was removed from ${serviceLabel}.`,
    };
  }

  try {
    await deleteTrackedItem(item.sourceService, item.arrItemId, true);
  } catch (error) {
    if (!isMissingArrItemError(error)) {
      throw error;
    }

    getAcquisitionJobRepository().deleteJobsByArrItem(
      item.arrItemId,
      item.kind,
      item.sourceService,
    );

    return {
      itemId: item.id,
      message: `${item.title} was already missing from ${serviceLabel}, and the stale queue entry was cleared.`,
    };
  }

  getAcquisitionJobRepository().deleteJobsByArrItem(item.arrItemId, item.kind, item.sourceService);

  return {
    itemId: item.id,
    message: `${item.title} was deleted from ${serviceLabel} and its files were removed.`,
  };
}
