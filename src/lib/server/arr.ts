import { env } from '$env/dynamic/private';
import { evaluateAudit } from '$lib/server/audit';
import { sanitizePreferences } from '$lib/shared/preferences';
import type {
  ConfigStatus,
  DashboardResponse,
  MediaItem,
  MediaKind,
  Preferences,
  SearchKind
} from '$lib/shared/types';

type ArrService = 'radarr' | 'sonarr';

type ServiceConfig = {
  apiKey: string;
  baseUrl: string;
};

type CacheEntry = {
  expiresAt: number;
  value: DashboardResponse;
};

const dashboardCache = new Map<string, CacheEntry>();
const defaultsCache = new Map<string, { expiresAt: number; value: Record<string, unknown> }>();

function getServiceConfig(service: ArrService): ServiceConfig | null {
  const baseUrl = (service === 'radarr' ? env.RADARR_URL : env.SONARR_URL)?.trim();
  const apiKey = (service === 'radarr' ? env.RADARR_API_KEY : env.SONARR_API_KEY)?.trim();

  if (!baseUrl || !apiKey) {
    return null;
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey
  };
}

export function getConfigStatus(): ConfigStatus {
  const radarrConfigured = getServiceConfig('radarr') !== null;
  const sonarrConfigured = getServiceConfig('sonarr') !== null;

  return {
    radarrConfigured,
    sonarrConfigured,
    configured: radarrConfigured || sonarrConfigured
  };
}

function ensureConfigured(service: ArrService): ServiceConfig {
  const config = getServiceConfig(service);

  if (!config) {
    throw new Error(`${service} is not configured`);
  }

  return config;
}

