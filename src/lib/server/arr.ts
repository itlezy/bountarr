import { env } from '$env/dynamic/private';
import { evaluateAudit } from '$lib/server/audit';
import { searchPlex } from '$lib/server/plex';
import { selectBestRelease } from '$lib/server/release-score';
import { sanitizePreferences } from '$lib/shared/preferences';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AcquisitionAttempt,
  AcquisitionJob,
  AcquisitionResponse,
  QualityProfileOption,
  QueueItem,
  QueueResponse,
  ConfigStatus,
  DashboardResponse,
  MediaItem,
  MediaKind,
  Preferences,
  ReleaseDecision,
  RequestResponse,
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

type PersistedAcquisitionJob = AcquisitionJob & {
  failedGuids: string[];
};

type RequestItemOptions = {
  qualityProfileId?: number | null;
};

const dashboardCache = new Map<string, CacheEntry>();
const defaultsCache = new Map<string, { expiresAt: number; value: Record<string, unknown> }>();
const queueCache = new Map<string, { expiresAt: number; value: QueueResponse }>();
const acquisitionPath = path.resolve('data', 'acquisition-jobs.json');
const acquisitionState = {
  initialized: false,
  jobs: new Map<string, PersistedAcquisitionJob>(),
  running: new Set<string>()
};

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

function isPlexConfigured(): boolean {
  return Boolean(env.PLEX_URL?.trim() && env.PLEX_TOKEN?.trim());
}

function qualityProfileName(service: ArrService): string | null {
  const value =
    service === 'radarr'
      ? env.RADARR_QUALITY_PROFILE_NAME?.trim()
      : env.SONARR_QUALITY_PROFILE_NAME?.trim();

  return value && value.length > 0 ? value : null;
}

function acquisitionAttemptTimeoutMinutes(): number {
  const value = Number(env.ACQUISITION_ATTEMPT_TIMEOUT_MINUTES ?? '90');
  return Number.isFinite(value) && value > 0 ? value : 90;
}

function acquisitionMaxRetries(): number {
  const value = Number(env.ACQUISITION_MAX_RETRIES ?? '4');
  return Number.isFinite(value) && value > 0 ? value : 4;
}

function acquisitionPollMs(): number {
  return 15_000;
}

function getConfigFlags(): Pick<
  ConfigStatus,
  'radarrConfigured' | 'sonarrConfigured' | 'plexConfigured' | 'configured'
> {
  const radarrConfigured = getServiceConfig('radarr') !== null;
  const sonarrConfigured = getServiceConfig('sonarr') !== null;
  const plexConfigured = isPlexConfigured();

  return {
    radarrConfigured,
    sonarrConfigured,
    plexConfigured,
    configured: radarrConfigured || sonarrConfigured
  };
}

function cloneJob(job: PersistedAcquisitionJob): AcquisitionJob {
  const { failedGuids: _failedGuids, ...publicJob } = job;
  return structuredClone(publicJob);
}

function sortJobs(jobs: PersistedAcquisitionJob[]): PersistedAcquisitionJob[] {
  return [...jobs].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt);
    const rightTime = Date.parse(right.updatedAt);
    return rightTime - leftTime;
  });
}

function persistAcquisitionJobs(): void {
  const directory = path.dirname(acquisitionPath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  writeFileSync(
    acquisitionPath,
    JSON.stringify(
      {
        jobs: sortJobs([...acquisitionState.jobs.values()])
      },
      null,
      2
    ),
    'utf8'
  );
}

function ensureAcquisitionStateLoaded(): void {
  if (acquisitionState.initialized) {
    return;
  }

  acquisitionState.initialized = true;

  if (!existsSync(acquisitionPath)) {
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(acquisitionPath, 'utf8')) as {
      jobs?: PersistedAcquisitionJob[];
    };

    for (const job of parsed.jobs ?? []) {
      acquisitionState.jobs.set(job.id, job);
    }
  } catch {
    acquisitionState.jobs.clear();
  }
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

function asPositiveNumber(value: unknown): number | null {
  const number = asNumber(value);
  return number !== null && number > 0 ? number : null;
}

function normalizeToken(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[-_]+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function titleKey(kind: MediaKind, title: string, year: number | null): string {
  return `${kind}:${normalizeToken(title)}:${year ?? 'na'}`;
}

function extractReleaser(title: string): string | null {
  const match = title.trim().match(/-([A-Za-z0-9][A-Za-z0-9._-]{1,})$/);
  return match ? match[1].toLowerCase() : null;
}

function asScalarString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return String(value);
  }

  return null;
}

function extractGuidIds(raw: Record<string, unknown>): Record<string, string> {
  const ids: Record<string, string> = {};
  const guidEntries = asArray(raw.Guid ?? raw.guids);

  for (const entry of guidEntries) {
    const record = asRecord(entry);
    const rawId = asString(record.id) ?? asString(record.guid);
    if (!rawId) {
      continue;
    }

    const match = rawId.match(/^([a-z0-9]+):\/\/(.+)$/i);
    if (!match) {
      continue;
    }

    const [, provider, providerId] = match;
    ids[provider.toLowerCase()] = providerId.trim().toLowerCase();
  }

  return ids;
}

function itemMatchKeys(item: MediaItem): string[] {
  const payload = asRecord(item.requestPayload);
  const keys = new Set<string>();
  const pushKey = (provider: string, value: string | null) => {
    if (value) {
      keys.add(`${item.kind}:${provider}:${value.toLowerCase()}`);
    }
  };

  const guidIds = extractGuidIds(payload);
  pushKey('imdb', guidIds.imdb ?? asScalarString(payload.imdbId));
  pushKey('tmdb', guidIds.tmdb ?? asScalarString(payload.tmdbId));
  pushKey('tvdb', guidIds.tvdb ?? asScalarString(payload.tvdbId));
  pushKey('tvmaze', guidIds.tvmaze ?? asScalarString(payload.tvMazeId));
  keys.add(titleKey(item.kind, item.title, item.year));

  return [...keys];
}

