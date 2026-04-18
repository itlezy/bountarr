import type {
  ArrDeleteTarget,
  AcquisitionJobActionResponse,
  AcquisitionResponse,
  AcquisitionStatus,
  GrabResponse,
  ManualReleaseListResponse,
  ManualReleaseSelectionMode,
  MediaItemActionResponse,
  MediaItem,
  Preferences,
  QueueCancelRequest,
  QueueItem,
  QueueActionResponse,
} from '$lib/shared/types';
import { quoteTitle } from '$lib/shared/text-format';
import { queueCache } from '$lib/server/app-cache';
import type { GrabItemOptions } from '$lib/server/acquisition-domain';
import { isTerminalJobStatus, manualSelectionQueuedStatus } from '$lib/server/acquisition-domain';
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
} from '$lib/server/acquisition-validator-shared';
import {
  queueItemMatchesManagedIdentity,
  type ManagedQueueTarget,
  queueItemMatchesManagedTarget,
} from '$lib/server/queue-matching';
import { normalizeQueueItem, queueItemIsStaleExternal } from '$lib/server/queue-normalize';
import { asArray, asRecord } from '$lib/server/raw';
import { grabItem as grabItemInternal } from '$lib/server/acquisition-grab-service';
import {
  findManualReleaseSelection,
  getManualReleaseResults as getManualReleaseResultsInternal,
  persistManualSelection,
} from '$lib/server/acquisition-selection';

const manualReleaseEligibleStatuses = new Set<AcquisitionStatus>([
  'searching',
  'failed',
  'queued',
  'retrying',
]);

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

function canAcceptManualRelease(status: AcquisitionStatus): boolean {
  return manualReleaseEligibleStatuses.has(status);
}

function manualReleaseConflictMessage(job: {
  id: string;
  queueStatus: string | null;
  status: AcquisitionStatus;
}): string {
  if (!canAcceptManualRelease(job.status)) {
    return `Acquisition job ${job.id} can no longer accept manual release selections.`;
  }

  return `Acquisition job ${job.id} can no longer accept manual release selections.`;
}

function managedCancelMessage(
  job: Pick<MediaItem, 'title'> & { status: AcquisitionStatus },
  deletedQueueEntries: number,
): string {
  if (deletedQueueEntries > 0) {
    return `${quoteTitle(job.title)} download was cancelled and unmonitored.`;
  }

  if (
    job.status === 'queued' ||
    job.status === 'searching' ||
    job.status === 'retrying'
  ) {
    return `${quoteTitle(job.title)} grab was cancelled and unmonitored before Arr created a live queue entry.`;
  }

  return `${quoteTitle(job.title)} grab was cancelled and unmonitored, but no matching Arr queue rows were found. Refresh the queue if a live download is still running.`;
}

async function findQueueItemsForArrItem(
  service: 'radarr' | 'sonarr',
  arrItemId: number,
): Promise<QueueItem[]> {
  return (await fetchQueueRecords(service))
    .map((record) => normalizeQueueItem(service, record))
    .filter(
      (item): item is QueueItem => item !== null && item.arrItemId === arrItemId,
    );
}

async function findManagedQueueItemsForTarget(target: ManagedQueueTarget): Promise<QueueItem[]> {
  const queueRecords = await fetchQueueRecords(target.sourceService);
  return queueRecords
    .map((record) => normalizeQueueItem(target.sourceService, record))
    .filter(
      (item): item is NonNullable<typeof item> =>
        item !== null && queueItemMatchesManagedTarget(target, item),
    );
}

async function findManagedQueueItemsForIdentity(target: ManagedQueueTarget): Promise<QueueItem[]> {
  if ((target.liveQueueId ?? null) === null && !target.liveDownloadId) {
    return [];
  }

  const queueRecords = await fetchQueueRecords(target.sourceService);
  return queueRecords
    .map((record) => normalizeQueueItem(target.sourceService, record))
    .filter(
      (item): item is NonNullable<typeof item> =>
        item !== null && queueItemMatchesManagedIdentity(target, item),
    );
}

function queueIdsFromItems(items: QueueItem[]): number[] {
  return [...new Set(items.map((item) => item.queueId).filter((queueId): queueId is number => queueId !== null))];
}

function assertQueueItemsHaveQueueIds(items: QueueItem[], action: 'cancelled' | 'cleared'): number[] {
  if (items.some((item) => item.queueId === null)) {
    throw new Error(
      `This live Arr queue row cannot be ${action} because Arr did not expose a queue id. Refresh the queue and stop it directly in Arr if it is still running.`,
    );
  }

  return queueIdsFromItems(items);
}

