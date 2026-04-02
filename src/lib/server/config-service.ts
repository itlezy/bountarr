import { arrFetch, qualityProfileName } from '$lib/server/arr-client';
import { defaultsCache } from '$lib/server/app-cache';
import type { ArrService } from '$lib/server/acquisition-domain';
import { normalizeToken } from '$lib/server/media-identity';
import { getPlexConfig, plexFetch } from '$lib/server/plex-client';
import { asArray, asPositiveNumber, asRecord, asString } from '$lib/server/raw';
import { getConfiguredServiceFlags, getRuntimeHealth } from '$lib/server/runtime';
import type {
  ArrServiceStats,
  ConfigStatus,
  PlexServiceStats,
  QualityProfileOption,
} from '$lib/shared/types';

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
      throw new Error(`Quality profile "${preferredName}" was not found in ${service}`);
    }

    return asPositiveNumber(match.id);
  }

  return (
    normalizedProfiles
      .map((profile) => asPositiveNumber(profile.id))
      .find((id): id is number => id !== null) ?? null
  );
}

function toQualityProfileOptions(
  service: ArrService,
  profiles: unknown[],
  defaultId: number | null,
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
          (normalizedDefaultName !== null && normalizeToken(name) === normalizedDefaultName),
      } satisfies QualityProfileOption;
    })
    .filter((profile): profile is QualityProfileOption => profile !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function extractQueueCount(payload: unknown): number | null {
  const record = asRecord(payload);
  const totalRecords = asPositiveNumber(record.totalRecords);
  if (totalRecords !== null) {
    return totalRecords;
  }

  return asArray(record.records).length;
}

async function safeArrFetch(service: ArrService, path: string): Promise<unknown[]> {
  try {
    return await arrFetch<unknown[]>(service, path);
  } catch {
    return [];
  }
}

async function safeArrQueueCount(service: ArrService): Promise<number | null> {
  try {
    return extractQueueCount(
      await arrFetch<unknown>(service, '/api/v3/queue', undefined, {
        pageSize: 1,
        page: 1,
        sortKey: 'timeleft',
        sortDirection: 'ascending',
      }),
    );
  } catch {
    return null;
  }
}

function toArrServiceStats(
  profiles: QualityProfileOption[],
  defaultProfileId: number | null,
  rootFolders: unknown[],
  queueCount: number | null,
): ArrServiceStats {
  const defaultProfile =
    defaultProfileId === null
      ? null
      : (profiles.find((profile) => profile.id === defaultProfileId) ?? null);

  return {
    qualityProfileCount: profiles.length,
    rootFolderCount: rootFolders.length,
    queueCount,
    defaultQualityProfileName:
      defaultProfile?.name ?? profiles.find((profile) => profile.isDefault)?.name ?? null,
    primaryRootFolderPath: asString(asRecord(rootFolders[0]).path),
  };
}

async function fetchPlexStats(): Promise<PlexServiceStats> {
  const config = getPlexConfig();
  if (!config) {
    return {
      libraryCount: 0,
      movieLibraryCount: 0,
      showLibraryCount: 0,
      libraryTitles: [],
    };
  }

  try {
    const payload = asRecord(
      await plexFetch<unknown>(config.baseUrl, config.token, '/library/sections'),
    );
    const sections = asArray(asRecord(payload.MediaContainer).Directory).map(asRecord);
    const libraryTitles = sections
      .map((section) => asString(section.title))
      .filter((title): title is string => title !== null);

    return {
      libraryCount: sections.length,
      movieLibraryCount: sections.filter((section) => asString(section.type) === 'movie').length,
      showLibraryCount: sections.filter((section) => asString(section.type) === 'show').length,
      libraryTitles,
    };
  } catch {
    return {
      libraryCount: 0,
      movieLibraryCount: 0,
      showLibraryCount: 0,
      libraryTitles: [],
    };
  }
}

export async function getConfigStatus(): Promise<ConfigStatus> {
  const flags = getConfiguredServiceFlags();
  const runtime = getRuntimeHealth();
  const [
    radarrProfilesRaw,
    radarrRootFoldersRaw,
    radarrQueueCount,
    sonarrProfilesRaw,
    sonarrRootFoldersRaw,
    sonarrQueueCount,
    plexStats,
  ] = await Promise.all([
    flags.radarrConfigured ? safeArrFetch('radarr', '/api/v3/qualityprofile') : Promise.resolve([]),
    flags.radarrConfigured ? safeArrFetch('radarr', '/api/v3/rootfolder') : Promise.resolve([]),
    flags.radarrConfigured ? safeArrQueueCount('radarr') : Promise.resolve(null),
    flags.sonarrConfigured ? safeArrFetch('sonarr', '/api/v3/qualityprofile') : Promise.resolve([]),
    flags.sonarrConfigured ? safeArrFetch('sonarr', '/api/v3/rootfolder') : Promise.resolve([]),
    flags.sonarrConfigured ? safeArrQueueCount('sonarr') : Promise.resolve(null),
    flags.plexConfigured
      ? fetchPlexStats()
      : Promise.resolve({
          libraryCount: 0,
          movieLibraryCount: 0,
          showLibraryCount: 0,
          libraryTitles: [],
        }),
  ]);

  const defaultRadarrQualityProfileId =
    flags.radarrConfigured && radarrProfilesRaw.length > 0
      ? resolveQualityProfileId('radarr', radarrProfilesRaw)
      : null;
  const defaultSonarrQualityProfileId =
    flags.sonarrConfigured && sonarrProfilesRaw.length > 0
      ? resolveQualityProfileId('sonarr', sonarrProfilesRaw)
      : null;
  const radarrProfiles = toQualityProfileOptions(
    'radarr',
    radarrProfilesRaw,
    defaultRadarrQualityProfileId,
  );
  const sonarrProfiles = toQualityProfileOptions(
    'sonarr',
    sonarrProfilesRaw,
    defaultSonarrQualityProfileId,
  );

  return {
    ...flags,
    radarrQualityProfiles: radarrProfiles,
    sonarrQualityProfiles: sonarrProfiles,
    defaultRadarrQualityProfileId,
    defaultSonarrQualityProfileId,
    radarrStats: toArrServiceStats(
      radarrProfiles,
      defaultRadarrQualityProfileId,
      radarrRootFoldersRaw,
      radarrQueueCount,
    ),
    sonarrStats: toArrServiceStats(
      sonarrProfiles,
      defaultSonarrQualityProfileId,
      sonarrRootFoldersRaw,
      sonarrQueueCount,
    ),
    plexStats,
    runtime,
  };
}

export async function fetchServiceDefaults(service: ArrService): Promise<Record<string, unknown>> {
  const cacheKey = `${service}:defaults`;
  const now = Date.now();
  const cached = defaultsCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (service === 'radarr') {
    const [rootFolders, qualityProfiles] = await Promise.all([
      arrFetch<unknown[]>('radarr', '/api/v3/rootfolder'),
      arrFetch<unknown[]>('radarr', '/api/v3/qualityprofile'),
    ]);
    const resolvedQualityProfile = resolveQualityProfileId('radarr', qualityProfiles);

    const value = {
      rootFolderPath: asString(asRecord(rootFolders[0]).path),
      qualityProfileId: resolvedQualityProfile,
    };

    defaultsCache.set(cacheKey, { expiresAt: now + 10 * 60_000, value });
    return value;
  }

  const [rootFolders, qualityProfiles, languageProfiles] = await Promise.all([
    arrFetch<unknown[]>('sonarr', '/api/v3/rootfolder'),
    arrFetch<unknown[]>('sonarr', '/api/v3/qualityprofile'),
    arrFetch<unknown[]>('sonarr', '/api/v3/languageprofile'),
  ]);
  const resolvedQualityProfile = resolveQualityProfileId('sonarr', qualityProfiles);
  const defaultLanguageProfile = languageProfiles
    .map(asRecord)
    .map((profile) => asPositiveNumber(profile.id))
    .find((id): id is number => id !== null);

  const value = {
    rootFolderPath: asString(asRecord(rootFolders[0]).path),
    qualityProfileId: resolvedQualityProfile,
    languageProfileId: defaultLanguageProfile ?? null,
  };

  defaultsCache.set(cacheKey, { expiresAt: now + 10 * 60_000, value });
  return value;
}
