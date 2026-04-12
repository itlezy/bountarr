import { arrFetch } from '$lib/server/arr-client';
import { itemMatchKeys, itemSearchTitles } from '$lib/server/media-identity';
import { mergeItems, normalizeItem, sortSearchResults } from '$lib/server/media-normalize';
import { searchPlex } from '$lib/server/plex-service';
import { asNumber, asRecord, asString } from '$lib/server/raw';
import { getConfiguredServiceFlags } from '$lib/server/runtime';
import { sanitizePreferences } from '$lib/shared/preferences';
import type { MediaItem, Preferences, SearchAvailability, SearchKind } from '$lib/shared/types';

const SEARCH_RESULT_LIMIT = 24;

function searchTermVariants(term: string): string[] {
  const trimmed = term.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const variants = new Set<string>([trimmed]);
  const withoutParentheticalYear = trimmed.replace(/\s*\((19|20)\d{2}\)\s*$/u, '').trim();
  const withoutTrailingYear = trimmed.replace(/[\s:.-]+(19|20)\d{2}\s*$/u, '').trim();

  for (const variant of [withoutParentheticalYear, withoutTrailingYear]) {
    if (variant.length >= 2 && variant !== trimmed) {
      variants.add(variant);
    }
  }

  return [...variants];
}

function matchesByIdentity(left: MediaItem, right: MediaItem): boolean {
  const rightKeys = new Set(itemMatchKeys(right));
  return itemMatchKeys(left).some((key) => rightKeys.has(key));
}

function hasLookupId(raw: Record<string, unknown>): boolean {
  const id = asNumber(raw.id);
  return id !== null && id > 0;
}

function hasTrackedPath(raw: Record<string, unknown>): boolean {
  return asString(raw.path) !== null;
}

function hasNonDefaultAddedTimestamp(raw: Record<string, unknown>): boolean {
  const added = asString(raw.added);
  if (!added) {
    return false;
  }

  const parsed = Date.parse(added);
  if (Number.isNaN(parsed)) {
    return true;
  }

  return new Date(parsed).getUTCFullYear() > 1900;
}

function isTrackedMovieLookupResult(raw: Record<string, unknown>): boolean {
  return (
    hasLookupId(raw) ||
    raw.hasFile === true ||
    hasTrackedPath(raw) ||
    hasNonDefaultAddedTimestamp(raw)
  );
}

function isTrackedSeriesLookupResult(raw: Record<string, unknown>): boolean {
  return hasLookupId(raw) || hasTrackedPath(raw) || hasNonDefaultAddedTimestamp(raw);
}

async function findSupplementalPlexItems(
  term: string,
  kind: SearchKind,
  arrItems: MediaItem[],
  plexItems: MediaItem[],
): Promise<MediaItem[]> {
  const knownPlexKeys = new Set(plexItems.flatMap((item) => itemMatchKeys(item)));
  const originalTerms = new Set(searchTermVariants(term));
  const unresolvedItems = sortSearchResults(term, arrItems)
    .filter((item) => item.canAdd && !item.inPlex)
    .filter((item) => itemMatchKeys(item).every((key) => !knownPlexKeys.has(key)))
    // Supplemental Plex lookups only need to cover items that can still appear in the
    // final response. A smaller cutoff caused broad franchise searches like "rambo"
    // to miss older titles that still survived into the top result set.
    .slice(0, SEARCH_RESULT_LIMIT);
  const fallbackTitles = [
    ...new Set(
      unresolvedItems.flatMap((item) =>
        itemSearchTitles(item).map((candidateTitle) => candidateTitle.trim()),
      ),
    ),
  ].filter((title) => title.length >= 2 && !originalTerms.has(title));

  if (fallbackTitles.length === 0) {
    return [];
  }

  const supplemental = (
    await Promise.all(fallbackTitles.map((title) => searchPlex(title, kind)))
  ).flat();

  return supplemental.filter((plexItem) =>
    unresolvedItems.some((arrItem) => matchesByIdentity(arrItem, plexItem)),
  );
}

async function fetchMovieFile(movieFileId: number): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(await arrFetch<unknown>('radarr', `/api/v3/moviefile/${movieFileId}`));
  } catch {
    return null;
  }
}

export async function fetchEpisodeFile(
  episodeFileId: number,
): Promise<Record<string, unknown> | null> {
  try {
    return asRecord(await arrFetch<unknown>('sonarr', `/api/v3/episodefile/${episodeFileId}`));
  } catch {
    return null;
  }
}

