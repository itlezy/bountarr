import { evaluateAudit } from '$lib/server/audit';
import { extractGuidIds, normalizeToken } from '$lib/server/media-identity';
import { asArray, asNumber, asRecord, asScalarString, asString } from '$lib/server/raw';
import type { MediaItem, MediaKind, Preferences } from '$lib/shared/types';

export function formatLabel(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function extractPopularity(item: MediaItem): number {
  const payload = asRecord(item.requestPayload);
  return (
    asNumber(payload.popularity) ??
    asNumber(asRecord(payload.ratings).value) ??
    asNumber(asRecord(asRecord(payload.ratings).tmdb).value) ??
    asNumber(asRecord(asRecord(payload.ratings).imdb).value) ??
    0
  );
}

export function extractDisplayRating(raw: Record<string, unknown>): number | null {
  const ratings = asRecord(raw.ratings);

  return (
    asNumber(asRecord(ratings.tmdb).value) ??
    asNumber(asRecord(ratings.imdb).value) ??
    asNumber(ratings.value) ??
    asNumber(raw.audienceRating) ??
    asNumber(raw.rating)
  );
}

export function extractPoster(raw: Record<string, unknown>): string | null {
  const images = asArray(raw.images);

  for (const image of images) {
    const record = asRecord(image);
    if (asString(record.coverType) === 'poster') {
      return asString(record.remoteUrl) ?? asString(record.url);
    }
  }

  return null;
}

export function normalizeLanguageEntries(value: unknown): string[] {
  const directString = asString(value);
  if (directString) {
    return directString
      .split(/[/,]/)
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

export function normalizeItem(
  kind: MediaKind,
  rawValue: unknown,
  preferences: Preferences,
  fallback: Partial<MediaItem> = {},
): MediaItem {
  const raw = asRecord(rawValue);
  const mediaInfo = mediaInfoFromItem(raw);
  const audioLanguages = normalizeLanguageEntries(mediaInfo?.audioLanguages);
  const subtitleLanguages = normalizeLanguageEntries(
    mediaInfo?.subtitles ?? mediaInfo?.subtitleLanguages,
  );
  const hasMediaInfo = mediaInfo !== null;
  const inferredExisting = isTracked(raw);
  const sourceService = fallback.sourceService ?? (kind === 'movie' ? 'radarr' : 'sonarr');
  const inArr = fallback.inArr ?? (sourceService !== 'plex' && inferredExisting);
  const inPlex = fallback.inPlex ?? sourceService === 'plex';
  const arrItemId =
    fallback.arrItemId ??
    (sourceService === 'plex'
      ? null
      : (asNumber(raw.id) ??
        asNumber(asRecord(raw.movie).id) ??
        asNumber(asRecord(raw.series).id)));
  const canAdd = fallback.canAdd ?? (sourceService !== 'plex' && !inArr);
  const canDeleteFromArr =
    fallback.canDeleteFromArr ?? (sourceService !== 'plex' && inArr && arrItemId !== null);
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
    arrItemId,
    kind,
    title,
    year: asNumber(raw.year) ?? fallback.year ?? null,
    rating: fallback.rating ?? extractDisplayRating(raw),
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
    canDeleteFromArr,
    detail: fallback.detail ?? asString(raw.sourceTitle) ?? null,
    requestPayload: fallback.requestPayload ?? raw,
  };
}

export function mergeItems(left: MediaItem, right: MediaItem): MediaItem {
  const inArr = left.inArr || right.inArr;
  const inPlex = left.inPlex || right.inPlex;
  const arrItem = left.inArr ? left : right.inArr ? right : null;
  const plexItem = left.inPlex ? left : right.inPlex ? right : null;
  const arrItemId = arrItem?.arrItemId ?? left.arrItemId ?? right.arrItemId ?? null;
  const sourceService = arrItem?.sourceService ?? plexItem?.sourceService ?? left.sourceService;

  return {
    ...(arrItem ?? left),
    id: arrItem?.id ?? left.id,
    arrItemId,
    poster: arrItem?.poster ?? plexItem?.poster ?? left.poster,
    overview: arrItem?.overview || plexItem?.overview || left.overview,
    rating: arrItem?.rating ?? plexItem?.rating ?? left.rating,
    detail: arrItem?.detail ?? plexItem?.detail ?? left.detail,
    sourceService,
    origin: inArr && inPlex ? 'merged' : inPlex ? 'plex' : 'arr',
    inArr,
    inPlex,
    plexLibraries: Array.from(
      new Set([...(left.plexLibraries ?? []), ...(right.plexLibraries ?? [])]),
    ),
    canAdd: !inPlex && Boolean(arrItem?.canAdd ?? (!inArr && (left.canAdd || right.canAdd))),
    canDeleteFromArr: sourceService !== 'plex' && inArr && arrItemId !== null,
    status: inArr
      ? (arrItem?.status ?? 'Already in Arr')
      : inPlex
        ? 'Already in Plex'
        : left.status,
    requestPayload: arrItem?.requestPayload ?? left.requestPayload ?? right.requestPayload,
  };
}

const leadingArticlePattern = /^(the|a|an)\s+/u;

function canonicalizeSearchTitle(value: string): string {
  return normalizeToken(value).replace(leadingArticlePattern, '').trim();
}

function hasPhraseMatch(value: string, phrase: string): boolean {
  if (value.length === 0 || phrase.length === 0) {
    return false;
  }

  return (
    value === phrase ||
    value.startsWith(`${phrase} `) ||
    value.endsWith(` ${phrase}`) ||
    value.includes(` ${phrase} `)
  );
}

function titleStrength(term: string, item: MediaItem): number {
  const normalizedTitle = normalizeToken(item.title);
  const canonicalTitle = canonicalizeSearchTitle(item.title);
  const canonicalTerm = canonicalizeSearchTitle(term);

  if (normalizedTitle === term) {
    return 7;
  }

  if (canonicalTitle === canonicalTerm) {
    return 6;
  }

  if (normalizedTitle.startsWith(`${term} `)) {
    return 5;
  }

  if (canonicalTitle.startsWith(`${canonicalTerm} `)) {
    return 4;
  }

  if (hasPhraseMatch(normalizedTitle, term)) {
    return 3;
  }

  if (hasPhraseMatch(canonicalTitle, canonicalTerm)) {
    return 2;
  }

  if (normalizedTitle.includes(term) || canonicalTitle.includes(canonicalTerm)) {
    return 1;
  }

  return 0;
}

export function sortSearchResults(term: string, items: MediaItem[]): MediaItem[] {
  const normalizedTerm = normalizeToken(term);

  return [...items].sort((left, right) => {
    const titleDifference =
      titleStrength(normalizedTerm, right) - titleStrength(normalizedTerm, left);
    const seriesOnly = left.kind === 'series' && right.kind === 'series';
    if (seriesOnly && titleDifference !== 0) {
      return titleDifference;
    }

    const addableDifference = Number(right.canAdd) - Number(left.canAdd);
    if (addableDifference !== 0) {
      return addableDifference;
    }

    if (titleDifference !== 0) {
      return titleDifference;
    }

    const yearDifference = (right.year ?? 0) - (left.year ?? 0);
    if (yearDifference !== 0) {
      return yearDifference;
    }

    const popularityDifference = extractPopularity(right) - extractPopularity(left);
    if (popularityDifference !== 0) {
      return popularityDifference;
    }

    return left.title.localeCompare(right.title);
  });
}

export function hasStableExternalIds(raw: Record<string, unknown>): boolean {
  const guidIds = extractGuidIds(raw);
  return Boolean(
    guidIds.imdb ||
      guidIds.tmdb ||
      guidIds.tvdb ||
      guidIds.tvmaze ||
      asScalarString(raw.imdbId) ||
      asScalarString(raw.tmdbId) ||
      asScalarString(raw.tvdbId) ||
      asScalarString(raw.tvMazeId),
  );
}
