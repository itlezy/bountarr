import { arrFetch } from '$lib/server/arr-client';
import { fetchQueueRecords } from '$lib/server/acquisition-validator-shared';
import { dashboardCache, queueCache } from '$lib/server/app-cache';
import { isTerminalJobStatus, type ArrService } from '$lib/server/acquisition-domain';
import { getAcquisitionJobRepository } from '$lib/server/acquisition-job-repository';
import { ensureAcquisitionWorkers, getQueueAcquisitionJobs } from '$lib/server/acquisition-service';
import { itemMatchKeys, itemSearchTitles } from '$lib/server/media-identity';
import { fetchExistingMovie, fetchExistingSeries } from '$lib/server/lookup-service';
import { mergeItems, normalizeItem } from '$lib/server/media-normalize';
import { getRecentPlexItems, searchPlex } from '$lib/server/plex-service';
import { buildManagedLiveSummary } from '$lib/server/queue-live-summary';
import { externalQueueEntryCapabilities } from '$lib/server/queue-entry-capabilities';
import {
  bestQueueIdentityCandidate,
  queueItemMatchesManagedIdentity,
  queueItemMatchesManagedTarget,
} from '$lib/server/queue-matching';
import { normalizeQueueItem } from '$lib/server/queue-normalize';
import { asNumber, asRecord, asRecordsArray, asString } from '$lib/server/raw';
import { getConfiguredServiceFlags } from '$lib/server/runtime';
import { sanitizePreferences } from '$lib/shared/preferences';
import { managedQueueEntryCapabilities } from '$lib/shared/queue-entry-capabilities';
import type {
  AcquisitionJob,
  AuditStatus,
  DashboardResponse,
  ExternalQueueEntry,
  MediaItem,
  ManagedQueueEntry,
  QueueEntry,
  Preferences,
  QueueItem,
  QueueResponse,
} from '$lib/shared/types';

function queueItemEntryId(item: QueueItem): string {
  return item.id;
}

function summarizeDashboard(items: MediaItem[]) {
  return {
    total: items.length,
    verified: items.filter((item) => item.auditStatus === 'verified').length,
    pending: items.filter(
      (item) => item.auditStatus === 'pending' || item.auditStatus === 'unknown',
    ).length,
    attention: items.filter(
      (item) =>
        item.auditStatus === 'missing-language' ||
        item.auditStatus === 'no-subs' ||
        item.auditStatus === 'not-found',
    ).length,
  };
}

function acquisitionTimeMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function newestAcquiredAt(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  const leftTime = acquisitionTimeMs(left);
  const rightTime = acquisitionTimeMs(right);
  if (leftTime === 0 && rightTime === 0) {
    return left ?? right ?? null;
  }

  return leftTime >= rightTime ? (left ?? null) : (right ?? null);
}

function arrHistoryAcquiredAt(record: Record<string, unknown>): string | null {
  return asString(record.date) ?? asString(record.eventDate) ?? asString(record.added) ?? null;
}

const acquisitionDashboardWindowMs = 7 * 24 * 60 * 60 * 1000;

function acquisitionJobAcquiredAt(job: AcquisitionJob): string | null {
  return job.completedAt ?? job.updatedAt ?? job.startedAt ?? null;
}

function acquisitionAuditStatus(job: AcquisitionJob): AuditStatus {
  switch (job.reasonCode) {
    case 'validated':
      return 'verified';
    case 'missing-audio':
      return 'missing-language';
    case 'missing-subs':
      return 'no-subs';
    case 'crashed':
    case 'download-failed':
    case 'import-blocked':
    case 'import-timeout':
    case 'manual-selection-lost':
    case 'no-acceptable-release':
      return 'unknown';
    case 'no-release-available':
      return 'not-found';
    default:
      return 'pending';
  }
}

function recentAcquisitionCheckJobs(nowMs = Date.now()): AcquisitionJob[] {
  const cutoffMs = nowMs - acquisitionDashboardWindowMs;
  const jobsByItem = new Map<string, AcquisitionJob>();

  for (const job of getAcquisitionJobRepository().listJobs()) {
    if (job.status === 'cancelled') {
      continue;
    }

    const acquiredAt = acquisitionJobAcquiredAt(job);
    const acquiredAtMs = acquisitionTimeMs(acquiredAt);
    if (acquiredAtMs === 0 || acquiredAtMs < cutoffMs) {
      continue;
    }

    const key = `${job.sourceService}:${job.kind}:${job.arrItemId}`;
    const existing = jobsByItem.get(key);
    if (!existing || acquiredAtMs > acquisitionTimeMs(acquisitionJobAcquiredAt(existing))) {
      jobsByItem.set(key, job);
    }
  }

  return [...jobsByItem.values()].sort(
    (left, right) =>
      acquisitionTimeMs(acquisitionJobAcquiredAt(right)) -
      acquisitionTimeMs(acquisitionJobAcquiredAt(left)),
  );
}