async function arrFetch<T>(
  service: ArrService,
  path: string,
  init?: RequestInit,
  query?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const config = ensureConfigured(service);
  const url = new URL(`${config.baseUrl}${path}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = new Headers(init?.headers);
  headers.set('X-Api-Key', config.apiKey);

  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    headers
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${service} ${response.status}: ${errorBody || response.statusText}`);
  }

  return (await response.json()) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecordsArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  return asArray(asRecord(value).records);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatLabel(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractPoster(raw: Record<string, unknown>): string | null {
  const images = asArray(raw.images);

  for (const image of images) {
    const record = asRecord(image);
    if (asString(record.coverType) === 'poster') {
      return asString(record.remoteUrl) ?? asString(record.url);
    }
  }

  return null;
}

function normalizeLanguageEntries(value: unknown): string[] {
  const directString = asString(value);
  if (directString) {
    return directString
      .split(/[\/,]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  const entries = asArray(value);
  const languages = new Set<string>();

  for (const entry of entries) {
    const record = asRecord(entry);
    const candidate =
      asString(record.name) ??
      asString(record.displayName) ??
      asString(record.language) ??
      asString(record.value) ??
      asString(entry);

    if (candidate) {
      languages.add(candidate);
    }
  }

  return [...languages];
}

function mediaInfoFromItem(raw: Record<string, unknown>): Record<string, unknown> | null {
  const direct = asRecord(raw.mediaInfo);
  if (Object.keys(direct).length > 0) {
    return direct;
  }

  const movieFile = asRecord(raw.movieFile);
  const episodeFile = asRecord(raw.episodeFile);

  if (Object.keys(asRecord(movieFile.mediaInfo)).length > 0) {
    return asRecord(movieFile.mediaInfo);
  }

  if (Object.keys(asRecord(episodeFile.mediaInfo)).length > 0) {
    return asRecord(episodeFile.mediaInfo);
  }

  return null;
}

function buildStatus(raw: Record<string, unknown>, isExisting: boolean): string {
  if (raw.trackedDownloadState === 'warning') {
    return 'Attention needed';
  }

  if (raw.trackedDownloadStatus === 'ok' || raw.status === 'completed' || raw.hasFile === true) {
    return 'Downloaded';
  }

  if (raw.status === 'queued' || raw.downloadId || raw.sizeleft !== undefined) {
    return 'Queued';
  }

  if (raw.monitored === true && isExisting) {
    return 'Monitored';
  }

  const explicitStatus = asString(raw.status) ?? asString(raw.eventType);
  if (explicitStatus) {
    return formatLabel(explicitStatus);
  }

  return isExisting ? 'Existing' : 'Ready to request';
}

function normalizeItem(
  kind: MediaKind,
  rawValue: unknown,
  preferences: Preferences,
  fallback: Partial<MediaItem> = {}
): MediaItem {
  const raw = asRecord(rawValue);
  const mediaInfo = mediaInfoFromItem(raw);
  const audioLanguages = normalizeLanguageEntries(mediaInfo?.audioLanguages);
  const subtitleLanguages = normalizeLanguageEntries(mediaInfo?.subtitles ?? mediaInfo?.subtitleLanguages);
  const hasMediaInfo = mediaInfo !== null;
  const isExisting = Boolean(raw.id) || raw.hasFile === true || raw.monitored === true || raw.path !== undefined;
  const fallbackId =
    fallback.id ??
    `${kind}:${asNumber(raw.tmdbId) ?? asNumber(raw.tvdbId) ?? asString(raw.titleSlug) ?? crypto.randomUUID()}`;

  let auditStatus = evaluateAudit(audioLanguages, subtitleLanguages, preferences, hasMediaInfo);
  if (!hasMediaInfo && !isExisting) {
    auditStatus = 'pending';
  }

  const title =
    asString(raw.title) ??
    asString(asRecord(raw.movie).title) ??
    asString(asRecord(raw.series).title) ??
    fallback.title ??
    'Untitled';

  return {
    id: fallbackId,
    kind,
    title,
    year: asNumber(raw.year) ?? fallback.year ?? null,
    poster: extractPoster(raw) ?? fallback.poster ?? null,
    overview: asString(raw.overview) ?? fallback.overview ?? '',
    status: fallback.status ?? buildStatus(raw, isExisting),
    isExisting: fallback.isExisting ?? isExisting,
    isRequested: fallback.isRequested ?? (isExisting || raw.monitored === true),
    auditStatus: fallback.auditStatus ?? auditStatus,
    audioLanguages,
    subtitleLanguages,
    sourceService: kind === 'movie' ? 'radarr' : 'sonarr',
    detail: fallback.detail ?? asString(raw.sourceTitle) ?? null,
    requestPayload: fallback.requestPayload ?? raw
  };
}

async function fetchDefaults(service: ArrService): Promise<Record<string, unknown>> {
  const cacheKey = `${service}:defaults`;
  const now = Date.now();
  const cached = defaultsCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (service === 'radarr') {
    const [rootFolders, qualityProfiles] = await Promise.all([
      arrFetch<unknown[]>('radarr', '/api/v3/rootfolder'),
      arrFetch<unknown[]>('radarr', '/api/v3/qualityprofile')
    ]);

    const value = {
      rootFolderPath: asString(asRecord(rootFolders[0]).path),
      qualityProfileId: asNumber(asRecord(qualityProfiles[0]).id)
    };

    defaultsCache.set(cacheKey, { expiresAt: now + 10 * 60_000, value });
    return value;
  }

  const [rootFolders, qualityProfiles, languageProfiles] = await Promise.all([
    arrFetch<unknown[]>('sonarr', '/api/v3/rootfolder'),
    arrFetch<unknown[]>('sonarr', '/api/v3/qualityprofile'),
    arrFetch<unknown[]>('sonarr', '/api/v3/languageprofile')
  ]);

  const value = {
    rootFolderPath: asString(asRecord(rootFolders[0]).path),
    qualityProfileId: asNumber(asRecord(qualityProfiles[0]).id),
    languageProfileId: asNumber(asRecord(languageProfiles[0]).id)
  };

  defaultsCache.set(cacheKey, { expiresAt: now + 10 * 60_000, value });
  return value;
}

async function fetchExistingMovie(id: number, preferences: Preferences): Promise<MediaItem> {
  const movie = await arrFetch<unknown>('radarr', `/api/v3/movie/${id}`);
  return normalizeItem('movie', movie, preferences, {
    id: `movie:${id}`
  });
}

async function fetchExistingSeries(
  id: number,
  preferences: Preferences,
  episodeFileId?: number | null,
  detail?: string | null
): Promise<MediaItem> {
  const series = asRecord(await arrFetch<unknown>('sonarr', `/api/v3/series/${id}`));

  if (episodeFileId) {
    const episodeFile = await arrFetch<unknown>('sonarr', `/api/v3/episodefile/${episodeFileId}`);
    return normalizeItem(
      'series',
      {
        ...series,
        episodeFile
      },
      preferences,
      {
        id: `series:${id}:${episodeFileId}`,
        detail: detail ?? null
      }
    );
  }

  return normalizeItem('series', series, preferences, {
    id: `series:${id}`,
    detail: detail ?? null
  });
}

export async function lookupItems(term: string, kind: SearchKind, preferences?: Partial<Preferences>) {
  const normalizedPreferences = sanitizePreferences(preferences);
  const status = getConfigStatus();
  const tasks: Promise<MediaItem[]>[] = [];

  if ((kind === 'all' || kind === 'movie') && status.radarrConfigured) {
    tasks.push(
      arrFetch<unknown[]>('radarr', '/api/v3/movie/lookup', undefined, { term }).then((items) =>
        items.map((item) =>
          normalizeItem('movie', item, normalizedPreferences, {
            id: `movie:${asNumber(asRecord(item).id) ?? asNumber(asRecord(item).tmdbId) ?? crypto.randomUUID()}`
          })
        )
      )
    );
  }

  if ((kind === 'all' || kind === 'series') && status.sonarrConfigured) {
    tasks.push(
      arrFetch<unknown[]>('sonarr', '/api/v3/series/lookup', undefined, { term }).then((items) =>
        items.map((item) =>
          normalizeItem('series', item, normalizedPreferences, {
            id: `series:${asNumber(asRecord(item).id) ?? asNumber(asRecord(item).tvdbId) ?? crypto.randomUUID()}`
          })
        )
      )
    );
  }

  const results = (await Promise.all(tasks)).flat();

  return results.sort((left, right) => {
    if (left.isExisting !== right.isExisting) {
      return Number(left.isExisting) - Number(right.isExisting);
    }

    return left.title.localeCompare(right.title);
  }).slice(0, 20);
}

function ensureRootFolder(defaults: Record<string, unknown>, service: ArrService): void {
  if (!asString(defaults.rootFolderPath)) {
    throw new Error(`No root folder is configured in ${service}`);
  }

  if (!asNumber(defaults.qualityProfileId)) {
    throw new Error(`No quality profile is configured in ${service}`);
  }

  if (service === 'sonarr' && !asNumber(defaults.languageProfileId)) {
    throw new Error('No language profile is configured in sonarr');
  }
}

export async function requestItem(
  item: MediaItem,
  preferences?: Partial<Preferences>
): Promise<{ existing: boolean; item: MediaItem; message: string }> {
  const normalizedPreferences = sanitizePreferences(preferences);

  if (item.kind === 'movie') {
    const sourceId = asNumber(asRecord(item.requestPayload).id);
    if (item.isExisting && sourceId) {
      return {
        existing: true,
        item: await fetchExistingMovie(sourceId, normalizedPreferences),
        message: `${item.title} is already tracked in Radarr`
      };
    }

    const defaults = await fetchDefaults('radarr');
    ensureRootFolder(defaults, 'radarr');

    const payload = {
      ...item.requestPayload,
      monitored: true,
      minimumAvailability: asString(asRecord(item.requestPayload).minimumAvailability) ?? 'released',
      rootFolderPath: asString(asRecord(item.requestPayload).rootFolderPath) ?? asString(defaults.rootFolderPath),
      qualityProfileId: asNumber(asRecord(item.requestPayload).qualityProfileId) ?? asNumber(defaults.qualityProfileId),
      addOptions: {
        searchForMovie: true
      }
    };

    const created = asRecord(
      await arrFetch<unknown>('radarr', '/api/v3/movie', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
    );

    return {
      existing: false,
      item: normalizeItem('movie', created, normalizedPreferences, {
        id: `movie:${asNumber(created.id) ?? crypto.randomUUID()}`
      }),
      message: `${item.title} was sent to Radarr`
    };
  }

  const sourceId = asNumber(asRecord(item.requestPayload).id);
  if (item.isExisting && sourceId) {
    return {
      existing: true,
      item: await fetchExistingSeries(sourceId, normalizedPreferences, null, item.detail),
      message: `${item.title} is already tracked in Sonarr`
    };
  }

  const defaults = await fetchDefaults('sonarr');
  ensureRootFolder(defaults, 'sonarr');

  const payload = {
    ...item.requestPayload,
    monitored: true,
    seasonFolder: asRecord(item.requestPayload).seasonFolder ?? true,
    rootFolderPath: asString(asRecord(item.requestPayload).rootFolderPath) ?? asString(defaults.rootFolderPath),
    qualityProfileId: asNumber(asRecord(item.requestPayload).qualityProfileId) ?? asNumber(defaults.qualityProfileId),
    languageProfileId: asNumber(asRecord(item.requestPayload).languageProfileId) ?? asNumber(defaults.languageProfileId),
    addOptions: {
      searchForMissingEpisodes: true,
      searchForCutoffUnmetEpisodes: false
    }
  };

  const created = asRecord(
    await arrFetch<unknown>('sonarr', '/api/v3/series', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  );

  return {
    existing: false,
    item: normalizeItem('series', created, normalizedPreferences, {
      id: `series:${asNumber(created.id) ?? crypto.randomUUID()}`
    }),
    message: `${item.title} was sent to Sonarr`
  };
}

function summarizeDashboard(items: MediaItem[]) {
  return {
    total: items.length,
    verified: items.filter((item) => item.auditStatus === 'verified').length,
    pending: items.filter((item) => item.auditStatus === 'pending' || item.auditStatus === 'unknown').length,
    attention: items.filter((item) => item.auditStatus === 'missing-language' || item.auditStatus === 'no-subs').length
  };
}

async function buildMovieHistoryItems(preferences: Preferences): Promise<MediaItem[]> {
  if (!getConfigStatus().radarrConfigured) {
    return [];
  }

  const [history, queue] = await Promise.all([
    arrFetch<unknown>('radarr', '/api/v3/history', undefined, {
      pageSize: 8,
      page: 1,
      sortKey: 'date',
      sortDirection: 'descending'
    }).then(asRecordsArray).catch(() => []),
    arrFetch<unknown>('radarr', '/api/v3/queue', undefined, {
      pageSize: 5,
      page: 1,
      sortKey: 'timeleft',
      sortDirection: 'ascending'
    }).then(asRecordsArray).catch(() => [])
  ]);

  const items: MediaItem[] = [];

  for (const entry of queue) {
    const record = asRecord(entry);
    const movie = asRecord(record.movie);
    items.push(
      normalizeItem('movie', movie, preferences, {
        id: `movie:queue:${asString(record.downloadId) ?? crypto.randomUUID()}`,
        status: 'Queued',
        isExisting: true,
        isRequested: true,
        auditStatus: 'pending'
      })
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
          id: `movie:history:${movieId}`,
          detail: asString(record.sourceTitle),
          isExisting: true,
          isRequested: true
        })
      );
    }
  }

  return items;
}

async function buildSeriesHistoryItems(preferences: Preferences): Promise<MediaItem[]> {
  if (!getConfigStatus().sonarrConfigured) {
    return [];
  }

  const [history, queue] = await Promise.all([
    arrFetch<unknown>('sonarr', '/api/v3/history', undefined, {
      pageSize: 8,
      page: 1,
      sortKey: 'date',
      sortDirection: 'descending'
    }).then(asRecordsArray).catch(() => []),
    arrFetch<unknown>('sonarr', '/api/v3/queue', undefined, {
      pageSize: 5,
      page: 1,
      sortKey: 'timeleft',
      sortDirection: 'ascending'
    }).then(asRecordsArray).catch(() => [])
  ]);

  const items: MediaItem[] = [];

  for (const entry of queue) {
    const record = asRecord(entry);
    const series = asRecord(record.series);
    const episode = asRecord(record.episode);
    items.push(
      normalizeItem('series', series, preferences, {
        id: `series:queue:${asString(record.downloadId) ?? crypto.randomUUID()}`,
        status: 'Queued',
        isExisting: true,
        isRequested: true,
        auditStatus: 'pending',
        detail: asString(episode.title)
      })
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
          asString(record.sourceTitle) ?? asString(asRecord(record.episode).title)
        )
      );
    } catch {
      const series = asRecord(record.series);
      items.push(
        normalizeItem('series', series, preferences, {
          id: `series:history:${seriesId}:${episodeFileId ?? crypto.randomUUID()}`,
          detail: asString(record.sourceTitle) ?? asString(asRecord(record.episode).title),
          isExisting: true,
          isRequested: true
        })
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

export async function getDashboard(
  preferences?: Partial<Preferences>,
  options?: { force?: boolean }
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
        buildSeriesHistoryItems(normalizedPreferences)
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
      .slice(0, 14)
  );

  const value: DashboardResponse = {
    updatedAt: new Date().toISOString(),
    items,
    summary: summarizeDashboard(items)
  };

  dashboardCache.set(cacheKey, { expiresAt: now + 30_000, value });
  return value;
}