function assertManagedQueueItemsCancelable(items: QueueItem[]): void {
  assertQueueItemsHaveQueueIds(items, 'cancelled');
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

type ExternalQueueLookupTarget = {
  downloadId?: string | null;
  queueId: number | null;
};

async function currentExternalQueueItem(
  service: 'radarr' | 'sonarr',
  target: ExternalQueueLookupTarget,
): Promise<QueueItem | null> {
  const queueItems = (await fetchQueueRecords(service))
    .map((record) => normalizeQueueItem(service, record))
    .filter((queueItem): queueItem is QueueItem => queueItem !== null);

  if (target.queueId !== null) {
    const byQueueId = queueItems.find((queueItem) => queueItem.queueId === target.queueId) ?? null;
    if (byQueueId) {
      return byQueueId;
    }
  }

  if (target.downloadId) {
    return (
      queueItems.find((queueItem) => queueItem.downloadId === target.downloadId) ?? null
    );
  }

  return null;
}

async function requireCurrentExternalQueueItem(
  service: 'radarr' | 'sonarr',
  target: ExternalQueueLookupTarget,
): Promise<QueueItem> {
  const queueItem = await currentExternalQueueItem(service, target);
  if (!queueItem) {
    throw new Error('This queue entry is no longer current. Refresh the queue and try again.');
  }

  return queueItem;
}

function assertExternalQueueItemHasQueueId(queueItem: QueueItem, action: 'cancelled' | 'cleared'): number {
  if (queueItem.queueId === null) {
    throw new Error(
      `This live Arr queue row cannot be ${action} because Arr did not expose a queue id. Refresh the queue and stop it directly in Arr if it is still running.`,
    );
  }

  return queueItem.queueId;
}

function assertCancelableExternalQueueItem(queueItem: QueueItem): void {
  if (queueItemIsStaleExternal(queueItem)) {
    throw new Error('This queue entry is no longer actively downloading. Clear the stale queue entry instead.');
  }
}

function assertRemovableExternalQueueItem(queueItem: QueueItem): void {
  if (!queueItemIsStaleExternal(queueItem)) {
    throw new Error('This queue entry is still active. Cancel the download instead.');
  }
}

export async function getManualReleaseResults(jobId: string): Promise<ManualReleaseListResponse> {
  ensureAcquisitionWorkers();
  const job = getAcquisitionJobRepository().getJob(jobId);
  if (!job) {
    throw new Error(`Acquisition job ${jobId} was not found.`);
  }
  if (!canAcceptManualRelease(job.status)) {
    throw new Error(`Acquisition job ${jobId} can no longer accept manual release selections.`);
  }

  return getManualReleaseResultsInternal(job);
}

export async function selectManualRelease(
  jobId: string,
  guid: string,
  indexerId: number,
  selectionMode: ManualReleaseSelectionMode,
): Promise<AcquisitionJobActionResponse> {
  ensureAcquisitionWorkers();
  const jobs = getAcquisitionJobRepository();
  const job = jobs.getJob(jobId);
  if (!job) {
    throw new Error(`Acquisition job ${jobId} was not found.`);
  }
  if (!canAcceptManualRelease(job.status)) {
    throw new Error(manualReleaseConflictMessage(job));
  }

  const selection = await findManualReleaseSelection(
    job,
    guid,
    indexerId,
    selectionMode,
  );
  const resumedAttempt = job.status === 'failed' ? job.attempt + 1 : job.attempt;
  const replacingQueuedSelection =
    job.status === 'queued' &&
    job.queueStatus === manualSelectionQueuedStatus &&
    job.queuedManualSelection !== null;
  const resumed = jobs.updateJobIfStatus(job.id, ['failed', 'queued', 'retrying', 'searching'], {
    attempt: resumedAttempt,
    autoRetrying: false,
    completedAt: null,
    reasonCode: null,
    failureReason: null,
    liveDownloadId: null,
    liveQueueId: null,
    progress: null,
    queuedManualSelection: persistManualSelection(selection),
    queueStatus: manualSelectionQueuedStatus,
    status: 'queued',
    validationSummary: selection.selection.decision.reason,
  });
  if (!resumed.updated || !resumed.job) {
    throw new Error(manualReleaseConflictMessage(resumed.job ?? job));
  }

  getAcquisitionRunner().enqueue(resumed.job.id);
  return {
    job: resumed.job,
    message: `${replacingQueuedSelection ? 'Updated' : 'Queued'} manual release ${selection.selectedRelease?.title ?? guid}.`,
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
  if (isTerminalJobStatus(job.status)) {
    throw new Error('This queue entry is no longer current. Refresh the queue and try again.');
  }

  const queueItemsByIdentity = await findManagedQueueItemsForIdentity(job);
  const managedQueueItems =
    queueItemsByIdentity.length > 0
      ? queueItemsByIdentity
      : await findManagedQueueItemsForTarget(job);
  assertManagedQueueItemsCancelable(managedQueueItems);
  const deletedQueueEntries = await deleteQueueEntries(
    job.sourceService,
    queueIdsFromItems(managedQueueItems),
  );
  await unmonitorTrackedItem(job.sourceService, job.arrItemId);
  const cancelled = getAcquisitionLifecycle().cancelJob(job);

  return {
    job: cancelled,
    message: managedCancelMessage(job, deletedQueueEntries),
  };
}

async function cancelExternalQueueItem(
  item: Pick<QueueItem, 'arrItemId' | 'downloadId' | 'id' | 'queueId' | 'sourceService' | 'title'>,
): Promise<QueueActionResponse> {
  if (item.queueId === null && !item.downloadId) {
    throw new Error('This download cannot be cancelled.');
  }

  const currentQueueItem = await requireCurrentExternalQueueItem(item.sourceService, {
    downloadId: item.downloadId ?? null,
    queueId: item.queueId,
  });
  assertCancelableExternalQueueItem(currentQueueItem);
  const queueId = assertExternalQueueItemHasQueueId(currentQueueItem, 'cancelled');

  await deleteQueueEntries(item.sourceService, [queueId]);

  return {
    itemId: item.id,
    message: `${quoteTitle(item.title)} download was cancelled.`,
  };
}

export async function cancelQueueEntry(entry: QueueCancelRequest): Promise<QueueActionResponse> {
  if (entry.kind === 'managed') {
    const job = getAcquisitionJobRepository().getJob(entry.jobId);
    if (!job) {
      throw new Error('This queue entry is no longer current. Refresh the queue and try again.');
    }

    const result = await cancelAcquisitionJob(entry.jobId);
    return {
      itemId: entry.jobId,
      message: result.message,
    };
  }

  return cancelExternalQueueItem({
    arrItemId: entry.arrItemId,
    downloadId: entry.downloadId ?? null,
    id: entry.id,
    queueId: entry.queueId,
    sourceService: entry.sourceService,
    title: entry.title,
  });
}

export async function deleteArrItem(item: ArrDeleteTarget): Promise<MediaItemActionResponse> {
  invalidateQueueCache();
  if (item.deleteMode === 'queue-entry') {
    if (item.queueId === null && !item.downloadId) {
      throw new Error('This queue entry is no longer current. Refresh the queue and try again.');
    }

    const currentQueueItem = await requireCurrentExternalQueueItem(item.sourceService, {
      downloadId: item.downloadId ?? null,
      queueId: item.queueId,
    });
    assertRemovableExternalQueueItem(currentQueueItem);
    const queueId = assertExternalQueueItemHasQueueId(currentQueueItem, 'cleared');
    const serviceLabel = item.sourceService === 'radarr' ? 'Radarr' : 'Sonarr';
    await deleteQueueEntries(item.sourceService, [queueId]);
    return {
      itemId: item.id,
      message: `${quoteTitle(item.title)} stale queue entry was removed from ${serviceLabel}.`,
    };
  }

  const jobs =
    getAcquisitionJobRepository().listActiveJobsByArrItem(
      item.arrItemId,
      item.kind,
      item.sourceService,
    );
  const serviceLabel = item.sourceService === 'radarr' ? 'Radarr' : 'Sonarr';
  const queueItems = await findQueueItemsForArrItem(item.sourceService, item.arrItemId);
  const queueIds = assertQueueItemsHaveQueueIds(queueItems, 'cleared');
  await deleteQueueEntries(item.sourceService, queueIds);

  for (const job of jobs) {
    getAcquisitionLifecycle().cancelJob(job, 'Deleted from Arr by user');
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
      message: `${quoteTitle(item.title)} was already missing from ${serviceLabel}, and the stale queue entry was cleared.`,
    };
  }

  getAcquisitionJobRepository().deleteJobsByArrItem(item.arrItemId, item.kind, item.sourceService);

  return {
    itemId: item.id,
    message: `${quoteTitle(item.title)} was deleted from ${serviceLabel} and its files were removed.`,
  };
}
