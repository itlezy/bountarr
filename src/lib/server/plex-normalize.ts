import { extractGuidIds, titleKeyVariants } from '$lib/server/media-identity';
import { extractDisplayRating } from '$lib/server/media-normalize';
import { asNumber, asScalarString, asString } from '$lib/server/raw';
import type { MediaItem, MediaKind } from '$lib/shared/types';

export type PlexSection = {
  key: string;
  title: string;
  kind: MediaKind;
};

export type PlexTimedItem = {
  addedAt: number;
  item: MediaItem;
};

export function extractPlexPoster(
  raw: Record<string, unknown>,
  baseUrl: string,
  token: string,
): string | null {
  const thumb = asString(raw.thumb) ?? asString(raw.art);
  if (!thumb) {
    return null;
  }

  const url = new URL(thumb, baseUrl);
  url.searchParams.set('X-Plex-Token', token);
  return url.toString();
}

export function normalizePlexSectionKind(value: string | null): MediaKind | null {
  if (value === 'movie') {
    return 'movie';
  }

  if (value === 'show') {
    return 'series';
  }

  return null;
}

export function hasStablePlexExternalIds(raw: Record<string, unknown>): boolean {
  const guidIds = extractGuidIds(raw);
  const imdbId = asString(raw.guid);

  return Boolean(
    guidIds.imdb ||
      guidIds.tmdb ||
      guidIds.tvdb ||
      guidIds.tvmaze ||
      (imdbId?.startsWith('imdb://')
        ? imdbId.slice('imdb://'.length).trim().toLowerCase()
        : null) ||
      asScalarString(raw.imdbId) ||
      asScalarString(raw.tmdbId) ||
      asScalarString(raw.tvdbId) ||
      asScalarString(raw.tvMazeId),
  );
}

export function itemMergeKeys(item: MediaItem): string[] {
  const payload =
    typeof item.requestPayload === 'object' && item.requestPayload !== null
      ? (item.requestPayload as Record<string, unknown>)
      : {};
  const keys = new Set<string>();
  const pushKey = (prefix: string, value: string | null) => {
    if (value) {
      keys.add(`${item.kind}:${prefix}:${value.toLowerCase()}`);
    }
  };

  const guidIds = extractGuidIds(payload);
  pushKey('imdb', guidIds.imdb ?? asScalarString(payload.imdbId));
  pushKey('tmdb', guidIds.tmdb ?? asScalarString(payload.tmdbId));
  pushKey('tvdb', guidIds.tvdb ?? asScalarString(payload.tvdbId));
  pushKey('tvmaze', guidIds.tvmaze ?? asScalarString(payload.tvMazeId));
  for (const key of titleKeyVariants(item.kind, item.title, item.year)) {
    keys.add(key);
  }

  return [...keys];
}

export function mergePlexResults(items: MediaItem[]): MediaItem[] {
  const merged = new Map<string, MediaItem>();

  for (const item of items) {
    const keys = itemMergeKeys(item);
    const existingKey = keys.find((key) => merged.has(key));
    const existing = existingKey ? (merged.get(existingKey) ?? null) : null;

    if (!existing) {
      for (const key of keys) {
        merged.set(key, item);
      }
      continue;
    }

    const mergedItem = {
      ...existing,
      plexLibraries: Array.from(new Set([...existing.plexLibraries, ...item.plexLibraries])),
    };

    for (const key of new Set([...itemMergeKeys(existing), ...keys])) {
      merged.set(key, mergedItem);
    }
  }

  return [...new Set(merged.values())];
}

export function normalizePlexSectionResult(
  raw: Record<string, unknown>,
  section: PlexSection,
  baseUrl: string,
  token: string,
): MediaItem {
  return {
    id: `plex:${section.kind}:${asString(raw.ratingKey) ?? crypto.randomUUID()}`,
    kind: section.kind,
    title: asString(raw.title) ?? 'Untitled',
    year: asNumber(raw.year),
    rating: extractDisplayRating(raw),
    poster: extractPlexPoster(raw, baseUrl, token),
    overview: asString(raw.summary) ?? '',
    status: 'Already in Plex',
    isExisting: false,
    isRequested: false,
    auditStatus: 'pending',
    audioLanguages: [],
    subtitleLanguages: [],
    sourceService: 'plex',
    origin: 'plex',
    inArr: false,
    inPlex: true,
    plexLibraries: [section.title],
    canAdd: false,
    detail: null,
    requestPayload: raw,
  };
}

export function normalizePlexRecentSectionResult(
  raw: Record<string, unknown>,
  section: PlexSection,
  baseUrl: string,
  token: string,
): MediaItem {
  if (section.kind === 'series' && asString(raw.type) === 'episode') {
    return {
      id: `plex:series:${asString(raw.grandparentRatingKey) ?? asString(raw.ratingKey) ?? crypto.randomUUID()}`,
      kind: 'series',
      title: asString(raw.grandparentTitle) ?? asString(raw.title) ?? 'Untitled',
      year: asNumber(raw.year),
      rating: extractDisplayRating(raw),
      poster: extractPlexPoster(
        {
          ...raw,
          thumb: asString(raw.grandparentThumb) ?? asString(raw.thumb),
          art: asString(raw.grandparentArt) ?? asString(raw.art),
        },
        baseUrl,
        token,
      ),
      overview: asString(raw.summary) ?? '',
      status: 'Already in Plex',
      isExisting: false,
      isRequested: false,
      auditStatus: 'pending',
      audioLanguages: [],
      subtitleLanguages: [],
      sourceService: 'plex',
      origin: 'plex',
      inArr: false,
      inPlex: true,
      plexLibraries: [section.title],
      canAdd: false,
      detail: asString(raw.title) ?? null,
      requestPayload: raw,
    };
  }

  return normalizePlexSectionResult(raw, section, baseUrl, token);
}
