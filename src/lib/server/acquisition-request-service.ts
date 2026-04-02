import { sanitizePreferences } from '$lib/shared/preferences';
import type { AcquisitionJob, MediaItem, Preferences, RequestResponse } from '$lib/shared/types';
import { createAreaLogger } from '$lib/server/logger';
import { acquisitionMaxRetries, arrFetch } from '$lib/server/arr-client';
import type { ArrService, RequestItemOptions } from '$lib/server/acquisition-domain';
import { cloneJob } from '$lib/server/acquisition-domain';
import { fetchServiceDefaults } from '$lib/server/config-service';
import { getAcquisitionLifecycle } from '$lib/server/acquisition-lifecycle';
import { getAcquisitionRunner } from '$lib/server/acquisition-runner';
import { getAcquisitionJobRepository } from '$lib/server/acquisition-job-repository';
import { findPreferredReleaser } from '$lib/server/acquisition-query';
import { fetchExistingMovie, fetchExistingSeries } from '$lib/server/lookup-service';
import { normalizeItem } from '$lib/server/media-normalize';
import { asArray, asNumber, asPositiveNumber, asRecord, asString } from '$lib/server/raw';

const logger = createAreaLogger('acquisition');

type RequestSpec = {
  service: ArrService;
  trackedName: 'Radarr' | 'Sonarr';
  buildPayload: (
    item: MediaItem,
    defaults: Record<string, unknown>,
    options?: RequestItemOptions,
  ) => Record<string, unknown>;
  buildFallbackItem: (created: Record<string, unknown>, preferences: Preferences) => MediaItem;
  createPath: '/api/v3/movie' | '/api/v3/series';
  fetchExisting: (id: number, preferences: Preferences, item: MediaItem) => Promise<MediaItem>;
};

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

function buildMoviePayload(
  item: MediaItem,
  defaults: Record<string, unknown>,
  options?: RequestItemOptions,
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
  options?: RequestItemOptions,
): Record<string, unknown> {
  const raw = asRecord(item.requestPayload);

  return {
    ...raw,
    monitored: false,
    seasonFolder: raw.seasonFolder ?? true,
    seasons: asArray(raw.seasons).map((season) => ({
      ...asRecord(season),
      monitored: false,
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

function movieRequestSpec(): RequestSpec {
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

function seriesRequestSpec(): RequestSpec {
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
): RequestResponse {
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
  const existing = jobs.findActiveJob(arrItemId, item.kind);
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

async function requestTrackedItem(
  spec: RequestSpec,
  item: MediaItem,
  preferences: Preferences,
  options?: RequestItemOptions,
): Promise<RequestResponse> {
  logger.info(`Submitting ${item.kind} request to ${spec.trackedName}`, {
    kind: item.kind,
    qualityProfileId: options?.qualityProfileId ?? null,
    title: item.title,
  });

  const sourceId = asNumber(asRecord(item.requestPayload).id);
  if (item.inArr && sourceId) {
    const activeJob = getAcquisitionJobRepository().findActiveJob(sourceId, item.kind);
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
  const createdItem = createdId
    ? await spec.fetchExisting(createdId, preferences, item)
    : spec.buildFallbackItem(created, preferences);
  const job = createdId
    ? createOrReuseJob(createdItem, createdId, spec.service, preferences)
    : null;

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

export async function requestItem(
  item: MediaItem,
  preferences?: Partial<Preferences>,
  options?: RequestItemOptions,
): Promise<RequestResponse> {
  const normalizedPreferences = sanitizePreferences(preferences);
  const spec = item.kind === 'movie' ? movieRequestSpec() : seriesRequestSpec();

  return requestTrackedItem(spec, item, normalizedPreferences, options);
}