async function buildAcquisitionHistoryItems(preferences: Preferences): Promise<MediaItem[]> {
  const items: MediaItem[] = [];

  for (const job of recentAcquisitionCheckJobs()) {
    const acquiredAt = acquisitionJobAcquiredAt(job);
    const detail = job.currentRelease ?? job.validationSummary ?? job.failureReason;

    try {
      const item =
        job.kind === 'movie'
          ? await fetchExistingMovie(job.arrItemId, preferences)
          : await fetchExistingSeries(job.arrItemId, preferences, null, detail ?? job.title);
      items.push({
        ...item,
        acquiredAt: acquiredAt ?? item.acquiredAt ?? null,
        detail: item.detail ?? detail ?? null,
      });
    } catch {
      items.push(
        normalizeItem(job.kind, {}, preferences, {
          acquiredAt,
          arrItemId: job.arrItemId,
          auditStatus: acquisitionAuditStatus(job),
          canAdd: false,
          detail,
          id: `acquisition:${job.id}`,
          inArr: true,
          isExisting: true,
          isRequested: true,
          requestPayload: {
            acquisitionJobId: job.id,
            currentRelease: job.currentRelease,
            reasonCode: job.reasonCode,
            status: job.status,
          },
          sourceService: job.sourceService,
          status: job.status === 'completed' ? 'Downloaded' : job.status,
          title: job.title,
        }),
      );
    }
  }

  return items;
}

async function buildMovieHistoryItems(preferences: Preferences): Promise<MediaItem[]> {
  if (!getConfiguredServiceFlags().radarrConfigured) {
    return [];
  }

  const [history, queue] = await Promise.all([
    arrFetch<unknown>('radarr', '/api/v3/history', undefined, {
      pageSize: 8,
      page: 1,
      sortKey: 'date',
      sortDirection: 'descending',
    })
      .then(asRecordsArray)
      .catch(() => []),
    arrFetch<unknown>('radarr', '/api/v3/queue', undefined, {
      pageSize: 5,
      page: 1,
      sortKey: 'timeleft',
      sortDirection: 'ascending',
    })
      .then(asRecordsArray)
      .catch(() => []),
  ]);

  const items: MediaItem[] = [];

  for (const entry of queue) {
    const record = asRecord(entry);
    const queueItem = normalizeQueueItem('radarr', record);
    if (!queueItem) {
      continue;
    }
    const movie = asRecord(record.movie);
    const movieId = queueItem.arrItemId;
    items.push(
      normalizeItem('movie', movie, preferences, {
        arrItemId: movieId ?? null,
        id: `movie:queue:${queueItem.id}`,
        title: queueItem.title,
        year: queueItem.year,
        poster: queueItem.poster,
        status: queueItem.status,
        isExisting: true,
        isRequested: true,
        auditStatus: 'pending',
        acquiredAt: queueItem.addedAt,
        detail: queueItem.detail,
        inArr: true,
        canAdd: false,
        requestPayload: Object.keys(movie).length > 0 ? movie : record,
      }),
    );
  }

  for (const entry of history) {
    const record = asRecord(entry);
    const movieId = asNumber(record.movieId);
    if (!movieId) {
      continue;
    }

    try {
      const acquiredAt = arrHistoryAcquiredAt(record);
      const item = await fetchExistingMovie(movieId, preferences);
      items.push({ ...item, acquiredAt: acquiredAt ?? item.acquiredAt ?? null });
    } catch {
      const movie = asRecord(record.movie);
      items.push(
        normalizeItem('movie', movie, preferences, {
          acquiredAt: arrHistoryAcquiredAt(record),
          arrItemId: movieId,
          id: `movie:history:${movieId}`,
          detail: asString(record.sourceTitle),
          isExisting: true,
          isRequested: true,
          inArr: true,
          canAdd: false,
        }),
      );
    }
  }

  return items;
}

