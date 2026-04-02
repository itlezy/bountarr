import { arrFetch } from '$lib/server/arr-client';
import { dashboardCache, queueCache } from '$lib/server/app-cache';
import type { ArrService } from '$lib/server/acquisition-domain';
import { ensureAcquisitionWorkers, getQueueAcquisitionJobs } from '$lib/server/acquisition-service';
import { fetchExistingMovie, fetchExistingSeries } from '$lib/server/lookup-service';
import { normalizeItem } from '$lib/server/media-normalize';
import { normalizeQueueItem } from '$lib/server/queue-normalize';
import { asNumber, asRecord, asRecordsArray, asString } from '$lib/server/raw';
import { getConfiguredServiceFlags } from '$lib/server/runtime';
import { sanitizePreferences } from '$lib/shared/preferences';
import type {
  DashboardResponse,
  MediaItem,
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

  const records = await arrFetch<unknown>(service, '/api/v3/queue', undefined, {
    pageSize: 25,
    page: 1,
    sortKey: 'timeleft',
    sortDirection: 'ascending',
  })
    .then(asRecordsArray)
    .catch(() => []);

  return records
    .map((record) => normalizeQueueItem(service, record))
    .filter((item): item is QueueItem => item !== null);
}

export async function getQueue(options?: { force?: boolean }): Promise<QueueResponse> {
  ensureAcquisitionWorkers();
  const cacheKey = 'queue';
  const now = Date.now();
  const cached = queueCache.get(cacheKey);

  if (!options?.force && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const items = (await Promise.all([buildQueueItems('radarr'), buildQueueItems('sonarr')]))
    .flat()
    .sort((left, right) => {
      const leftProgress = left.progress ?? 0;
      const rightProgress = right.progress ?? 0;
      if (leftProgress !== rightProgress) {
        return rightProgress - leftProgress;
      }

      return left.title.localeCompare(right.title);
    });

  const acquisitionJobs = getQueueAcquisitionJobs();

  const value: QueueResponse = {
    updatedAt: new Date().toISOString(),
    items,
    acquisitionJobs,
    total: items.length + acquisitionJobs.length,
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
