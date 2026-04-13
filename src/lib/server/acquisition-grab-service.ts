import { sanitizePreferences } from '$lib/shared/preferences';
import type { AcquisitionJob, GrabResponse, MediaItem, Preferences } from '$lib/shared/types';
import { createAreaLogger } from '$lib/server/logger';
import { acquisitionMaxRetries, arrFetch } from '$lib/server/arr-client';
import {
  AcquisitionGrabError,
  cloneJob,
  type ArrService,
  type GrabItemOptions,
} from '$lib/server/acquisition-domain';
import { fetchServiceDefaults } from '$lib/server/config-service';
import { getAcquisitionLifecycle } from '$lib/server/acquisition-lifecycle';
import { getAcquisitionRunner } from '$lib/server/acquisition-runner';
import { getAcquisitionJobRepository } from '$lib/server/acquisition-job-repository';
import { findPreferredReleaser } from '$lib/server/acquisition-query';
import { fetchExistingMovie, fetchExistingSeries } from '$lib/server/lookup-service';
import { normalizeItem } from '$lib/server/media-normalize';
import { asArray, asNumber, asPositiveNumber, asRecord, asString } from '$lib/server/raw';

const logger = createAreaLogger('acquisition');
// Collapse concurrent grabs for the same Arr item identity so a double-submit cannot create
// competing tracking jobs before Arr and the local DB settle.
const inFlightGrabs = new Map<string, Promise<GrabResponse>>();

type GrabSpec = {
  service: ArrService;
  trackedName: 'Radarr' | 'Sonarr';
  buildPayload: (
    item: MediaItem,
    defaults: Record<string, unknown>,
    options?: GrabItemOptions,
  ) => Record<string, unknown>;
  buildFallbackItem: (created: Record<string, unknown>, preferences: Preferences) => MediaItem;
  createPath: '/api/v3/movie' | '/api/v3/series';
  fetchExisting: (id: number, preferences: Preferences, item: MediaItem) => Promise<MediaItem>;
};

function ensureRootFolder(defaults: Record<string, unknown>, service: ArrService): void {
  if (!asString(defaults.rootFolderPath)) {
    throw new AcquisitionGrabError(503, `No root folder is configured in ${service}`);
  }

  if (!asPositiveNumber(defaults.qualityProfileId)) {
    throw new AcquisitionGrabError(503, `No quality profile is configured in ${service}`);
  }

  if (service === 'sonarr' && !asPositiveNumber(defaults.languageProfileId)) {
    throw new AcquisitionGrabError(503, 'No language profile is configured in sonarr');
  }
}

function ensureAddable(item: MediaItem): void {
  if (item.inArr) {
    throw new AcquisitionGrabError(409, `${item.title} is already tracked in Arr`);
  }

  if (!item.canAdd || !item.requestPayload || item.sourceService === 'plex') {
    throw new AcquisitionGrabError(400, `${item.title} cannot be added from this result`);
  }
}

function grabIdentity(item: MediaItem): string {
  const payload = asRecord(item.requestPayload);
  const identity =
    asNumber(payload.id) ??
    asNumber(payload.tmdbId) ??
    asNumber(payload.tvdbId) ??
    asString(payload.imdbId) ??
    item.id;

  return `${item.sourceService}:${item.kind}:${identity}`;
}

function buildMoviePayload(
  item: MediaItem,
  defaults: Record<string, unknown>,
  options?: GrabItemOptions,
): Record<string, unknown> {
  const raw = asRecord(item.requestPayload);

  return {
    ...raw,
    monitored: false,
    minimumAvailability: asString(raw.minimumAvailability) ?? 'released',
    rootFolderPath: asString(raw.rootFolderPath) ?? asString(defaults.rootFolderPath),
    qualityProfileId:
      options?.qualityProfileId ??
      asPositiveNumber(raw.qualityProfileId) ??
      asPositiveNumber(defaults.qualityProfileId),
    addOptions: {
      searchForMovie: false,
    },
  };
}