function formatLabel(value: string): string {
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractPopularity(item: MediaItem): number {
  const payload = asRecord(item.requestPayload);
  return (
    asNumber(payload.popularity) ??
    asNumber(asRecord(payload.ratings).value) ??
    asNumber(asRecord(asRecord(payload.ratings).tmdb).value) ??
    asNumber(asRecord(asRecord(payload.ratings).imdb).value) ??
    0
  );
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

function isTracked(raw: Record<string, unknown>): boolean {
  return (
    asNumber(raw.id) !== null ||
    raw.monitored === true ||
    raw.hasFile === true ||
    raw.path !== undefined ||
    asString(raw.folderName) !== null
  );
}

function buildStatus(raw: Record<string, unknown>, isExisting: boolean, canAdd: boolean): string {
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

  if (isExisting) {
    return 'Already in Arr';
  }

  if (canAdd) {
    return 'Ready to add';
  }

  return 'Informational';
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
  const inferredExisting = isTracked(raw);
  const sourceService = fallback.sourceService ?? (kind === 'movie' ? 'radarr' : 'sonarr');
  const inArr = fallback.inArr ?? (sourceService !== 'plex' && inferredExisting);
  const inPlex = fallback.inPlex ?? (sourceService === 'plex');
  const canAdd = fallback.canAdd ?? (sourceService !== 'plex' && !inArr);
  const fallbackId =
    fallback.id ??
    `${kind}:${asNumber(raw.tmdbId) ?? asNumber(raw.tvdbId) ?? asString(raw.guid) ?? asString(raw.ratingKey) ?? crypto.randomUUID()}`;

  let auditStatus = evaluateAudit(audioLanguages, subtitleLanguages, preferences, hasMediaInfo);
  if (!hasMediaInfo && !inArr) {
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
    overview: asString(raw.overview) ?? fallback.overview ?? asString(raw.summary) ?? '',
    status: fallback.status ?? buildStatus(raw, inArr, canAdd),
    isExisting: fallback.isExisting ?? inArr,
    isRequested: fallback.isRequested ?? inArr,
    auditStatus: fallback.auditStatus ?? auditStatus,
    audioLanguages,
    subtitleLanguages,
    sourceService,
    origin: fallback.origin ?? (inArr && inPlex ? 'merged' : inPlex ? 'plex' : 'arr'),
    inArr,
    inPlex,
    plexLibraries: fallback.plexLibraries ?? [],
    canAdd,
    detail: fallback.detail ?? asString(raw.sourceTitle) ?? null,
    requestPayload: fallback.requestPayload ?? raw
  };
}

function mergeItems(left: MediaItem, right: MediaItem): MediaItem {
  const inArr = left.inArr || right.inArr;
  const inPlex = left.inPlex || right.inPlex;
  const arrItem = left.inArr ? left : right.inArr ? right : null;
  const plexItem = left.inPlex ? left : right.inPlex ? right : null;

  return {
    ...(arrItem ?? left),
    id: arrItem?.id ?? left.id,
    poster: arrItem?.poster ?? plexItem?.poster ?? left.poster,
    overview: arrItem?.overview || plexItem?.overview || left.overview,
    detail: arrItem?.detail ?? plexItem?.detail ?? left.detail,
    sourceService: arrItem?.sourceService ?? plexItem?.sourceService ?? left.sourceService,
    origin: inArr && inPlex ? 'merged' : inPlex ? 'plex' : 'arr',
    inArr,
    inPlex,
    plexLibraries: Array.from(new Set([...(left.plexLibraries ?? []), ...(right.plexLibraries ?? [])])),
    canAdd: !inPlex && Boolean(arrItem?.canAdd ?? (!inArr && (left.canAdd || right.canAdd))),
    status: inArr ? arrItem?.status ?? 'Already in Arr' : inPlex ? 'Already in Plex' : left.status,
    requestPayload: arrItem?.requestPayload ?? left.requestPayload ?? right.requestPayload
  };
}

function sortSearchResults(term: string, items: MediaItem[]): MediaItem[] {
  const normalizedTerm = normalizeToken(term);

  return [...items].sort((left, right) => {
    const addableDifference = Number(right.canAdd) - Number(left.canAdd);
    if (addableDifference !== 0) {
      return addableDifference;
    }

    const yearDifference = (right.year ?? 0) - (left.year ?? 0);
    if (yearDifference !== 0) {
      return yearDifference;
    }

    const popularityDifference = extractPopularity(right) - extractPopularity(left);
    if (popularityDifference !== 0) {
      return popularityDifference;
    }

    const titleStrength = (item: MediaItem) => {
      const normalizedTitle = normalizeToken(item.title);
      if (normalizedTitle === normalizedTerm) {
        return 3;
      }

      if (normalizedTitle.startsWith(normalizedTerm)) {
        return 2;
      }

      if (normalizedTitle.includes(normalizedTerm)) {
        return 1;
      }

      return 0;
    };

    const titleDifference = titleStrength(right) - titleStrength(left);
    if (titleDifference !== 0) {
      return titleDifference;
    }

    return left.title.localeCompare(right.title);
  });
}

function resolveQualityProfileId(service: ArrService, profiles: unknown[]): number | null {
  const preferredName = qualityProfileName(service);
  const normalizedPreferred = preferredName ? normalizeToken(preferredName) : null;
  const normalizedProfiles = profiles.map(asRecord);

  if (normalizedPreferred) {
    const match = normalizedProfiles.find((profile) => {
      const name = asString(profile.name);
      return name ? normalizeToken(name) === normalizedPreferred : false;
    });

    if (!match) {
      throw new Error(
        `Quality profile "${preferredName}" was not found in ${service}`
      );
    }

    return asPositiveNumber(match.id);
  }

  return normalizedProfiles
    .map((profile) => asPositiveNumber(profile.id))
    .find((id): id is number => id !== null) ?? null;
}

function toQualityProfileOptions(
  service: ArrService,
  profiles: unknown[],
  defaultId: number | null
): QualityProfileOption[] {
  const defaultName = qualityProfileName(service);
  const normalizedDefaultName = defaultName ? normalizeToken(defaultName) : null;

  return profiles
    .map(asRecord)
    .map((profile) => {
      const id = asPositiveNumber(profile.id);
      const name = asString(profile.name);
      if (!id || !name) {
        return null;
      }

      return {
        id,
        name,
        isDefault:
          (defaultId !== null && id === defaultId) ||
          (normalizedDefaultName !== null && normalizeToken(name) === normalizedDefaultName)
      } satisfies QualityProfileOption;
    })
    .filter((profile): profile is QualityProfileOption => profile !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function fetchQualityProfiles(service: ArrService): Promise<unknown[]> {
  if (!getConfigFlags()[service === 'radarr' ? 'radarrConfigured' : 'sonarrConfigured']) {
    return [];
  }

  return arrFetch<unknown[]>(service, '/api/v3/qualityprofile');
}

export async function getConfigStatus(): Promise<ConfigStatus> {
  const flags = getConfigFlags();
  const [radarrProfilesRaw, sonarrProfilesRaw] = await Promise.all([
    flags.radarrConfigured ? fetchQualityProfiles('radarr') : Promise.resolve([]),
    flags.sonarrConfigured ? fetchQualityProfiles('sonarr') : Promise.resolve([])
  ]);

  const defaultRadarrQualityProfileId = flags.radarrConfigured
    ? resolveQualityProfileId('radarr', radarrProfilesRaw)
    : null;
  const defaultSonarrQualityProfileId = flags.sonarrConfigured
    ? resolveQualityProfileId('sonarr', sonarrProfilesRaw)
    : null;

  return {
    ...flags,
    radarrQualityProfiles: toQualityProfileOptions(
      'radarr',
      radarrProfilesRaw,
      defaultRadarrQualityProfileId
    ),
    sonarrQualityProfiles: toQualityProfileOptions(
      'sonarr',
      sonarrProfilesRaw,
      defaultSonarrQualityProfileId
    ),
    defaultRadarrQualityProfileId,
    defaultSonarrQualityProfileId
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
    const resolvedQualityProfile = resolveQualityProfileId('radarr', qualityProfiles);

    const value = {
      rootFolderPath: asString(asRecord(rootFolders[0]).path),
      qualityProfileId: resolvedQualityProfile
    };

    defaultsCache.set(cacheKey, { expiresAt: now + 10 * 60_000, value });
    return value;
  }

  const [rootFolders, qualityProfiles, languageProfiles] = await Promise.all([
    arrFetch<unknown[]>('sonarr', '/api/v3/rootfolder'),
    arrFetch<unknown[]>('sonarr', '/api/v3/qualityprofile'),
    arrFetch<unknown[]>('sonarr', '/api/v3/languageprofile')
  ]);
  const resolvedQualityProfile = resolveQualityProfileId('sonarr', qualityProfiles);
  const defaultLanguageProfile = languageProfiles
    .map(asRecord)
    .map((profile) => asPositiveNumber(profile.id))
    .find((id): id is number => id !== null);

  const value = {
    rootFolderPath: asString(asRecord(rootFolders[0]).path),
    qualityProfileId: resolvedQualityProfile,
    languageProfileId: defaultLanguageProfile ?? null
  };

  defaultsCache.set(cacheKey, { expiresAt: now + 10 * 60_000, value });
  return value;
}

async function fetchMovieFile(movieFileId: number): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(await arrFetch<unknown>('radarr', `/api/v3/moviefile/${movieFileId}`));
  } catch {
    return null;
  }
}

async function fetchEpisodeFile(episodeFileId: number): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(await arrFetch<unknown>('sonarr', `/api/v3/episodefile/${episodeFileId}`));
  } catch {
    return null;
  }
}