async function buildSeriesHistoryItems(preferences: Preferences): Promise<MediaItem[]> {
  if (!getConfiguredServiceFlags().sonarrConfigured) {
    return [];
  }

  const [history, queue] = await Promise.all([
    arrFetch<unknown>('sonarr', '/api/v3/history', undefined, {
      pageSize: 8,
      page: 1,
      sortKey: 'date',
      sortDirection: 'descending',
    })
      .then(asRecordsArray)
      .catch(() => []),
    arrFetch<unknown>('sonarr', '/api/v3/queue', undefined, {
      pageSize: 5,
      page: 1,
      sortKey: 'timeleft',
      sortDirection: 'ascending',
    })
      .then(asRecordsArray)
      .catch(() => []),
  ]);

  const items: MediaItem[] = [];

  for (const entry of queue) {
    const record = asRecord(entry);
    const queueItem = normalizeQueueItem('sonarr', record);
    if (!queueItem) {
      continue;
    }
    const series = asRecord(record.series);
    const episode = asRecord(record.episode);
    const seriesId = queueItem.arrItemId;
    items.push(
      normalizeItem('series', series, preferences, {
        arrItemId: seriesId ?? null,
        id: `series:queue:${queueItem.id}`,
        title: queueItem.title,
        year: queueItem.year,
        poster: queueItem.poster,
        status: queueItem.status,
        isExisting: true,
        isRequested: true,
        auditStatus: 'pending',
        acquiredAt: queueItem.addedAt,
        detail: queueItem.detail ?? asString(episode.title),
        inArr: true,
        canAdd: false,
        requestPayload: Object.keys(series).length > 0 ? series : record,
      }),
    );
  }

  for (const entry of history) {
    const record = asRecord(entry);
    const seriesId = asNumber(record.seriesId);
    if (!seriesId) {
      continue;
    }

    const data = asRecord(record.data);
    const episodeFileId = asNumber(record.episodeFileId) ?? asNumber(data.episodeFileId);

    try {
      const acquiredAt = arrHistoryAcquiredAt(record);
      const item = await fetchExistingSeries(
        seriesId,
        preferences,
        episodeFileId,
        asString(record.sourceTitle) ?? asString(asRecord(record.episode).title),
      );
      items.push({
        ...item,
        acquiredAt: acquiredAt ?? item.acquiredAt ?? null,
      });
    } catch {
      const series = asRecord(record.series);
      items.push(
        normalizeItem('series', series, preferences, {
          acquiredAt: arrHistoryAcquiredAt(record),
          arrItemId: seriesId,
          id: `series:history:${seriesId}:${episodeFileId ?? crypto.randomUUID()}`,
          detail: asString(record.sourceTitle) ?? asString(asRecord(record.episode).title),
          isExisting: true,
          isRequested: true,
          inArr: true,
          canAdd: false,
        }),
      );
    }
  }

  return items;
}

function dedupeItems(items: MediaItem[]): MediaItem[] {
  const map = new Map<string, MediaItem>();

  const itemKey = (item: MediaItem): string =>
    item.arrItemId !== null && item.arrItemId !== undefined
      ? `arr:${item.kind}:${item.arrItemId}`
      : `${item.kind}:${item.title}:${item.detail ?? ''}`;

  const itemRank = (item: MediaItem): number => {
    const payloadSize = Object.keys(asRecord(item.requestPayload)).length;
    let score = 0;

    if (!item.id.includes(':queue:')) {
      score += 4;
    }
    if (item.title !== 'Untitled') {
      score += 2;
    }
    if (payloadSize > 0) {
      score += 2;
    }
    if (item.poster) {
      score += 1;
    }
    if (item.auditStatus !== 'pending') {
      score += 1;
    }

    return score;
  };

  for (const item of items) {
    const key = itemKey(item);
    const existing = map.get(key);
    if (!existing || itemRank(item) > itemRank(existing)) {
      map.set(key, {
        ...item,
        acquiredAt: newestAcquiredAt(item.acquiredAt, existing?.acquiredAt),
      });
    } else if (acquisitionTimeMs(item.acquiredAt) > acquisitionTimeMs(existing.acquiredAt)) {
      map.set(key, {
        ...existing,
        acquiredAt: item.acquiredAt ?? existing.acquiredAt ?? null,
      });
    }
  }

  return [...map.values()];
}

