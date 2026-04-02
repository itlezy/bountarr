import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';
import { PlexHttpError, getPlexConfig, plexFetch } from '$lib/server/plex-client';
import { extractDisplayRating } from '$lib/server/media-normalize';
import {
  extractPlexPoster,
  hasStablePlexExternalIds,
  mergePlexResults,
  normalizePlexRecentSectionResult,
  normalizePlexSectionKind,
  normalizePlexSectionResult,
} from '$lib/server/plex-normalize';
import { asArray, asRecord, asString, asNumber } from '$lib/server/raw';
import type { MediaItem, SearchKind } from '$lib/shared/types';
import type { PlexSection, PlexTimedItem } from '$lib/server/plex-normalize';

const logger = createAreaLogger('plex');
const unsupportedSearchSections = new Set<string>();

function isUnsupportedSectionSearch(error: unknown): error is PlexHttpError {
  return error instanceof PlexHttpError && error.status === 400;
}

async function hydrateMetadataIfNeeded(
  baseUrl: string,
  token: string,
  raw: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ratingKey = asString(raw.ratingKey);
  if (!ratingKey || hasStablePlexExternalIds(raw)) {
    return raw;
  }

  try {
    const payload = asRecord(
      await plexFetch<unknown>(baseUrl, token, `/library/metadata/${ratingKey}`, {
        includeGuids: '1',
      }),
    );
    const metadata = asRecord(asArray(asRecord(payload.MediaContainer).Metadata)[0]);
    if (Object.keys(metadata).length === 0) {
      return raw;
    }

    return {
      ...metadata,
      ...raw,
      Guid: metadata.Guid ?? raw.Guid,
      guids: metadata.guids ?? raw.guids,
    };
  } catch {
    return raw;
  }
}

async function fetchSections(
  baseUrl: string,
  token: string,
  searchKind: SearchKind,
): Promise<PlexSection[]> {
  const payload = asRecord(await plexFetch<unknown>(baseUrl, token, '/library/sections'));
  const sections = asArray(asRecord(payload.MediaContainer).Directory).map(asRecord);

  return sections
    .map((section) => {
      const kind = normalizePlexSectionKind(asString(section.type));
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
        kind,
      } satisfies PlexSection;
    })
    .filter((section): section is PlexSection => section !== null);
}

async function searchSection(
  baseUrl: string,
  token: string,
  section: PlexSection,
  term: string,
): Promise<MediaItem[]> {
  if (unsupportedSearchSections.has(section.key)) {
    return [];
  }

  try {
    const payload = asRecord(
      await plexFetch<unknown>(baseUrl, token, `/library/sections/${section.key}/search`, {
        query: term,
        includeGuids: '1',
      }),
    );

    return await Promise.all(
      asArray(asRecord(payload.MediaContainer).Metadata)
        .map(asRecord)
        .filter((entry) => asString(entry.title) !== null)
        .map(async (entry) =>
          normalizePlexSectionResult(
            await hydrateMetadataIfNeeded(baseUrl, token, entry),
            section,
            baseUrl,
            token,
          ),
        ),
    );
  } catch (error) {
    if (isUnsupportedSectionSearch(error)) {
      unsupportedSearchSections.add(section.key);
      logger.info('Plex section search unsupported; disabling section search', {
        section: section.title,
        sectionKey: section.key,
        path: error.path,
        status: error.status,
        statusText: error.statusText,
      });
      return [];
    }

    logger.warn('Plex section search failed', {
      section: section.title,
      term,
      ...toErrorLogContext(error),
    });
    return [];
  }
}

async function searchGlobalHubs(
  baseUrl: string,
  token: string,
  searchKind: SearchKind,
  term: string,
): Promise<MediaItem[]> {
  try {
    const payload = asRecord(
      await plexFetch<unknown>(baseUrl, token, '/hubs/search', {
        query: term,
        includeGuids: '1',
      }),
    );

    const hubs = asArray(asRecord(payload.MediaContainer).Hub).map(asRecord);
    const items: MediaItem[] = [];

    for (const hub of hubs) {
      const type = normalizePlexSectionKind(asString(hub.type));
      if (!type) {
        continue;
      }

      if (searchKind !== 'all' && searchKind !== type) {
        continue;
      }

      for (const rawEntry of asArray(hub.Metadata).map(asRecord)) {
        const entry = await hydrateMetadataIfNeeded(baseUrl, token, rawEntry);
        const libraryTitle =
          asString(entry.librarySectionTitle) ?? asString(entry.reasonTitle) ?? 'Plex';

        items.push({
          id: `plex:${type}:${asString(entry.ratingKey) ?? crypto.randomUUID()}`,
          kind: type,
          title: asString(entry.title) ?? 'Untitled',
          year: asNumber(entry.year),
          rating: extractDisplayRating(entry),
          poster: extractPlexPoster(entry, baseUrl, token),
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
          requestPayload: entry,
        });
      }
    }

    return items;
  } catch (error) {
    logger.warn('Plex global hub search failed', {
      term,
      kind: searchKind,
      ...toErrorLogContext(error),
    });
    return [];
  }
}

async function fetchRecentSectionItems(
  baseUrl: string,
  token: string,
  section: PlexSection,
): Promise<PlexTimedItem[]> {
  try {
    const payload = asRecord(
      await plexFetch<unknown>(baseUrl, token, `/library/sections/${section.key}/recentlyAdded`),
    );

    return asArray(asRecord(payload.MediaContainer).Metadata)
      .map(asRecord)
      .filter((entry) => asString(entry.title) !== null)
      .map((entry) => ({
        addedAt: asNumber(entry.addedAt) ?? 0,
        item: normalizePlexRecentSectionResult(entry, section, baseUrl, token),
      }));
  } catch (error) {
    logger.warn('Plex recent-items fetch failed', {
      section: section.title,
      ...toErrorLogContext(error),
    });
    return [];
  }
}

export async function searchPlex(term: string, searchKind: SearchKind): Promise<MediaItem[]> {
  const config = getPlexConfig();
  if (!config) {
    return [];
  }

  try {
    const sections = await fetchSections(config.baseUrl, config.token, searchKind);
    const [hubItems, sectionItems] = await Promise.all([
      searchGlobalHubs(config.baseUrl, config.token, searchKind, term),
      Promise.all(
        sections.map((section) => searchSection(config.baseUrl, config.token, section, term)),
      ).then((results) => results.flat()),
    ]);

    return mergePlexResults([...hubItems, ...sectionItems]);
  } catch (error) {
    logger.warn('Plex search failed', {
      term,
      kind: searchKind,
      ...toErrorLogContext(error),
    });
    return [];
  }
}

export async function getRecentPlexItems(limit = 12): Promise<MediaItem[]> {
  const config = getPlexConfig();
  if (!config) {
    return [];
  }

  const sections = await fetchSections(config.baseUrl, config.token, 'all');
  const results = (
    await Promise.all(
      sections.map((section) => fetchRecentSectionItems(config.baseUrl, config.token, section)),
    )
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
        plexLibraries: Array.from(
          new Set([...existing.item.plexLibraries, ...entry.item.plexLibraries]),
        ),
      },
    });
  }

  return [...merged.values()]
    .sort((left, right) => right.addedAt - left.addedAt)
    .slice(0, limit)
    .map((entry) => entry.item);
}