function buildSeriesPayload(
  item: MediaItem,
  defaults: Record<string, unknown>,
  options?: GrabItemOptions,
): Record<string, unknown> {
  const raw = asRecord(item.requestPayload);
  const normalizedSeasonNumbers =
    options?.seasonNumbers
      ?.filter((seasonNumber) => Number.isFinite(seasonNumber) && seasonNumber >= 0)
      .map((seasonNumber) => Math.trunc(seasonNumber)) ?? [];
  const selectedSeasonNumbers =
    normalizedSeasonNumbers.length > 0
      ? new Set(normalizedSeasonNumbers)
      : null;

  return {
    ...raw,
    monitored: false,
    seasonFolder: raw.seasonFolder ?? true,
    seasons: asArray(raw.seasons).map((season) => ({
      ...asRecord(season),
      monitored: selectedSeasonNumbers
        ? selectedSeasonNumbers.has(asNumber(asRecord(season).seasonNumber) ?? Number.NaN)
        : false,
    })),
    rootFolderPath: asString(raw.rootFolderPath) ?? asString(defaults.rootFolderPath),
    qualityProfileId:
      options?.qualityProfileId ??
      asPositiveNumber(raw.qualityProfileId) ??
      asPositiveNumber(defaults.qualityProfileId),
    languageProfileId:
      asPositiveNumber(raw.languageProfileId) ?? asPositiveNumber(defaults.languageProfileId),
    monitorNewItems: 'none',
    addOptions: {
      searchForCutoffUnmetEpisodes: false,
      searchForMissingEpisodes: false,
    },
  };
}

function movieGrabSpec(): GrabSpec {
  return {
    service: 'radarr',
    trackedName: 'Radarr',
    buildPayload: buildMoviePayload,
    buildFallbackItem: (created, preferences) =>
      normalizeItem('movie', created, preferences, {
        id: `movie:${crypto.randomUUID()}`,
        sourceService: 'radarr',
        inArr: true,
        canAdd: false,
      }),
    createPath: '/api/v3/movie',
    fetchExisting: (id, preferences) => fetchExistingMovie(id, preferences),
  };
}

function seriesGrabSpec(): GrabSpec {
  return {
    service: 'sonarr',
    trackedName: 'Sonarr',
    buildPayload: buildSeriesPayload,
    buildFallbackItem: (created, preferences) =>
      normalizeItem('series', created, preferences, {
        id: `series:${crypto.randomUUID()}`,
        sourceService: 'sonarr',
        inArr: true,
        canAdd: false,
      }),
    createPath: '/api/v3/series',
    fetchExisting: (id, preferences, item) =>
      fetchExistingSeries(id, preferences, null, item.detail),
  };
}

function existingResponse(
  item: MediaItem,
  trackedName: string,
  existingItem: MediaItem,
  activeJob: AcquisitionJob | null,
): GrabResponse {
  return {
    existing: true,
    item: existingItem,
    job: activeJob,
    message: `${item.title} is already tracked in ${trackedName}`,
    releaseDecision: null,
  };
}

function createOrReuseJob(
  item: MediaItem,
  arrItemId: number,
  sourceService: ArrService,
  preferences: Preferences,
): AcquisitionJob {
  const jobs = getAcquisitionJobRepository();
  const existing = jobs.findActiveJob(arrItemId, item.kind, sourceService);
  if (existing) {
    logger.info('Reusing existing acquisition job', {
      arrItemId,
      itemTitle: existing.title,
      jobId: existing.id,
      kind: existing.kind,
      service: existing.sourceService,
    });
    return cloneJob(existing);
  }

  const job = jobs.createJob({
    arrItemId,
    itemId: item.id,
    kind: item.kind,
    maxRetries: acquisitionMaxRetries(),
    preferredReleaser: findPreferredReleaser(item.kind, item.title),
    preferences: {
      preferredLanguage: preferences.preferredLanguage,
      subtitleLanguage: preferences.subtitleLanguage,
    },
    sourceService,
    title: item.title,
  });

  getAcquisitionLifecycle().recordJobCreated(job);
  getAcquisitionRunner().enqueue(job.id);
  return cloneJob(job);
}

