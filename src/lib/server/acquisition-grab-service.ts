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
import {
  getAcquisitionJobRepository,
  type CreateAcquisitionJobInput,
} from '$lib/server/acquisition-job-repository';
import { findPreferredReleaser } from '$lib/server/acquisition-query';
import {
  fetchExistingMovie,
  fetchExistingSeries,
  fetchSeriesEpisodeRecords,
} from '$lib/server/lookup-service';
import { normalizeItem } from '$lib/server/media-normalize';
import { describeSeriesScope, normalizeNumberArray, scopeFromSeriesJob } from '$lib/server/series-scope';
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
  listPath: '/api/v3/movie' | '/api/v3/series';
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
  if (!item.canAdd || !item.requestPayload || item.sourceService === 'plex') {
    throw new AcquisitionGrabError(400, `${item.title} cannot be added from this result`);
  }
}

function trackedArrItemId(item: MediaItem): number | null {
  return item.arrItemId ?? asNumber(asRecord(item.requestPayload).id);
}

function normalizedIdentityValue(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function sameNumbers(left: number[] | null, right: number[] | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function preferencesIdentity(preferences: Preferences): string {
  return `${preferences.preferredLanguage}:${preferences.subtitleLanguage}`;
}

function grabIdentity(
  item: MediaItem,
  preferences: Preferences,
  options?: GrabItemOptions,
): string {
  const payload = asRecord(item.requestPayload);
  const identity =
    asNumber(payload.id) ??
    asNumber(payload.tmdbId) ??
    asNumber(payload.tvdbId) ??
    asString(payload.imdbId) ??
    item.id;
  const seasonScope =
    item.kind === 'series'
      ? normalizeNumberArray(options?.seasonNumbers)?.join(',') ?? 'missing-scope'
      : 'movie';
  const qualityProfileKey =
    typeof options?.qualityProfileId === 'number' && Number.isFinite(options.qualityProfileId)
      ? `${Math.trunc(options.qualityProfileId)}`
      : 'default-quality';

  return `${item.sourceService}:${item.kind}:${identity}:${preferencesIdentity(preferences)}:${qualityProfileKey}:${seasonScope}`;
}

function explicitSeriesTargetSeasonNumbers(
  item: MediaItem,
  options?: GrabItemOptions,
): number[] {
  const seasonNumbers = normalizeNumberArray(options?.seasonNumbers);
  if (seasonNumbers) {
    return seasonNumbers;
  }

  throw new AcquisitionGrabError(400, `Select at least one season before grabbing ${item.title}.`);
}

async function resolveSeriesTargetEpisodeIds(
  seriesId: number,
  targetSeasonNumbers: number[],
): Promise<number[] | null> {
  const targetSeasons = new Set(targetSeasonNumbers);
  const episodeIds = normalizeNumberArray(
    (await fetchSeriesEpisodeRecords(seriesId))
      .filter((episode) =>
        targetSeasons.has(asNumber(episode.seasonNumber) ?? Number.NaN),
      )
      .map((episode) => asNumber(episode.id))
      .filter((episodeId): episodeId is number => episodeId !== null && episodeId > 0),
  );

  return episodeIds;
}

async function buildRequestedJobInput(
  item: MediaItem,
  arrItemId: number,
  sourceService: ArrService,
  preferences: Preferences,
  options?: GrabItemOptions,
): Promise<CreateAcquisitionJobInput> {
  let targetSeasonNumbers: number[] | null = null;
  let targetEpisodeIds: number[] | null = null;
  if (item.kind === 'series') {
    targetSeasonNumbers = explicitSeriesTargetSeasonNumbers(item, options);
    targetEpisodeIds = await resolveSeriesTargetEpisodeIds(arrItemId, targetSeasonNumbers);
  }

  return {
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
    targetEpisodeIds,
    targetSeasonNumbers,
    title: item.title,
  };
}

function sameRequestedJob(
  job: Pick<
    AcquisitionJob,
    'kind' | 'preferences' | 'sourceService' | 'targetEpisodeIds' | 'targetSeasonNumbers'
  >,
  requested: CreateAcquisitionJobInput,
): boolean {
  const sameSeriesScope =
    job.kind !== 'series'
      ? true
      : requested.targetSeasonNumbers && job.targetSeasonNumbers
        ? sameNumbers(job.targetSeasonNumbers, requested.targetSeasonNumbers ?? null)
        : sameNumbers(job.targetEpisodeIds, requested.targetEpisodeIds ?? null);

  return (
    job.kind === requested.kind &&
    job.sourceService === requested.sourceService &&
    job.preferences.preferredLanguage === requested.preferences.preferredLanguage &&
    job.preferences.subtitleLanguage === requested.preferences.subtitleLanguage &&
    sameSeriesScope
  );
}

function activeGrabConflictMessage(
  item: Pick<MediaItem, 'kind' | 'title'>,
  activeJob: Pick<
    AcquisitionJob,
    'kind' | 'preferences' | 'targetEpisodeIds' | 'targetSeasonNumbers' | 'title'
  >,
  requested: CreateAcquisitionJobInput,
): string {
  const existingScope = describeSeriesScope(scopeFromSeriesJob(activeJob));
  const requestedScope =
    item.kind === 'series'
      ? describeSeriesScope({
          episodeIds: requested.targetEpisodeIds ?? null,
          seasonNumbers: requested.targetSeasonNumbers ?? null,
        })
      : null;
  const scopeDetail =
    item.kind === 'series'
      ? ` Existing scope: ${existingScope ?? 'unknown'}. Requested scope: ${requestedScope ?? 'unknown'}.`
      : '';

  return `${activeJob.title} already has an active alternate-release grab with different scope or language preferences.${scopeDetail} Cancel the current grab before starting a different one.`;
}

function assertReusableActiveJob(
  item: Pick<MediaItem, 'kind' | 'title'>,
  activeJob: Pick<
    AcquisitionJob,
    'kind' | 'preferences' | 'sourceService' | 'targetEpisodeIds' | 'targetSeasonNumbers' | 'title'
  >,
  requested: CreateAcquisitionJobInput,
): void {
  if (sameRequestedJob(activeJob, requested)) {
    return;
  }

  throw new AcquisitionGrabError(409, activeGrabConflictMessage(item, activeJob, requested));
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
  const selectedSeasonNumbers = new Set(explicitSeriesTargetSeasonNumbers(item, options));

  return {
    ...raw,
    monitored: false,
    seasonFolder: raw.seasonFolder ?? true,
    seasons: asArray(raw.seasons).map((season) => ({
      ...asRecord(season),
      monitored: selectedSeasonNumbers.has(asNumber(asRecord(season).seasonNumber) ?? Number.NaN),
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
    listPath: '/api/v3/movie',
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
    listPath: '/api/v3/series',
    fetchExisting: (id, preferences, item) =>
      fetchExistingSeries(id, preferences, null, item.detail),
  };
}

async function trackedResponse(
  spec: GrabSpec,
  item: MediaItem,
  existingItem: MediaItem,
  preferences: Preferences,
  options?: GrabItemOptions,
): Promise<GrabResponse> {
  const existingArrItemId =
    typeof existingItem.arrItemId === 'number' ? existingItem.arrItemId : null;
  if (existingArrItemId === null) {
    return {
      existing: true,
      item: existingItem,
      job: null,
      message: `${item.title} is already tracked in ${spec.trackedName}`,
      releaseDecision: null,
    };
  }

  const requestedJob = await buildRequestedJobInput(
    existingItem,
    existingArrItemId,
    spec.service,
    preferences,
    options,
  );
  const activeJob = getAcquisitionJobRepository().findActiveJob(
    existingArrItemId,
    item.kind,
    spec.service,
  );
  if (activeJob) {
    assertReusableActiveJob(item, activeJob, requestedJob);
    return {
      existing: true,
      item: existingItem,
      job: cloneJob(activeJob),
      message: `${item.title} is already tracked in ${spec.trackedName}. Reusing the active alternate-release grab.`,
      releaseDecision: null,
    };
  }

  const { created, job } = await createOrReuseJob(requestedJob);
  return {
    existing: true,
    item: existingItem,
    job,
    message: created
      ? `${item.title} is already tracked in ${spec.trackedName}. Alternate-release acquisition started.`
      : `${item.title} is already tracked in ${spec.trackedName}. Reusing the active alternate-release grab.`,
    releaseDecision: null,
  };
}

function findExistingRecordId(item: MediaItem, records: Record<string, unknown>[]): number | null {
  const payload = asRecord(item.requestPayload);
  const expectedTmdbId = asNumber(payload.tmdbId);
  const expectedTvdbId = asNumber(payload.tvdbId);
  const expectedImdbId = normalizedIdentityValue(asString(payload.imdbId));
  const expectedTitle = normalizedIdentityValue(item.title);
  const expectedYear = item.year;

  for (const record of records) {
    const recordId = asNumber(record.id);
    if (!recordId) {
      continue;
    }

    if (expectedTmdbId !== null && asNumber(record.tmdbId) === expectedTmdbId) {
      return recordId;
    }

    if (expectedTvdbId !== null && asNumber(record.tvdbId) === expectedTvdbId) {
      return recordId;
    }

    if (
      expectedImdbId !== null &&
      normalizedIdentityValue(asString(record.imdbId)) === expectedImdbId
    ) {
      return recordId;
    }

    if (
      expectedTitle !== null &&
      normalizedIdentityValue(asString(record.title)) === expectedTitle &&
      asNumber(record.year) === expectedYear
    ) {
      return recordId;
    }
  }

  return null;
}

async function findExistingTrackedItem(
  spec: GrabSpec,
  item: MediaItem,
  preferences: Preferences,
): Promise<MediaItem | null> {
  if (typeof item.arrItemId === 'number') {
    return spec.fetchExisting(item.arrItemId, preferences, item).catch(() => null);
  }

  const records = (await arrFetch<unknown[]>(spec.service, spec.listPath).catch(() => [])).map(
    asRecord,
  );
  const existingId = findExistingRecordId(item, records);
  if (!existingId) {
    return null;
  }

  return spec.fetchExisting(existingId, preferences, item).catch(() => null);
}

async function createOrReuseJob(
  requestedJob: CreateAcquisitionJobInput,
): Promise<{ created: boolean; job: AcquisitionJob }> {
  const jobs = getAcquisitionJobRepository();
  const result = jobs.createOrReuseActiveJob(requestedJob);

  if (!result.created) {
    assertReusableActiveJob(
      {
        kind: requestedJob.kind,
        title: requestedJob.title,
      },
      result.job,
      requestedJob,
    );
    logger.info('Reusing existing acquisition job', {
      arrItemId: requestedJob.arrItemId,
      itemTitle: result.job.title,
      jobId: result.job.id,
      kind: result.job.kind,
      service: result.job.sourceService,
    });
    return {
      created: false,
      job: cloneJob(result.job),
    };
  }

  getAcquisitionLifecycle().recordJobCreated(result.job);
  getAcquisitionRunner().enqueue(result.job.id);
  return {
    created: true,
    job: cloneJob(result.job),
  };
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

  const sourceId = trackedArrItemId(item);
  if (item.inArr && sourceId) {
    const existingItem = await spec.fetchExisting(sourceId, preferences, item);
    return trackedResponse(spec, item, existingItem, preferences, options);
  }

  ensureAddable(item);
  const defaults = await fetchServiceDefaults(spec.service);
  ensureRootFolder(defaults, spec.service);

  let created: Record<string, unknown>;
  try {
    created = asRecord(
      await arrFetch<unknown>(spec.service, spec.createPath, {
        method: 'POST',
        body: JSON.stringify(spec.buildPayload(item, defaults, options)),
      }),
    );
  } catch (createError) {
    const existingItem = await findExistingTrackedItem(spec, item, preferences);
    if (existingItem) {
      logger.warn(
        'Arr create reported an already-tracked item; converting to tracked grab response',
        {
          itemTitle: item.title,
          kind: item.kind,
          service: spec.service,
        },
      );
      return trackedResponse(spec, item, existingItem, preferences, options);
    }

    throw createError;
  }
  const createdId = asNumber(created.id);
  let createdItem: MediaItem = spec.buildFallbackItem(created, preferences);
  let job: AcquisitionJob | null = null;

  try {
    createdItem = createdId
      ? await spec.fetchExisting(createdId, preferences, item)
      : spec.buildFallbackItem(created, preferences);
    job = createdId
      ? (
          await createOrReuseJob(
            await buildRequestedJobInput(createdItem, createdId, spec.service, preferences, options),
          )
        ).job
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
      job = (
        await createOrReuseJob(
          await buildRequestedJobInput(createdItem, createdId, spec.service, preferences, options),
        )
      ).job;
    } catch (recoveryError) {
      logger.error(
        'Tracked item was created in Arr but acquisition tracking could not be recovered',
        {
          arrItemId: createdId,
          itemTitle: item.title,
          service: spec.service,
        },
      );
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
  const lockKey = grabIdentity(item, normalizedPreferences, options);
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
