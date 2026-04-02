import type {
  ArrDeleteTarget,
  AcquisitionJobActionResponse,
  AcquisitionResponse,
  ManualReleaseListResponse,
  MediaItemActionResponse,
  MediaItem,
  Preferences,
  RequestResponse,
  QueueItem,
  QueueActionResponse,
} from '$lib/shared/types';
import type { RequestItemOptions } from '$lib/server/acquisition-domain';
import { getAcquisitionRunner } from '$lib/server/acquisition-runner';
import {
  getAcquisitionJobsResponse,
  listQueueAcquisitionJobs,
} from '$lib/server/acquisition-query';
import { getAcquisitionLifecycle } from '$lib/server/acquisition-lifecycle';
import { getAcquisitionJobRepository } from '$lib/server/acquisition-job-repository';
import { arrFetch } from '$lib/server/arr-client';
import { asArray, asNumber, asRecord } from '$lib/server/raw';
import { requestItem as requestItemInternal } from '$lib/server/acquisition-request-service';
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

export async function requestItem(
  item: MediaItem,
  preferences?: Partial<Preferences>,
  options?: RequestItemOptions,
): Promise<RequestResponse> {
  return requestItemInternal(item, preferences, options);
}

async function unmonitorTrackedItem(
  service: 'radarr' | 'sonarr',
  arrItemId: number,
): Promise<void> {
  if (service === 'radarr') {
    const movie = asRecord(await arrFetch<unknown>('radarr', `/api/v3/movie/${arrItemId}`));
    await arrFetch<unknown>('radarr', `/api/v3/movie/${arrItemId}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...movie,
        monitored: false,
      }),
    });
    return;
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
}

async function deleteQueueEntry(service: 'radarr' | 'sonarr', queueId: number): Promise<void> {
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

async function findQueueEntryForJob(
  service: 'radarr' | 'sonarr',
  arrItemId: number,
): Promise<number | null> {
  const records = (await arrFetch<unknown>(service, '/api/v3/queue', undefined, {
    page: 1,
    pageSize: 100,
    sortDirection: 'ascending',
    sortKey: 'timeleft',
  })) as { records?: unknown[] } | unknown[];
  const items = Array.isArray(records) ? records : (records.records ?? []);
  const match = items
    .map((entry) => asRecord(entry))
    .find((entry) =>
      service === 'radarr'
        ? asNumber(entry.movieId) === arrItemId
        : asNumber(entry.seriesId) === arrItemId,
    );

  return typeof match?.id === 'number' && Number.isFinite(match.id) ? match.id : null;
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

  const selection = await findManualReleaseSelection(job, guid, indexerId);
  const resumed = jobs.updateJob(job.id, {
    completedAt: null,
    failureReason: null,
    progress: null,
    queueStatus: 'Manual selection queued',
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
  const jobs = getAcquisitionJobRepository();
  const job = jobs.getJob(jobId);
  if (!job) {
    throw new Error(`Acquisition job ${jobId} was not found.`);
  }

  const queueId = await findQueueEntryForJob(job.sourceService, job.arrItemId);
  if (queueId !== null) {
    await deleteQueueEntry(job.sourceService, queueId);
  }
  await unmonitorTrackedItem(job.sourceService, job.arrItemId);
  const cancelled = getAcquisitionLifecycle().cancelJob(job);

  return {
    job: cancelled,
    message: `${job.title} download was cancelled and unmonitored.`,
  };
}

export async function cancelQueueItem(
  item: Pick<
    QueueItem,
    'arrItemId' | 'canCancel' | 'id' | 'kind' | 'queueId' | 'sourceService' | 'title'
  >,
): Promise<QueueActionResponse> {
  if (!item.canCancel || item.queueId === null) {
    throw new Error('This download cannot be cancelled.');
  }

  await deleteQueueEntry(item.sourceService, item.queueId);

  if (item.arrItemId !== null) {
    await unmonitorTrackedItem(item.sourceService, item.arrItemId);
  }

  return {
    itemId: item.id,
    message: `${item.title} download was cancelled and unmonitored.`,
  };
}

export async function deleteArrItem(item: ArrDeleteTarget): Promise<MediaItemActionResponse> {
  const jobs =
    item.arrItemId !== null
      ? getAcquisitionJobRepository().listActiveJobsByArrItem(item.arrItemId, item.kind)
      : [];
  const serviceLabel = item.sourceService === 'radarr' ? 'Radarr' : 'Sonarr';
  const queueId =
    item.queueId ??
    (item.arrItemId !== null
      ? await findQueueEntryForJob(item.sourceService, item.arrItemId)
      : null);
  if (queueId !== null) {
    await deleteQueueEntry(item.sourceService, queueId);
  }

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

    getAcquisitionJobRepository().deleteJobsByArrItem(item.arrItemId, item.kind);

    return {
      itemId: item.id,
      message: `${item.title} was already missing from ${serviceLabel}, and the stale queue entry was cleared.`,
    };
  }

  getAcquisitionJobRepository().deleteJobsByArrItem(item.arrItemId, item.kind);

  return {
    itemId: item.id,
    message: `${item.title} was deleted from ${serviceLabel} and its files were removed.`,
  };
}