async function mergeDashboardPlexItems(items: MediaItem[]): Promise<MediaItem[]> {
  if (!getConfiguredServiceFlags().plexConfigured || items.length === 0) {
    return items;
  }

  const recentPlexItems = await getRecentPlexItems(Math.max(12, items.length));
  const findPlexMatch = (item: MediaItem, candidates: MediaItem[]): MediaItem | null => {
    const matchKeys = new Set(itemMatchKeys(item));
    return (
      candidates.find(
        (plexItem) =>
          plexItem.kind === item.kind && itemMatchKeys(plexItem).some((key) => matchKeys.has(key)),
      ) ?? null
    );
  };

  const mergedRecentItems = items.map((item) => {
    const plexMatch = findPlexMatch(item, recentPlexItems);
    return plexMatch ? mergeItems(item, plexMatch) : item;
  });

  const unresolvedItems = mergedRecentItems.filter((item) => !item.inPlex);
  if (unresolvedItems.length === 0) {
    return mergedRecentItems;
  }

  const searchQueries = [
    ...new Map(
      unresolvedItems.flatMap((item) =>
        itemSearchTitles(item)
          .map((title) => title.trim())
          .filter((title) => title.length >= 2)
          .map((title) => [`${item.kind}:${title}`, { kind: item.kind, title }] as const),
      ),
    ).values(),
  ];
  const searchedPlexItems = (
    await Promise.all(searchQueries.map((query) => searchPlex(query.title, query.kind)))
  ).flat();
  if (searchedPlexItems.length === 0) {
    return mergedRecentItems;
  }

  return mergedRecentItems.map((item) => {
    if (item.inPlex) {
      return item;
    }

    const plexMatch = findPlexMatch(item, searchedPlexItems);
    return plexMatch ? mergeItems(item, plexMatch) : item;
  });
}

async function buildQueueItems(service: ArrService): Promise<QueueItem[]> {
  const flags = getConfiguredServiceFlags();
  if (!flags[service === 'radarr' ? 'radarrConfigured' : 'sonarrConfigured']) {
    return [];
  }

  const records = await fetchQueueRecords(service);

  return records
    .map((record) => normalizeQueueItem(service, record))
    .filter((item): item is QueueItem => item !== null);
}

function buildManagedQueueEntry(
  job: AcquisitionJob,
  liveQueueItems: QueueItem[],
): ManagedQueueEntry {
  const liveSummary = buildManagedLiveSummary(liveQueueItems);
  const capabilities = managedQueueEntryCapabilities(job, liveQueueItems);
  return {
    kind: 'managed',
    id: job.id,
    job,
    liveQueueItems,
    liveSummary,
    canCancel: capabilities.canCancel,
    canRemove: capabilities.canRemove,
  };
}

function buildExternalQueueEntry(item: QueueItem): ExternalQueueEntry {
  const capabilities = externalQueueEntryCapabilities(item);
  return {
    kind: 'external',
    id: queueItemEntryId(item),
    item,
    canCancel: capabilities.canCancel,
    canRemove: capabilities.canRemove,
  };
}

function enrichQueueItemsWithManagedTitles(
  acquisitionJobs: AcquisitionJob[],
  items: QueueItem[],
): QueueItem[] {
  return items.map((item) => {
    const matchingJob =
      acquisitionJobs.find((job) => queueItemMatchesManagedTarget(job, item)) ?? null;
    if (!matchingJob || item.title === matchingJob.title) {
      return item;
    }

    return {
      ...item,
      title: matchingJob.title,
      detail: item.detail ?? item.title,
    };
  });
}

function queueEntryTitle(entry: QueueEntry): string {
  return entry.kind === 'managed' ? entry.job.title : entry.item.title;
}

function queueEntryAcquiredAt(entry: QueueEntry): number {
  if (entry.kind === 'managed') {
    return acquisitionTimeMs(entry.job.startedAt);
  }

  return acquisitionTimeMs(entry.item.addedAt);
}

function liveQueueItemsForManagedJob(job: AcquisitionJob, items: QueueItem[]): QueueItem[] {
  if (isTerminalJobStatus(job.status)) {
    return [];
  }

  if (job.kind === 'movie') {
    const matched = bestQueueIdentityCandidate(job, items);
    return matched ? [matched] : [];
  }

  const identityMatches = items.filter((item) => queueItemMatchesManagedIdentity(job, item));
  const remainingItems =
    identityMatches.length === 0 ? items : items.filter((item) => !identityMatches.includes(item));
  const scopeMatches = remainingItems.filter((item) => queueItemMatchesManagedTarget(job, item));
  return [...identityMatches, ...scopeMatches];
}

