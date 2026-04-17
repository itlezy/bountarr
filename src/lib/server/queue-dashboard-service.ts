import { arrFetch } from '$lib/server/arr-client';
import { fetchQueueRecords } from '$lib/server/acquisition-validator-shared';
import { dashboardCache, queueCache } from '$lib/server/app-cache';
import { isTerminalJobStatus, type ArrService } from '$lib/server/acquisition-domain';
import { ensureAcquisitionWorkers, getQueueAcquisitionJobs } from '$lib/server/acquisition-service';
import { fetchExistingMovie, fetchExistingSeries } from '$lib/server/lookup-service';
import { normalizeItem } from '$lib/server/media-normalize';
import { buildManagedLiveSummary } from '$lib/server/queue-live-summary';
import { normalizeQueueItem } from '$lib/server/queue-normalize';
import { asNumber, asRecord, asRecordsArray, asString } from '$lib/server/raw';
import { getConfiguredServiceFlags } from '$lib/server/runtime';
import { sanitizePreferences } from '$lib/shared/preferences';
import type {
  AcquisitionJob,
  DashboardResponse,
  ExternalQueueEntry,
  MediaItem,
  ManagedQueueEntry,
  QueueEntry,
  Preferences,
  QueueItem,
  QueueResponse,
} from '$lib/shared/types';

function summarizeDashboard(items: MediaItem[]) {
  return {
    total: items.length,
    verified: items.filter((item) => item.auditStatus === 'verified').length,
    pending: items.filter(
      (item) => item.auditStatus === 'pending' || item.auditStatus === 'unknown',
    ).length,
    attention: items.filter(
      (item) => item.auditStatus === 'missing-language' || item.auditStatus === 'no-subs',
    ).length,
  };
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
    const movie = asRecord(record.movie);
    const movieId = asNumber(record.movieId) ?? asNumber(movie.id);
    items.push(
      normalizeItem('movie', movie, preferences, {
        arrItemId: movieId ?? null,
        id: `movie:queue:${asString(record.downloadId) ?? crypto.randomUUID()}`,
        status: 'Queued',
        isExisting: true,
        isRequested: true,
        auditStatus: 'pending',
        inArr: true,
        canAdd: false,
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
      items.push(await fetchExistingMovie(movieId, preferences));
    } catch {
      const movie = asRecord(record.movie);
      items.push(
        normalizeItem('movie', movie, preferences, {
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
    const series = asRecord(record.series);
    const episode = asRecord(record.episode);
    const seriesId = asNumber(record.seriesId) ?? asNumber(series.id);
    items.push(
      normalizeItem('series', series, preferences, {
        arrItemId: seriesId ?? null,
        id: `series:queue:${asString(record.downloadId) ?? crypto.randomUUID()}`,
        status: 'Queued',
        isExisting: true,
        isRequested: true,
        auditStatus: 'pending',
        detail: asString(episode.title),
        inArr: true,
        canAdd: false,
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
      items.push(
        await fetchExistingSeries(
          seriesId,
          preferences,
          episodeFileId,
          asString(record.sourceTitle) ?? asString(asRecord(record.episode).title),
        ),
      );
    } catch {
      const series = asRecord(record.series);
      items.push(
        normalizeItem('series', series, preferences, {
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

  for (const item of items) {
    const key = `${item.kind}:${item.title}:${item.detail ?? ''}`;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return [...map.values()];
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

function arrIdentityKey(
  value: Pick<QueueItem | AcquisitionJob, 'arrItemId' | 'sourceService'>,
): string | null {
  return value.arrItemId === null ? null : `${value.sourceService}:${value.arrItemId}`;
}

function buildManagedQueueEntry(
  job: AcquisitionJob,
  liveQueueItems: QueueItem[],
): ManagedQueueEntry {
  const liveSummary = buildManagedLiveSummary(liveQueueItems);
  return {
    kind: 'managed',
    id: job.id,
    job,
    liveQueueItems,
    liveSummary,
    canCancel:
      !isTerminalJobStatus(job.status) ||
      liveQueueItems.some((item) => item.canCancel && item.queueId !== null),
    canRemove: true,
  };
}

function buildExternalQueueEntry(item: QueueItem): ExternalQueueEntry {
  return {
    kind: 'external',
    id: item.id,
    item,
    canCancel: item.canCancel && item.queueId !== null,
    canRemove: item.arrItemId !== null || item.queueId !== null,
  };
}

function queueEntryTitle(entry: QueueEntry): string {
  return entry.kind === 'managed' ? entry.job.title : entry.item.title;
}

function queueEntryProgress(entry: QueueEntry): number {
  const progress =
    entry.kind === 'managed'
      ? (entry.liveSummary?.progress ?? entry.job.progress)
      : entry.item.progress;
  return progress ?? -1;
}

function queueEntryUpdatedAt(entry: QueueEntry): number {
  if (entry.kind === 'managed') {
    return Date.parse(entry.job.updatedAt);
  }

  return -1;
}

export function composeQueueEntries(
  acquisitionJobs: AcquisitionJob[],
  items: QueueItem[],
): QueueEntry[] {
  const itemsByIdentity = new Map<string, QueueItem[]>();
  for (const item of items) {
    const key = arrIdentityKey(item);
    if (!key) {
      continue;
    }

    const existing = itemsByIdentity.get(key) ?? [];
    existing.push(item);
    itemsByIdentity.set(key, existing);
  }

  const consumedIdentities = new Set<string>();
  const matchedItemIds = new Set<string>();
  const managedEntries = acquisitionJobs.map((job) => {
    const key = arrIdentityKey(job);
    const liveQueueItems =
      key && !consumedIdentities.has(key) ? (itemsByIdentity.get(key) ?? []) : [];
    if (key) {
      consumedIdentities.add(key);
    }
    for (const item of liveQueueItems) {
      matchedItemIds.add(item.id);
    }
    return buildManagedQueueEntry(job, liveQueueItems);
  });
  const externalEntries = items
    .filter((item) => !matchedItemIds.has(item.id))
    .map((item) => buildExternalQueueEntry(item));

  return [...managedEntries, ...externalEntries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'managed' ? -1 : 1;
    }

    const progressSort = queueEntryProgress(right) - queueEntryProgress(left);
    if (progressSort !== 0) {
      return progressSort;
    }

    const recencySort = queueEntryUpdatedAt(right) - queueEntryUpdatedAt(left);
    if (recencySort !== 0) {
      return recencySort;
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

  const acquisitionJobs = getQueueAcquisitionJobs();
  const items = (await Promise.all([buildQueueItems('radarr'), buildQueueItems('sonarr')])).flat();
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

  const items = dedupeItems(
    (
      await Promise.all([
        buildMovieHistoryItems(normalizedPreferences),
        buildSeriesHistoryItems(normalizedPreferences),
      ])
    )
      .flat()
      .sort((left, right) => {
        const attentionScore = (item: MediaItem) =>
          item.auditStatus === 'missing-language' || item.auditStatus === 'no-subs'
            ? 0
            : item.auditStatus === 'pending'
              ? 1
              : item.auditStatus === 'unknown'
                ? 2
                : 3;

        const statusSort = attentionScore(left) - attentionScore(right);
        if (statusSort !== 0) {
          return statusSort;
        }

        return left.title.localeCompare(right.title);
      })
      .slice(0, 14),
  );

  const value: DashboardResponse = {
    updatedAt: new Date().toISOString(),
    items,
    summary: summarizeDashboard(items),
  };

  dashboardCache.set(cacheKey, { expiresAt: now + 30_000, value });
  return value;
}