async function grabTrackedItem(
  spec: GrabSpec,
  item: MediaItem,
  preferences: Preferences,
  options?: GrabItemOptions,
): Promise<GrabResponse> {
  logger.info(`Submitting ${item.kind} grab to ${spec.trackedName}`, {
    kind: item.kind,
    qualityProfileId: options?.qualityProfileId ?? null,
    title: item.title,
  });

  const sourceId = asNumber(asRecord(item.requestPayload).id);
  if (item.inArr && sourceId) {
    const activeJob = getAcquisitionJobRepository().findActiveJob(sourceId, item.kind, spec.service);
    return existingResponse(
      item,
      spec.trackedName,
      await spec.fetchExisting(sourceId, preferences, item),
      activeJob ? cloneJob(activeJob) : null,
    );
  }

  if (item.inArr) {
    return existingResponse(
      item,
      spec.trackedName,
      {
        ...item,
        canAdd: false,
        inArr: true,
        status: 'Already in Arr',
      },
      null,
    );
  }

  ensureAddable(item);
  const defaults = await fetchServiceDefaults(spec.service);
  ensureRootFolder(defaults, spec.service);

  const created = asRecord(
    await arrFetch<unknown>(spec.service, spec.createPath, {
      method: 'POST',
      body: JSON.stringify(spec.buildPayload(item, defaults, options)),
    }),
  );
  const createdId = asNumber(created.id);
  let createdItem: MediaItem = spec.buildFallbackItem(created, preferences);
  let job: AcquisitionJob | null = null;

  try {
    createdItem = createdId
      ? await spec.fetchExisting(createdId, preferences, item)
      : spec.buildFallbackItem(created, preferences);
    job = createdId
      ? createOrReuseJob(createdItem, createdId, spec.service, preferences)
      : null;
  } catch (trackingError) {
    if (!createdId) {
      throw trackingError;
    }

    logger.warn('Initial acquisition tracking failed after Arr create; attempting recovery', {
      arrItemId: createdId,
      itemTitle: item.title,
      service: spec.service,
    });

    try {
      createdItem =
        (await spec.fetchExisting(createdId, preferences, item).catch(() => null)) ??
        spec.buildFallbackItem(created, preferences);
      job = createOrReuseJob(createdItem, createdId, spec.service, preferences);
    } catch (recoveryError) {
      logger.error('Tracked item was created in Arr but acquisition tracking could not be recovered', {
        arrItemId: createdId,
        itemTitle: item.title,
        service: spec.service,
      });
      throw new AcquisitionGrabError(
        500,
        `${item.title} was added to ${spec.trackedName}, but acquisition tracking could not be started.`,
      );
    }
  }

  return {
    existing: false,
    item: createdItem,
    job,
    message: createdId
      ? `${item.title} was added to ${spec.trackedName}. Acquisition started.`
      : `${item.title} was added to ${spec.trackedName}`,
    releaseDecision: null,
  };
}

export async function grabItem(
  item: MediaItem,
  preferences?: Partial<Preferences>,
  options?: GrabItemOptions,
): Promise<GrabResponse> {
  const normalizedPreferences = sanitizePreferences(preferences);
  const spec = item.kind === 'movie' ? movieGrabSpec() : seriesGrabSpec();
  const lockKey = grabIdentity(item);
  const existingGrab = inFlightGrabs.get(lockKey);
  if (existingGrab) {
    return existingGrab;
  }

  const grabPromise = grabTrackedItem(spec, item, normalizedPreferences, options).finally(() => {
    if (inFlightGrabs.get(lockKey) === grabPromise) {
      inFlightGrabs.delete(lockKey);
    }
  });
  inFlightGrabs.set(lockKey, grabPromise);
  return grabPromise;
}