function claimManagedQueueIdentities(
  acquisitionJobs: AcquisitionJob[],
  items: QueueItem[],
): AcquisitionJob[] {
  const jobs = getAcquisitionJobRepository();
  let updated = false;
  const nextJobs = acquisitionJobs.map((job) => {
    if (isTerminalJobStatus(job.status)) {
      return job;
    }

    const claimedItem = bestQueueIdentityCandidate(job, items);
    if (!claimedItem) {
      return job;
    }

    const nextQueueId = claimedItem.queueId ?? null;
    const nextDownloadId = claimedItem.downloadId ?? null;
    if (nextQueueId === null && nextDownloadId === null) {
      return job;
    }

    if (
      (job.liveQueueId ?? null) === nextQueueId &&
      (job.liveDownloadId ?? null) === nextDownloadId
    ) {
      return job;
    }

    const persisted = jobs.updateJob(job.id, {
      liveDownloadId: nextDownloadId,
      liveQueueId: nextQueueId,
    });
    updated = true;
    return persisted;
  });

  return updated ? nextJobs : acquisitionJobs;
}

export function composeQueueEntries(
  acquisitionJobs: AcquisitionJob[],
  items: QueueItem[],
): QueueEntry[] {
  let unmatchedItems = enrichQueueItemsWithManagedTitles(acquisitionJobs, items);
  const managedEntries = acquisitionJobs.map((job) => {
    const liveQueueItems = liveQueueItemsForManagedJob(job, unmatchedItems);
    if (liveQueueItems.length > 0) {
      const matchedIds = new Set(liveQueueItems.map((item) => queueItemEntryId(item)));
      unmatchedItems = unmatchedItems.filter((item) => !matchedIds.has(queueItemEntryId(item)));
    }

    return buildManagedQueueEntry(job, liveQueueItems);
  });
  const externalEntries = unmatchedItems.map((item) => buildExternalQueueEntry(item));

  return [...managedEntries, ...externalEntries].sort((left, right) => {
    const acquisitionSort = queueEntryAcquiredAt(right) - queueEntryAcquiredAt(left);
    if (acquisitionSort !== 0) {
      return acquisitionSort;
    }

    return queueEntryTitle(left).localeCompare(queueEntryTitle(right));
  });
}

export async function getQueue(options?: { force?: boolean }): Promise<QueueResponse> {
  ensureAcquisitionWorkers();
  const cacheKey = 'queue';
  const now = Date.now();
  const cached = queueCache.get(cacheKey);

  if (!options?.force && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const items = (await Promise.all([buildQueueItems('radarr'), buildQueueItems('sonarr')])).flat();
  const acquisitionJobs = claimManagedQueueIdentities(getQueueAcquisitionJobs(), items);
  const entries = composeQueueEntries(acquisitionJobs, items);

  const value: QueueResponse = {
    updatedAt: new Date().toISOString(),
    entries,
    total: entries.length,
  };

  queueCache.set(cacheKey, { expiresAt: now + 15_000, value });
  return value;
}

export async function getDashboard(
  preferences?: Partial<Preferences>,
  options?: { force?: boolean },
): Promise<DashboardResponse> {
  const normalizedPreferences = sanitizePreferences(preferences);
  const cacheKey = JSON.stringify(normalizedPreferences);
  const now = Date.now();
  const cached = dashboardCache.get(cacheKey);

  if (!options?.force && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const recentArrItems = dedupeItems(
    (
      await Promise.all([
        buildAcquisitionHistoryItems(normalizedPreferences),
        buildMovieHistoryItems(normalizedPreferences),
        buildSeriesHistoryItems(normalizedPreferences),
      ])
    ).flat(),
  );
  const items = (await mergeDashboardPlexItems(recentArrItems))
    .sort((left, right) => {
      const acquisitionSort =
        acquisitionTimeMs(right.acquiredAt) - acquisitionTimeMs(left.acquiredAt);
      if (acquisitionSort !== 0) {
        return acquisitionSort;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, 14);

  const value: DashboardResponse = {
    updatedAt: new Date().toISOString(),
    items,
    summary: summarizeDashboard(items),
  };

  dashboardCache.set(cacheKey, { expiresAt: now + 30_000, value });
  return value;
}
