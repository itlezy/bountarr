import { env } from '$env/dynamic/private';
import type { MediaItem, MediaKind, SearchKind } from '$lib/shared/types';

type PlexSection = {
  key: string;
  title: string;
  kind: MediaKind;
};

type PlexTimedItem = {
  addedAt: number;
  item: MediaItem;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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

function extractPoster(raw: Record<string, unknown>, baseUrl: string, token: string): string | null {
  const thumb = asString(raw.thumb) ?? asString(raw.art);
  if (!thumb) {
    return null;
  }

  const url = new URL(thumb, baseUrl);
  url.searchParams.set('X-Plex-Token', token);
  return url.toString();
}

function normalizeSectionKind(value: string | null): MediaKind | null {
  if (value === 'movie') {
    return 'movie';
  }

  if (value === 'show') {
    return 'series';
  }

  return null;
}

function normalizeTitleKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[-_]+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

  const imdbId = asString(raw.guid);
  if (imdbId?.startsWith('imdb://')) {
    ids.imdb = imdbId.slice('imdb://'.length).trim().toLowerCase();
  }

  return ids;
}

function hasStableExternalIds(raw: Record<string, unknown>): boolean {
  const guidIds = extractGuidIds(raw);
  return Boolean(
    guidIds.imdb ||
      guidIds.tmdb ||
      guidIds.tvdb ||
      guidIds.tvmaze ||
      asScalarString(raw.imdbId) ||
      asScalarString(raw.tmdbId) ||
      asScalarString(raw.tvdbId) ||
      asScalarString(raw.tvMazeId)
  );
}

async function hydrateMetadataIfNeeded(
  baseUrl: string,
  token: string,
  raw: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const ratingKey = asString(raw.ratingKey);
  if (!ratingKey || hasStableExternalIds(raw)) {
    return raw;
  }

  try {
    const payload = asRecord(
      await plexFetch<unknown>(baseUrl, token, `/library/metadata/${ratingKey}`, {
        includeGuids: '1'
      })
    );
    const metadata = asRecord(asArray(asRecord(payload.MediaContainer).Metadata)[0]);
    if (Object.keys(metadata).length === 0) {
      return raw;
    }

    return {
      ...metadata,
      ...raw,
      Guid: metadata.Guid ?? raw.Guid,
      guids: metadata.guids ?? raw.guids
    };
  } catch {
    return raw;
  }
}

function itemMergeKeys(item: MediaItem): string[] {
  const payload = asRecord(item.requestPayload);
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
  keys.add(`${item.kind}:title:${normalizeTitleKey(item.title)}:${item.year ?? 'na'}`);

  return [...keys];
}

function mergePlexResults(items: MediaItem[]): MediaItem[] {
  const merged = new Map<string, MediaItem>();

  for (const item of items) {
    const keys = itemMergeKeys(item);
    const existingKey = keys.find((key) => merged.has(key));
    const existing = existingKey ? merged.get(existingKey) ?? null : null;

    if (!existing) {
      for (const key of keys) {
        merged.set(key, item);
      }
      continue;
    }

    const mergedItem = {
      ...existing,
      plexLibraries: Array.from(new Set([...existing.plexLibraries, ...item.plexLibraries]))
    };

    for (const key of new Set([...itemMergeKeys(existing), ...keys])) {
      merged.set(key, mergedItem);
    }
  }

  return [...new Set(merged.values())];
}

async function plexFetch<T>(baseUrl: string, token: string, path: string, query?: Record<string, string>): Promise<T> {
  const url = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`);
  url.searchParams.set('X-Plex-Token', token);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Plex ${response.status}`);
  }

  return (await response.json()) as T;
}

async function fetchSections(baseUrl: string, token: string, searchKind: SearchKind): Promise<PlexSection[]> {
  const payload = asRecord(await plexFetch<unknown>(baseUrl, token, '/library/sections'));
  const sections = asArray(asRecord(payload.MediaContainer).Directory).map(asRecord);

  return sections
    .map((section) => {
      const kind = normalizeSectionKind(asString(section.type));
      if (!kind) {
        return null;
      }

      if (searchKind !== 'all' && searchKind !== kind) {
        return null;
      }

      const key = asString(section.key);
      const title = asString(section.title);
      if (!key || !title) {
        return null;
      }

      return {
        key,
        title,
        kind
      } satisfies PlexSection;
    })
    .filter((section): section is PlexSection => section !== null);
}

function normalizeSectionResult(
  raw: Record<string, unknown>,
  section: PlexSection,
  baseUrl: string,
  token: string
): MediaItem {
  return {
    id: `plex:${section.kind}:${asString(raw.ratingKey) ?? crypto.randomUUID()}`,
    kind: section.kind,
    title: asString(raw.title) ?? 'Untitled',
    year: asNumber(raw.year),
    poster: extractPoster(raw, baseUrl, token),
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
    requestPayload: raw
  };
}