async function discoverSeriesEpisodeFileId(seriesId: number): Promise<number | null> {
  try {
    const episodes = (await arrFetch<unknown[]>('sonarr', '/api/v3/episode', undefined, {
      seriesId
    }))
      .map(asRecord)
      .filter((episode) => (asNumber(episode.episodeFileId) ?? 0) > 0)
      .sort((left, right) => {
        const seasonDifference =
          (asNumber(right.seasonNumber) ?? 0) - (asNumber(left.seasonNumber) ?? 0);
        if (seasonDifference !== 0) {
          return seasonDifference;
        }

        return (asNumber(right.episodeNumber) ?? 0) - (asNumber(left.episodeNumber) ?? 0);
      });

    return asNumber(episodes[0]?.episodeFileId);
  } catch {
    return null;
  }
}

async function fetchExistingMovie(id: number, preferences: Preferences): Promise<MediaItem> {
  const movie = asRecord(await arrFetch<unknown>('radarr', `/api/v3/movie/${id}`));
  const movieFileId = asNumber(movie.movieFileId);
  const movieFile = movieFileId ? await fetchMovieFile(movieFileId) : null;

  return normalizeItem(
    'movie',
    movieFile
      ? {
          ...movie,
          movieFile
        }
      : movie,
    preferences,
    {
      id: `movie:${id}`,
      inArr: true,
      canAdd: false
    }
  );
}

async function fetchExistingSeries(
  id: number,
  preferences: Preferences,
  episodeFileId?: number | null,
  detail?: string | null
): Promise<MediaItem> {
  const series = asRecord(await arrFetch<unknown>('sonarr', `/api/v3/series/${id}`));
  const resolvedEpisodeFileId =
    episodeFileId && episodeFileId > 0 ? episodeFileId : await discoverSeriesEpisodeFileId(id);
  const richEpisodeFile =
    resolvedEpisodeFileId && resolvedEpisodeFileId > 0
      ? await fetchEpisodeFile(resolvedEpisodeFileId)
      : null;

  if (richEpisodeFile) {
    return normalizeItem(
      'series',
      {
        ...series,
        episodeFile: richEpisodeFile
      },
      preferences,
      {
        id: `series:${id}:${resolvedEpisodeFileId}`,
        detail: detail ?? null,
        inArr: true,
        canAdd: false
      }
    );
  }

  return normalizeItem('series', series, preferences, {
    id: `series:${id}`,
    detail: detail ?? null,
    inArr: true,
    canAdd: false
  });
}

async function lookupArrItems(
  term: string,
  kind: SearchKind,
  preferences: Preferences
): Promise<MediaItem[]> {
  const status = getConfigFlags();
  const tasks: Promise<MediaItem[]>[] = [];

  if ((kind === 'all' || kind === 'movie') && status.radarrConfigured) {
    tasks.push(
      arrFetch<unknown[]>('radarr', '/api/v3/movie/lookup', undefined, { term }).then((items) =>
        Promise.all(items.map(async (item) => {
          const raw = asRecord(item);
          const id = asNumber(raw.id);
          const tracked =
            id !== null ||
            raw.hasFile === true ||
            raw.monitored === true ||
            raw.path !== undefined ||
            asString(raw.folderName) !== null;

          if (tracked && id !== null) {
            try {
              return await fetchExistingMovie(id, preferences);
            } catch {
              // Fall back to lookup payload if rich metadata fetch fails.
            }
          }

          return normalizeItem('movie', raw, preferences, {
            id: `movie:${id ?? asNumber(raw.tmdbId) ?? crypto.randomUUID()}`,
            sourceService: 'radarr',
            inArr: tracked,
            canAdd: !tracked,
            requestPayload: raw
          });
        }))
      )
    );
  }

  if ((kind === 'all' || kind === 'series') && status.sonarrConfigured) {
    tasks.push(
      arrFetch<unknown[]>('sonarr', '/api/v3/series/lookup', undefined, { term }).then((items) =>
        Promise.all(items.map(async (item) => {
          const raw = asRecord(item);
          const id = asNumber(raw.id);
          const tracked =
            id !== null ||
            raw.monitored === true ||
            raw.path !== undefined ||
            asString(raw.folder) !== null;

          if (tracked && id !== null) {
            try {
              return await fetchExistingSeries(id, preferences, null, null);
            } catch {
              // Fall back to lookup payload if rich metadata fetch fails.
            }
          }

          return normalizeItem('series', raw, preferences, {
            id: `series:${id ?? asNumber(raw.tvdbId) ?? crypto.randomUUID()}`,
            sourceService: 'sonarr',
            inArr: tracked,
            canAdd: !tracked,
            requestPayload: raw
          });
        }))
      )
    );
  }

  return (await Promise.all(tasks)).flat();
}