async function discoverSeriesEpisodeFileId(seriesId: number): Promise<number | null> {
  try {
    const episodes = (
      await arrFetch<unknown[]>('sonarr', '/api/v3/episode', undefined, {
        seriesId,
      })
    )
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

export async function fetchExistingMovie(id: number, preferences: Preferences): Promise<MediaItem> {
  const movie = asRecord(await arrFetch<unknown>('radarr', `/api/v3/movie/${id}`));
  const movieFileId = asNumber(movie.movieFileId);
  const movieFile = movieFileId ? await fetchMovieFile(movieFileId) : null;

  return normalizeItem(
    'movie',
    movieFile
      ? {
          ...movie,
          movieFile,
        }
      : movie,
    preferences,
    {
      id: `movie:${id}`,
      inArr: true,
      canAdd: false,
    },
  );
}

export async function fetchExistingSeries(
  id: number,
  preferences: Preferences,
  episodeFileId?: number | null,
  detail?: string | null,
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
        episodeFile: richEpisodeFile,
      },
      preferences,
      {
        id: `series:${id}:${resolvedEpisodeFileId}`,
        detail: detail ?? null,
        inArr: true,
        canAdd: false,
      },
    );
  }

  return normalizeItem('series', series, preferences, {
    id: `series:${id}`,
    detail: detail ?? null,
    inArr: true,
    canAdd: false,
  });
}

async function lookupArrItems(
  term: string,
  kind: SearchKind,
  preferences: Preferences,
): Promise<MediaItem[]> {
  const status = getConfiguredServiceFlags();
  const terms = searchTermVariants(term);
  const tasks: Promise<MediaItem[]>[] = [];

  if ((kind === 'all' || kind === 'movie') && status.radarrConfigured) {
    tasks.push(
      Promise.all(
        terms.map((candidateTerm) =>
          arrFetch<unknown[]>('radarr', '/api/v3/movie/lookup', undefined, { term: candidateTerm })
            .then((items) =>
              Promise.all(
                items.map(async (item) => {
                  const raw = asRecord(item);
                  const id = asNumber(raw.id);
                  const tracked = isTrackedMovieLookupResult(raw);

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
                    requestPayload: raw,
                  });
                }),
              ),
            )
            .catch(() => []),
        ),
      ).then((results) => results.flat()),
    );
  }

  if ((kind === 'all' || kind === 'series') && status.sonarrConfigured) {
    tasks.push(
      Promise.all(
        terms.map((candidateTerm) =>
          arrFetch<unknown[]>('sonarr', '/api/v3/series/lookup', undefined, { term: candidateTerm })
            .then((items) =>
              Promise.all(
                items.map(async (item) => {
                  const raw = asRecord(item);
                  const id = asNumber(raw.id);
                  const tracked = isTrackedSeriesLookupResult(raw);

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
                    status: tracked ? undefined : 'Ready to add',
                    requestPayload: raw,
                  });
                }),
              ),
            )
            .catch(() => []),
        ),
      ).then((results) => results.flat()),
    );
  }

  return (await Promise.all(tasks)).flat();
}

export async function lookupItems(
  term: string,
  kind: SearchKind,
  preferences?: Partial<Preferences>,
  options?: { availability?: SearchAvailability },
): Promise<MediaItem[]> {
  const normalizedPreferences = sanitizePreferences(preferences);
  const availability = options?.availability ?? 'not-available-only';
  const terms = searchTermVariants(term);
  const [arrItems, initialPlexItems] = await Promise.all([
    lookupArrItems(term, kind, normalizedPreferences),
    Promise.all(terms.map((candidateTerm) => searchPlex(candidateTerm, kind))).then((results) =>
      results.flat(),
    ),
  ]);
  const plexItems = [
    ...initialPlexItems,
    ...(await findSupplementalPlexItems(term, kind, arrItems, initialPlexItems)),
  ];

  const merged = new Map<string, MediaItem>();

  for (const item of [...arrItems, ...plexItems]) {
    const keys = itemMatchKeys(item);
    const existingKey = keys.find((key) => merged.has(key));
    const existing = existingKey ? (merged.get(existingKey) ?? null) : null;
    const mergedItem = existing ? mergeItems(existing, item) : item;

    for (const key of new Set([
      ...(existing ? itemMatchKeys(existing) : []),
      ...keys,
      ...itemMatchKeys(mergedItem),
    ])) {
      merged.set(key, mergedItem);
    }
  }

  const deduped = [...new Set(merged.values())];
  const filtered =
    availability === 'all'
      ? deduped
      : availability === 'available-only'
        ? deduped.filter((item) => item.inPlex)
        : deduped.filter((item) => !item.inPlex);

  return sortSearchResults(term, filtered).slice(0, SEARCH_RESULT_LIMIT);
}