function normalizeRecentSectionResult(
  raw: Record<string, unknown>,
  section: PlexSection,
  baseUrl: string,
  token: string
): MediaItem {
  if (section.kind === 'series' && asString(raw.type) === 'episode') {
    return {
      id: `plex:series:${asString(raw.grandparentRatingKey) ?? asString(raw.ratingKey) ?? crypto.randomUUID()}`,
      kind: 'series',
      title: asString(raw.grandparentTitle) ?? asString(raw.title) ?? 'Untitled',
      year: asNumber(raw.year),
      poster: extractPoster(
        {
          ...raw,
          thumb: asString(raw.grandparentThumb) ?? asString(raw.thumb),
          art: asString(raw.grandparentArt) ?? asString(raw.art)
        },
        baseUrl,
        token
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
      requestPayload: raw
    };
  }

  return normalizeSectionResult(raw, section, baseUrl, token);
}

async function searchSection(
  baseUrl: string,
  token: string,
  section: PlexSection,
  term: string
): Promise<MediaItem[]> {
  try {
    const payload = asRecord(
      await plexFetch<unknown>(baseUrl, token, `/library/sections/${section.key}/search`, {
        query: term,
        includeGuids: '1'
      })
    );

    return await Promise.all(
      asArray(asRecord(payload.MediaContainer).Metadata)
        .map(asRecord)
        .filter((entry) => asString(entry.title) !== null)
        .map(async (entry) =>
          normalizeSectionResult(await hydrateMetadataIfNeeded(baseUrl, token, entry), section, baseUrl, token)
        )
    );
  } catch {
    return [];
  }
}

async function searchGlobalHubs(
  baseUrl: string,
  token: string,
  searchKind: SearchKind,
  term: string
): Promise<MediaItem[]> {
  try {
    const payload = asRecord(
      await plexFetch<unknown>(baseUrl, token, '/hubs/search', {
        query: term,
        includeGuids: '1'
      })
    );

    const hubs = asArray(asRecord(payload.MediaContainer).Hub).map(asRecord);
    const items: MediaItem[] = [];

    for (const hub of hubs) {
      const type = normalizeSectionKind(asString(hub.type));
      if (!type) {
        continue;
      }

      if (searchKind !== 'all' && searchKind !== type) {
        continue;
      }

      for (const rawEntry of asArray(hub.Metadata).map(asRecord)) {
        const entry = await hydrateMetadataIfNeeded(baseUrl, token, rawEntry);
        const libraryTitle =
          asString(entry.librarySectionTitle) ??
          asString(entry.reasonTitle) ??
          'Plex';

        items.push({
          id: `plex:${type}:${asString(entry.ratingKey) ?? crypto.randomUUID()}`,
          kind: type,
          title: asString(entry.title) ?? 'Untitled',
          year: asNumber(entry.year),
          poster: extractPoster(entry, baseUrl, token),
          overview: asString(entry.summary) ?? '',
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
          plexLibraries: [libraryTitle],
          canAdd: false,
          detail: null,
          requestPayload: entry
        });
      }
    }

    return items;
  } catch {
    return [];
  }
}

async function fetchRecentSectionItems(
  baseUrl: string,
  token: string,
  section: PlexSection
): Promise<PlexTimedItem[]> {
  try {
    const payload = asRecord(
      await plexFetch<unknown>(baseUrl, token, `/library/sections/${section.key}/recentlyAdded`)
    );

    return asArray(asRecord(payload.MediaContainer).Metadata)
      .map(asRecord)
      .filter((entry) => asString(entry.title) !== null)
      .map((entry) => ({
        addedAt: asNumber(entry.addedAt) ?? 0,
        item: normalizeRecentSectionResult(entry, section, baseUrl, token)
      }));
  } catch {
    return [];
  }
}

export async function searchPlex(term: string, searchKind: SearchKind): Promise<MediaItem[]> {
  const baseUrl = env.PLEX_URL?.trim();
  const token = env.PLEX_TOKEN?.trim();

  if (!baseUrl || !token) {
    return [];
  }

  try {
    const sections = await fetchSections(baseUrl, token, searchKind);
    const [hubItems, sectionItems] = await Promise.all([
      searchGlobalHubs(baseUrl, token, searchKind, term),
      Promise.all(sections.map((section) => searchSection(baseUrl, token, section, term))).then((results) => results.flat())
    ]);

    return mergePlexResults([...hubItems, ...sectionItems]);
  } catch {
    return [];
  }
}

export async function getRecentPlexItems(limit = 12): Promise<MediaItem[]> {
  const baseUrl = env.PLEX_URL?.trim();
  const token = env.PLEX_TOKEN?.trim();

  if (!baseUrl || !token) {
    return [];
  }

  const sections = await fetchSections(baseUrl, token, 'all');
  const results = (
    await Promise.all(sections.map((section) => fetchRecentSectionItems(baseUrl, token, section)))
  ).flat();

  const merged = new Map<string, PlexTimedItem>();

  for (const entry of results) {
    const key = `${entry.item.kind}:${entry.item.title}:${entry.item.year ?? 'na'}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, entry);
      continue;
    }

    merged.set(key, {
      addedAt: Math.max(existing.addedAt, entry.addedAt),
      item: {
        ...existing.item,
        plexLibraries: Array.from(new Set([...existing.item.plexLibraries, ...entry.item.plexLibraries]))
      }
    });
  }

  return [...merged.values()]
    .sort((left, right) => right.addedAt - left.addedAt)
    .slice(0, limit)
    .map((entry) => entry.item);
}