export async function lookupItems(
  term: string,
  kind: SearchKind,
  preferences?: Partial<Preferences>,
  options?: { includeAvailable?: boolean }
): Promise<MediaItem[]> {
  const normalizedPreferences = sanitizePreferences(preferences);
  const [arrItems, plexItems] = await Promise.all([
    lookupArrItems(term, kind, normalizedPreferences),
    searchPlex(term, kind)
  ]);

  const merged = new Map<string, MediaItem>();

  for (const item of [...arrItems, ...plexItems]) {
    const keys = itemMatchKeys(item);
    const existingKey = keys.find((key) => merged.has(key));
    const existing = existingKey ? merged.get(existingKey) ?? null : null;
    const mergedItem = existing ? mergeItems(existing, item) : item;

    for (const key of new Set([...(existing ? itemMatchKeys(existing) : []), ...keys, ...itemMatchKeys(mergedItem)])) {
      merged.set(key, mergedItem);
    }
  }

  const includeAvailable = options?.includeAvailable ?? true;
  const deduped = [...new Set(merged.values())];
  const filtered = includeAvailable ? deduped : deduped.filter((item) => !item.inPlex);

  return sortSearchResults(term, filtered).slice(0, 24);
}

function ensureRootFolder(defaults: Record<string, unknown>, service: ArrService): void {
  if (!asString(defaults.rootFolderPath)) {
    throw new Error(`No root folder is configured in ${service}`);
  }

  if (!asPositiveNumber(defaults.qualityProfileId)) {
    throw new Error(`No quality profile is configured in ${service}`);
  }

  if (service === 'sonarr' && !asPositiveNumber(defaults.languageProfileId)) {
    throw new Error('No language profile is configured in sonarr');
  }
}

function ensureAddable(item: MediaItem): void {
  if (item.inArr) {
    throw new Error(`${item.title} is already tracked in Arr`);
  }

  if (!item.canAdd || !item.requestPayload || item.sourceService === 'plex') {
    throw new Error(`${item.title} cannot be added from this result`);
  }
}

function selectMappedReleases(
  kind: MediaKind,
  releases: unknown[],
  createdId: number
): Record<string, unknown>[] {
  return releases
    .map(asRecord)
    .filter((release) =>
      kind === 'movie'
        ? asNumber(release.mappedMovieId) === createdId
        : asNumber(release.mappedSeriesId) === createdId
    );
}

async function grabRelease(
  service: ArrService,
  selection: ReturnType<typeof selectBestRelease>
): Promise<ReleaseDecision> {
  if (!selection.payload || !selection.decision.selected) {
    return selection.decision;
  }

  await arrFetch<unknown>(service, '/api/v3/release', {
    method: 'POST',
    body: JSON.stringify({
      guid: selection.decision.selected.guid,
      indexerId: selection.decision.selected.indexerId
    })
  });

  return selection.decision;
}

function buildSeriesPayload(
  item: MediaItem,
  defaults: Record<string, unknown>,
  options?: RequestItemOptions
): Record<string, unknown> {
  const raw = asRecord(item.requestPayload);

  return {
    ...raw,
    monitored: false,
    seasonFolder: raw.seasonFolder ?? true,
    seasons: asArray(raw.seasons).map((season) => ({
      ...asRecord(season),
      monitored: false
    })),
    rootFolderPath: asString(raw.rootFolderPath) ?? asString(defaults.rootFolderPath),
    qualityProfileId:
      options?.qualityProfileId ??
      asPositiveNumber(raw.qualityProfileId) ??
      asPositiveNumber(defaults.qualityProfileId),
    languageProfileId: asPositiveNumber(raw.languageProfileId) ?? asPositiveNumber(defaults.languageProfileId),
    monitorNewItems: 'none',
    addOptions: {
      searchForMissingEpisodes: false,
      searchForCutoffUnmetEpisodes: false
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalJobStatus(status: AcquisitionJob['status']): boolean {
  return status === 'completed' || status === 'failed';
}

function jobStatusLabel(status: AcquisitionJob['status']): string {
  return status
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function updateAttempt(
  attempts: AcquisitionAttempt[],
  attemptNumber: number,
  updater: (attempt: AcquisitionAttempt) => AcquisitionAttempt
): AcquisitionAttempt[] {
  return attempts.map((attempt) =>
    attempt.attempt === attemptNumber ? updater(attempt) : attempt
  );
}

function updateJob(
  jobId: string,
  updater: (job: PersistedAcquisitionJob) => PersistedAcquisitionJob
): PersistedAcquisitionJob {
  ensureAcquisitionStateLoaded();
  const existing = acquisitionState.jobs.get(jobId);
  if (!existing) {
    throw new Error(`Acquisition job ${jobId} was not found`);
  }

  const updated = updater(existing);
  acquisitionState.jobs.set(jobId, updated);
  persistAcquisitionJobs();
  queueCache.delete('queue');
  return updated;
}

function getInternalJob(jobId: string): PersistedAcquisitionJob | null {
  ensureAcquisitionStateLoaded();
  return acquisitionState.jobs.get(jobId) ?? null;
}

function setJobStatus(
  jobId: string,
  status: AcquisitionJob['status'],
  patch: Partial<PersistedAcquisitionJob> = {}
): PersistedAcquisitionJob {
  return updateJob(jobId, (job) => ({
    ...job,
    ...patch,
    status,
    updatedAt: new Date().toISOString()
  }));
}

function attemptForRelease(
  job: PersistedAcquisitionJob,
  releaseTitle: string | null,
  releaser: string | null
): PersistedAcquisitionJob {
  const startedAt = new Date().toISOString();
  const attemptRecord: AcquisitionAttempt = {
    attempt: job.attempt,
    status: 'searching',
    releaseTitle,
    releaser,
    reason: null,
    startedAt,
    finishedAt: null
  };

  return {
    ...job,
    currentRelease: releaseTitle,
    selectedReleaser: releaser,
    updatedAt: startedAt,
    attempts: [...job.attempts.filter((attempt) => attempt.attempt !== job.attempt), attemptRecord]
  };
}

function finishAttempt(
  jobId: string,
  attemptNumber: number,
  status: AcquisitionJob['status'],
  reason: string | null
): PersistedAcquisitionJob {
  const finishedAt = new Date().toISOString();
  return updateJob(jobId, (job) => ({
    ...job,
    status,
    failureReason: reason,
    updatedAt: finishedAt,
    attempts: updateAttempt(job.attempts, attemptNumber, (attempt) => ({
      ...attempt,
      status,
      reason,
      finishedAt
    }))
  }));
}

function enqueueJobProcessing(jobId: string): void {
  ensureAcquisitionStateLoaded();

  if (acquisitionState.running.has(jobId)) {
    return;
  }

  acquisitionState.running.add(jobId);
  queueMicrotask(() => {
    void processAcquisitionJob(jobId).finally(() => {
      acquisitionState.running.delete(jobId);
      const job = getInternalJob(jobId);
      if (job && !isTerminalJobStatus(job.status)) {
        enqueueJobProcessing(jobId);
      }
    });
  });
}

function ensureAcquisitionWorkers(): void {
  ensureAcquisitionStateLoaded();

  for (const job of acquisitionState.jobs.values()) {
    if (!isTerminalJobStatus(job.status)) {
      enqueueJobProcessing(job.id);
    }
  }
}

function rejectionListIncludes(job: PersistedAcquisitionJob, guid: string): boolean {
  return job.failedGuids.includes(guid);
}

function normalizeReleaseTitle(value: string | null): string {
  return normalizeToken(value ?? '');
}

async function fetchQueueRecords(service: ArrService): Promise<Record<string, unknown>[]> {
  return arrFetch<unknown>(service, '/api/v3/queue', undefined, {
    pageSize: 50,
    page: 1,
    sortKey: 'timeleft',
    sortDirection: 'ascending'
  })
    .then(asRecordsArray)
    .then((records) => records.map(asRecord))
    .catch(() => []);
}

async function fetchHistoryRecords(
  service: ArrService,
  itemId: number
): Promise<Record<string, unknown>[]> {
  return arrFetch<unknown>(service, '/api/v3/history', undefined, {
    pageSize: 50,
    page: 1,
    sortKey: 'date',
    sortDirection: 'descending'
  })
    .then(asRecordsArray)
    .then((records) =>
      records
        .map(asRecord)
        .filter((record) =>
          service === 'radarr'
            ? asNumber(record.movieId) === itemId
            : asNumber(record.seriesId) === itemId
        )
    )
    .catch(() => []);
}

function historySince(
  records: Record<string, unknown>[],
  startedAt: string,
  releaseTitle: string | null
): Record<string, unknown>[] {
  const startedMs = Date.parse(startedAt);
  const normalizedReleaseTitle = normalizeReleaseTitle(releaseTitle);

  return records.filter((record) => {
    const dateMs = Date.parse(asString(record.date) ?? '');
    if (!Number.isFinite(dateMs) || dateMs < startedMs) {
      return false;
    }

    if (!normalizedReleaseTitle) {
      return true;
    }

    const sourceTitle = normalizeReleaseTitle(asString(record.sourceTitle));
    return (
      sourceTitle.length === 0 ||
      sourceTitle.includes(normalizedReleaseTitle) ||
      normalizedReleaseTitle.includes(sourceTitle)
    );
  });
}

function validationSummary(item: MediaItem): string | null {
  const auditStatus = item.auditStatus;
  if (auditStatus === 'verified') {
    return `Verified audio ${item.audioLanguages.join(', ') || 'unknown'} with subtitles ${item.subtitleLanguages.join(', ') || 'present'}`;
  }

  if (auditStatus === 'missing-language') {
    return `Missing preferred audio. Found ${item.audioLanguages.join(', ') || 'unknown audio'}`;
  }

  if (auditStatus === 'no-subs') {
    return 'Imported file has no subtitles';
  }

  return null;
}

async function validateMovieAttempt(
  job: PersistedAcquisitionJob,
  attemptStart: string
): Promise<{ outcome: 'pending' | 'success' | 'failure'; summary: string | null; progress: number | null; queueStatus: string | null; preferredReleaser: string | null; }> {
  const [queueRecords, historyRecords] = await Promise.all([
    fetchQueueRecords('radarr'),
    fetchHistoryRecords('radarr', job.arrItemId)
  ]);
  const queueRecord = queueRecords.find(
    (record) => asNumber(asRecord(record.movie).id) === job.arrItemId
  ) ?? null;
  const relevantHistory = historySince(historyRecords, attemptStart, job.currentRelease);

  if (relevantHistory.length === 0) {
    if (queueRecord) {
      const queueItem = normalizeQueueItem('radarr', queueRecord);
      return {
        outcome: 'pending',
        summary: null,
        progress: queueItem?.progress ?? null,
        queueStatus: queueItem?.status ?? jobStatusLabel(job.status),
        preferredReleaser: null
      };
    }

    return {
      outcome: 'pending',
      summary: null,
      progress: job.progress,
      queueStatus: job.queueStatus,
      preferredReleaser: null
    };
  }

  const item = await fetchExistingMovie(job.arrItemId, {
    preferredLanguage: job.preferences.preferredLanguage,
    requireSubtitles: job.preferences.requireSubtitles,
    theme: 'system'
  });
  const summary = validationSummary(item);

  if (item.auditStatus === 'verified') {
    return {
      outcome: 'success',
      summary,
      progress: 100,
      queueStatus: 'Imported',
      preferredReleaser: job.selectedReleaser
    };
  }

  if (item.auditStatus === 'missing-language' || item.auditStatus === 'no-subs') {
    return {
      outcome: 'failure',
      summary,
      progress: 100,
      queueStatus: 'Imported',
      preferredReleaser: null
    };
  }

  return {
    outcome: 'pending',
    summary,
    progress: queueRecord ? normalizeQueueItem('radarr', queueRecord)?.progress ?? null : job.progress,
    queueStatus: queueRecord ? normalizeQueueItem('radarr', queueRecord)?.status ?? job.queueStatus : job.queueStatus,
    preferredReleaser: null
  };
}

async function validateSeriesAttempt(
  job: PersistedAcquisitionJob,
  attemptStart: string
): Promise<{ outcome: 'pending' | 'success' | 'failure'; summary: string | null; progress: number | null; queueStatus: string | null; preferredReleaser: string | null; }> {
  const [queueRecords, historyRecords] = await Promise.all([
    fetchQueueRecords('sonarr'),
    fetchHistoryRecords('sonarr', job.arrItemId)
  ]);
  const queueRecord = queueRecords.find(
    (record) => asNumber(asRecord(record.series).id) === job.arrItemId
  ) ?? null;
  const relevantHistory = historySince(historyRecords, attemptStart, job.currentRelease);
  const episodeFileIds = Array.from(
    new Set(
      relevantHistory
        .map((record) => asNumber(record.episodeFileId) ?? asNumber(asRecord(record.data).episodeFileId))
        .filter((value): value is number => value !== null && value > 0)
    )
  );

  if (episodeFileIds.length === 0) {
    if (queueRecord) {
      const queueItem = normalizeQueueItem('sonarr', queueRecord);
      return {
        outcome: 'pending',
        summary: null,
        progress: queueItem?.progress ?? null,
        queueStatus: queueItem?.status ?? jobStatusLabel(job.status),
        preferredReleaser: null
      };
    }

    return {
      outcome: 'pending',
      summary: null,
      progress: job.progress,
      queueStatus: job.queueStatus,
      preferredReleaser: null
    };
  }

  const validations = await Promise.all(
    episodeFileIds.map(async (episodeFileId) => {
      const episodeFile = await fetchEpisodeFile(episodeFileId);
      const mediaInfo = asRecord(episodeFile?.mediaInfo);
      const audioLanguages = normalizeLanguageEntries(mediaInfo.audioLanguages);
      const subtitleLanguages = normalizeLanguageEntries(
        mediaInfo.subtitles ?? mediaInfo.subtitleLanguages
      );
      const auditStatus = evaluateAudit(
        audioLanguages,
        subtitleLanguages,
        {
          preferredLanguage: job.preferences.preferredLanguage,
          requireSubtitles: job.preferences.requireSubtitles,
          theme: 'system'
        },
        Object.keys(mediaInfo).length > 0
      );

      return {
        episodeFileId,
        audioLanguages,
        subtitleLanguages,
        auditStatus
      };
    })
  );

  if (validations.some((entry) => entry.auditStatus === 'unknown')) {
    return {
      outcome: 'pending',
      summary: 'Imported episodes are waiting for media info',
      progress: queueRecord ? normalizeQueueItem('sonarr', queueRecord)?.progress ?? null : job.progress,
      queueStatus: queueRecord ? normalizeQueueItem('sonarr', queueRecord)?.status ?? job.queueStatus : job.queueStatus,
      preferredReleaser: null
    };
  }

  const failed = validations.find(
    (entry) => entry.auditStatus === 'missing-language' || entry.auditStatus === 'no-subs'
  );

  if (failed) {
    const detail =
      failed.auditStatus === 'no-subs'
        ? 'One or more imported episodes have no subtitles'
        : `One or more imported episodes are missing preferred audio (${failed.audioLanguages.join(', ') || 'unknown audio'})`;

    return {
      outcome: 'failure',
      summary: detail,
      progress: 100,
      queueStatus: 'Imported',
      preferredReleaser: null
    };
  }

  return {
    outcome: 'success',
    summary: `Validated ${episodeFileIds.length} imported episode${episodeFileIds.length === 1 ? '' : 's'}`,
    progress: 100,
    queueStatus: 'Imported',
    preferredReleaser: job.selectedReleaser
  };
}

async function waitForAttemptOutcome(
  job: PersistedAcquisitionJob,
  attemptStartedAt: string
): Promise<{
  outcome: 'success' | 'failure' | 'timeout';
  summary: string;
  progress: number | null;
  queueStatus: string | null;
  preferredReleaser: string | null;
}> {
  const deadline = Date.now() + acquisitionAttemptTimeoutMinutes() * 60_000;

  while (Date.now() < deadline) {
    const validation =
      job.kind === 'movie'
        ? await validateMovieAttempt(job, attemptStartedAt)
        : await validateSeriesAttempt(job, attemptStartedAt);

    if (validation.progress !== null || validation.queueStatus) {
      updateJob(job.id, (current) => ({
        ...current,
        progress: validation.progress,
        queueStatus: validation.queueStatus,
        updatedAt: new Date().toISOString()
      }));
    }

    if (validation.outcome === 'success') {
      return {
        outcome: 'success',
        summary: validation.summary ?? 'Imported and validated',
        progress: validation.progress,
        queueStatus: validation.queueStatus,
        preferredReleaser: validation.preferredReleaser
      };
    }

    if (validation.outcome === 'failure') {
      return {
        outcome: 'failure',
        summary: validation.summary ?? 'Imported release failed validation',
        progress: validation.progress,
        queueStatus: validation.queueStatus,
        preferredReleaser: null
      };
    }

    await sleep(acquisitionPollMs());
  }

  return {
    outcome: 'timeout',
    summary: `Timed out after ${acquisitionAttemptTimeoutMinutes()} minutes waiting for import`,
    progress: job.progress,
    queueStatus: job.queueStatus,
    preferredReleaser: null
  };
}

function nextCandidateGuid(job: PersistedAcquisitionJob, decision: ReturnType<typeof selectBestRelease>): string | null {
  return decision.decision.selected?.guid ?? null;
}

async function processAcquisitionJob(jobId: string): Promise<void> {
  ensureAcquisitionWorkers();
  let job = getInternalJob(jobId);
  if (!job || isTerminalJobStatus(job.status)) {
    return;
  }

  while (job && !isTerminalJobStatus(job.status)) {
    try {
      setJobStatus(job.id, 'searching', {
        queueStatus: 'Searching releases',
        progress: null
      });
      job = getInternalJob(job.id);
      if (!job) {
        return;
      }

      const releases = await arrFetch<unknown[]>(
        job.sourceService,
        '/api/v3/release',
        undefined,
        job.kind === 'movie' ? { movieId: job.arrItemId } : { seriesId: job.arrItemId }
      );
      const mappedReleases = selectMappedReleases(job.kind, releases, job.arrItemId).filter((release) => {
        const guid = asString(release.guid);
        return guid ? !rejectionListIncludes(job as PersistedAcquisitionJob, guid) : false;
      });
      const selection = selectBestRelease(
        mappedReleases,
        {
          preferredLanguage: job.preferences.preferredLanguage,
          requireSubtitles: job.preferences.requireSubtitles,
          theme: 'system'
        },
        {
          kind: job.kind,
          preferredReleaser: job.preferredReleaser
        }
      );

      const selectedGuid = nextCandidateGuid(job, selection);
      if (!selection.payload || !selection.decision.selected || !selectedGuid) {
        setJobStatus(job.id, 'failed', {
          failureReason: selection.decision.reason,
          validationSummary: selection.decision.reason,
          completedAt: new Date().toISOString()
        });
        return;
      }

      job = updateJob(job.id, (current) =>
        attemptForRelease(
          {
            ...current,
            status: 'grabbing',
            queueStatus: 'Grabbing release'
          },
          selection.decision.selected?.title ?? null,
          extractReleaser(selection.decision.selected?.title ?? '')
        )
      );

      await grabRelease(job.sourceService, selection);
      const currentJob = job;
      const attemptStartedAt =
        currentJob.attempts.find((attempt) => attempt.attempt === currentJob.attempt)?.startedAt ??
        new Date().toISOString();

      setJobStatus(job.id, 'downloading', {
        queueStatus: 'Waiting for download',
        validationSummary: selection.decision.reason
      });

      const waitResult = await waitForAttemptOutcome(job, attemptStartedAt);
      if (waitResult.outcome === 'success') {
        setJobStatus(job.id, 'completed', {
          progress: waitResult.progress ?? 100,
          queueStatus: waitResult.queueStatus ?? 'Imported',
          validationSummary: waitResult.summary,
          preferredReleaser: waitResult.preferredReleaser ?? job.selectedReleaser,
          failureReason: null,
          completedAt: new Date().toISOString(),
          attempts: updateAttempt(job.attempts, job.attempt, (attempt) => ({
            ...attempt,
            status: 'completed',
            reason: waitResult.summary,
            finishedAt: new Date().toISOString()
          }))
        });
        return;
      }

      job = updateJob(job.id, (current) => {
        const failedGuids = selectedGuid
          ? [...new Set([...current.failedGuids, selectedGuid])]
          : current.failedGuids;
        const nextAttempt = current.attempt + 1;
        const terminal = nextAttempt > current.maxRetries;

        return {
          ...current,
          status: terminal ? 'failed' : 'retrying',
          attempt: nextAttempt,
          failedGuids,
          failureReason: waitResult.summary,
          validationSummary: waitResult.summary,
          progress: waitResult.progress,
          queueStatus: waitResult.queueStatus,
          completedAt: terminal ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
          attempts: updateAttempt(current.attempts, current.attempt, (attempt) => ({
            ...attempt,
            status: terminal ? 'failed' : 'retrying',
            reason: waitResult.summary,
            finishedAt: new Date().toISOString()
          }))
        };
      });

      if (isTerminalJobStatus(job.status)) {
        return;
      }
    } catch (error) {
      if (!job) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Acquisition failed';
      setJobStatus(job.id, 'failed', {
        failureReason: message,
        validationSummary: message,
        completedAt: new Date().toISOString(),
        attempts: updateAttempt(job.attempts, job.attempt, (attempt) => ({
          ...attempt,
          status: 'failed',
          reason: message,
          finishedAt: new Date().toISOString()
        }))
      });
      return;
    }
  }
}

function createJob(
  item: MediaItem,
  arrItemId: number,
  sourceService: ArrService,
  preferences: Preferences
): PersistedAcquisitionJob {
  ensureAcquisitionWorkers();

  const existing = findActiveJob(arrItemId, item.kind);

  if (existing) {
    return existing;
  }

  const startedAt = new Date().toISOString();
  const job: PersistedAcquisitionJob = {
    id: crypto.randomUUID(),
    itemId: item.id,
    arrItemId,
    kind: item.kind,
    title: item.title,
    sourceService,
    status: 'queued',
    attempt: 1,
    maxRetries: acquisitionMaxRetries(),
    currentRelease: null,
    selectedReleaser: null,
    preferredReleaser: null,
    failureReason: null,
    validationSummary: null,
    progress: null,
    queueStatus: 'Queued',
    preferences: {
      preferredLanguage: preferences.preferredLanguage,
      requireSubtitles: preferences.requireSubtitles
    },
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    attempts: [],
    failedGuids: []
  };

  acquisitionState.jobs.set(job.id, job);
  persistAcquisitionJobs();
  enqueueJobProcessing(job.id);
  return job;
}

function findActiveJob(arrItemId: number, kind: MediaKind): PersistedAcquisitionJob | null {
  ensureAcquisitionWorkers();

  return (
    [...acquisitionState.jobs.values()].find(
      (job) => job.arrItemId === arrItemId && job.kind === kind && !isTerminalJobStatus(job.status)
    ) ?? null
  );
}

export async function getAcquisitionJobs(): Promise<AcquisitionResponse> {
  ensureAcquisitionWorkers();

  return {
    updatedAt: new Date().toISOString(),
    jobs: sortJobs([...acquisitionState.jobs.values()]).map(cloneJob)
  };
}

async function addMovie(
  item: MediaItem,
  preferences: Preferences,
  options?: RequestItemOptions
): Promise<RequestResponse> {
  const sourceId = asNumber(asRecord(item.requestPayload).id);
  if (item.inArr && sourceId) {
    const activeJob = findActiveJob(sourceId, 'movie');
    return {
      existing: true,
      item: await fetchExistingMovie(sourceId, preferences),
      message: `${item.title} is already tracked in Radarr`,
      releaseDecision: null,
      job: activeJob ? cloneJob(activeJob) : null
    };
  }

  if (item.inArr) {
    return {
      existing: true,
      item: {
        ...item,
        canAdd: false,
        inArr: true,
        status: 'Already in Arr'
      },
      message: `${item.title} is already tracked in Radarr`,
      releaseDecision: null,
      job: null
    };
  }

  ensureAddable(item);

  const defaults = await fetchDefaults('radarr');
  ensureRootFolder(defaults, 'radarr');

  const raw = asRecord(item.requestPayload);
  const payload = {
    ...raw,
    monitored: false,
    minimumAvailability: asString(raw.minimumAvailability) ?? 'released',
    rootFolderPath: asString(raw.rootFolderPath) ?? asString(defaults.rootFolderPath),
    qualityProfileId:
      options?.qualityProfileId ??
      asPositiveNumber(raw.qualityProfileId) ??
      asPositiveNumber(defaults.qualityProfileId),
    addOptions: {
      searchForMovie: false
    }
  };

  const created = asRecord(
    await arrFetch<unknown>('radarr', '/api/v3/movie', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  );

  const createdId = asNumber(created.id);
  const baseItem = createdId
    ? await fetchExistingMovie(createdId, preferences)
    : normalizeItem('movie', created, preferences, {
        id: `movie:${crypto.randomUUID()}`,
        sourceService: 'radarr',
        inArr: true,
        canAdd: false
      });

  if (!createdId) {
    return {
      existing: false,
      item: baseItem,
      message: `${item.title} was added to Radarr`,
      releaseDecision: null,
      job: null
    };
  }

  const job = createJob(baseItem, createdId, 'radarr', preferences);

  return {
    existing: false,
    item: baseItem,
    message: `${item.title} was added to Radarr. Acquisition started.`,
    releaseDecision: null,
    job: cloneJob(job)
  };
}

async function addSeries(
  item: MediaItem,
  preferences: Preferences,
  options?: RequestItemOptions
): Promise<RequestResponse> {
  const sourceId = asNumber(asRecord(item.requestPayload).id);
  if (item.inArr && sourceId) {
    const activeJob = findActiveJob(sourceId, 'series');
    return {
      existing: true,
      item: await fetchExistingSeries(sourceId, preferences, null, item.detail),
      message: `${item.title} is already tracked in Sonarr`,
      releaseDecision: null,
      job: activeJob ? cloneJob(activeJob) : null
    };
  }

  if (item.inArr) {
    return {
      existing: true,
      item: {
        ...item,
        canAdd: false,
        inArr: true,
        status: 'Already in Arr'
      },
      message: `${item.title} is already tracked in Sonarr`,
      releaseDecision: null,
      job: null
    };
  }

  ensureAddable(item);

  const defaults = await fetchDefaults('sonarr');
  ensureRootFolder(defaults, 'sonarr');

  const created = asRecord(
    await arrFetch<unknown>('sonarr', '/api/v3/series', {
      method: 'POST',
      body: JSON.stringify(buildSeriesPayload(item, defaults, options))
    })
  );

  const createdId = asNumber(created.id);
  const baseItem = createdId
    ? await fetchExistingSeries(createdId, preferences, null, item.detail)
    : normalizeItem('series', created, preferences, {
        id: `series:${crypto.randomUUID()}`,
        sourceService: 'sonarr',
        inArr: true,
        canAdd: false
      });

  if (!createdId) {
    return {
      existing: false,
      item: baseItem,
      message: `${item.title} was added to Sonarr`,
      releaseDecision: null,
      job: null
    };
  }

  const job = createJob(baseItem, createdId, 'sonarr', preferences);

  return {
    existing: false,
    item: baseItem,
    message: `${item.title} was added to Sonarr. Acquisition started.`,
    releaseDecision: null,
    job: cloneJob(job)
  };
}

export async function requestItem(
  item: MediaItem,
  preferences?: Partial<Preferences>,
  options?: RequestItemOptions
): Promise<RequestResponse> {
  const normalizedPreferences = sanitizePreferences(preferences);
  return item.kind === 'movie'
    ? addMovie(item, normalizedPreferences, options)
    : addSeries(item, normalizedPreferences, options);
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
  if (!getConfigFlags().radarrConfigured) {
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
        auditStatus: 'pending',
        inArr: true,
        canAdd: false
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
          isRequested: true,
          inArr: true,
          canAdd: false
        })
      );
    }
  }

  return items;
}

async function buildSeriesHistoryItems(preferences: Preferences): Promise<MediaItem[]> {
  if (!getConfigFlags().sonarrConfigured) {
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
        detail: asString(episode.title),
        inArr: true,
        canAdd: false
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
          isRequested: true,
          inArr: true,
          canAdd: false
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

function formatQueueStatus(record: Record<string, unknown>): string {
  return (
    asString(record.status) ??
    asString(record.trackedDownloadStatus) ??
    asString(record.trackedDownloadState) ??
    'Queued'
  )
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeQueueItem(service: ArrService, rawValue: unknown): QueueItem | null {
  const record = asRecord(rawValue);
  const parent = service === 'radarr' ? asRecord(record.movie) : asRecord(record.series);
  const title = asString(parent.title);
  if (!title) {
    return null;
  }

  const size = asNumber(record.size);
  const sizeLeft = asNumber(record.sizeleft) ?? asNumber(record.sizeLeft);
  const computedProgress =
    size !== null && size > 0 && sizeLeft !== null
      ? Math.max(0, Math.min(100, ((size - sizeLeft) / size) * 100))
      : null;
  const progress = asNumber(record.progress) ?? computedProgress;
  const episode = asRecord(record.episode);

  return {
    id: `${service}:queue:${asString(record.downloadId) ?? asString(record.id) ?? crypto.randomUUID()}`,
    kind: service === 'radarr' ? 'movie' : 'series',
    title,
    year: asNumber(parent.year),
    poster: extractPoster(parent),
    sourceService: service,
    status: formatQueueStatus(record),
    progress,
    timeLeft: asString(record.timeleft) ?? asString(record.timeLeft),
    estimatedCompletionTime: asString(record.estimatedCompletionTime),
    size,
    sizeLeft,
    detail:
      asString(record.title) ??
      asString(record.sourceTitle) ??
      asString(episode.title) ??
      null
  };
}

async function buildQueueItems(service: ArrService): Promise<QueueItem[]> {
  if (!getConfigFlags()[service === 'radarr' ? 'radarrConfigured' : 'sonarrConfigured']) {
    return [];
  }

  const records = await arrFetch<unknown>(service, '/api/v3/queue', undefined, {
    pageSize: 25,
    page: 1,
    sortKey: 'timeleft',
    sortDirection: 'ascending'
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

  const items = (
    await Promise.all([buildQueueItems('radarr'), buildQueueItems('sonarr')])
  )
    .flat()
    .sort((left, right) => {
      const leftProgress = left.progress ?? 0;
      const rightProgress = right.progress ?? 0;
      if (leftProgress !== rightProgress) {
        return rightProgress - leftProgress;
      }

      return left.title.localeCompare(right.title);
    });

  const acquisitionJobs = sortJobs([...acquisitionState.jobs.values()])
    .filter((job) => !isTerminalJobStatus(job.status) || Date.now() - Date.parse(job.updatedAt) < 24 * 60 * 60_000)
    .map(cloneJob);

  const value: QueueResponse = {
    updatedAt: new Date().toISOString(),
    items,
    acquisitionJobs,
    total: items.length + acquisitionJobs.length
  };

  queueCache.set(cacheKey, { expiresAt: now + 15_000, value });
  return value;
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
