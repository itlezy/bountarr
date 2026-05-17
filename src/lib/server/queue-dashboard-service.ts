import { arrFetch } from '$lib/server/arr-client';
import { fetchQueueRecords } from '$lib/server/acquisition-validator-shared';
import { dashboardCache, queueCache } from '$lib/server/app-cache';
import {
  isTerminalJobStatus,
  type ArrService,
  type PersistedAcquisitionJob,
} from '$lib/server/acquisition-domain';
import { getAcquisitionJobRepository } from '$lib/server/acquisition-job-repository';
import { findReleaseSelection } from '$lib/server/acquisition-selection';
import { ensureAcquisitionWorkers, getQueueAcquisitionJobs } from '$lib/server/acquisition-service';
import { itemMatchKeys, itemSearchTitles } from '$lib/server/media-identity';
import { fetchExistingMovie, fetchExistingSeries } from '$lib/server/lookup-service';
import { mergeItems, normalizeItem } from '$lib/server/media-normalize';
import { getRecentPlexItems, searchPlex } from '$lib/server/plex-service';
import { buildManagedLiveSummary } from '$lib/server/queue-live-summary';
import { externalQueueEntryCapabilities } from '$lib/server/queue-entry-capabilities';
import { createAreaLogger, toErrorLogContext } from '$lib/server/logger';
import {
  bestQueueIdentityCandidate,
  queueItemMatchesManagedIdentity,
  queueItemMatchesManagedTarget,
} from '$lib/server/queue-matching';
import { normalizeQueueItem } from '$lib/server/queue-normalize';
import { asArray, asNumber, asRecord, asRecordsArray, asString } from '$lib/server/raw';
import { getConfiguredServiceFlags } from '$lib/server/runtime';
import { sanitizePreferences } from '$lib/shared/preferences';
import { managedQueueEntryCapabilities } from '$lib/shared/queue-entry-capabilities';
import type {
  AcquisitionJob,
  AuditStatus,
  DashboardResponse,
  ExternalQueueEntry,
  MediaItem,
  ManagedQueueEntry,
  QueueEntry,
  Preferences,
  QueueItem,
  QueueResponse,
} from '$lib/shared/types';

const logger = createAreaLogger('queue-dashboard');
const dailyMissingMovieSearchIntervalMs = 24 * 60 * 60 * 1000;
const adjacentYearFallbackReason =
  'Bountarr accepted adjacent release year because no exact-year match was available';
type DashboardOptions = {
  force?: boolean;
  includeAllBountarr?: boolean;
};

function queueItemEntryId(item: QueueItem): string {
  return item.id;
}

function summarizeDashboard(items: MediaItem[]) {
  return {
    total: items.length,
    verified: items.filter((item) => item.auditStatus === 'verified').length,
    pending: items.filter(
      (item) =>
        item.auditStatus === 'pending' ||
        item.auditStatus === 'unknown' ||
        item.auditStatus === 'not-released',
    ).length,
    attention: items.filter(
      (item) =>
        item.auditStatus === 'missing-language' ||
        item.auditStatus === 'no-subs' ||
        item.auditStatus === 'not-found' ||
        item.auditStatus === 'release-blocked',
    ).length,
  };
}

function acquisitionTimeMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function newestAcquiredAt(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  const leftTime = acquisitionTimeMs(left);
  const rightTime = acquisitionTimeMs(right);
  if (leftTime === 0 && rightTime === 0) {
    return left ?? right ?? null;
  }

  return leftTime >= rightTime ? (left ?? null) : (right ?? null);
}

function arrHistoryAcquiredAt(record: Record<string, unknown>): string | null {
  return asString(record.date) ?? asString(record.eventDate) ?? asString(record.added) ?? null;
}

const acquisitionDashboardWindowMs = 7 * 24 * 60 * 60 * 1000;

function acquisitionJobAcquiredAt(job: AcquisitionJob): string | null {
  return job.completedAt ?? job.updatedAt ?? job.startedAt ?? null;
}

function acquisitionJobLastSearchMs(job: AcquisitionJob): number {
  const timestamps = [
    job.startedAt,
    job.updatedAt,
    job.completedAt,
    ...job.attempts.flatMap((attempt) => [attempt.startedAt, attempt.finishedAt]),
  ];

  return Math.max(0, ...timestamps.map(acquisitionTimeMs));
}

function acquisitionAuditStatus(job: AcquisitionJob): AuditStatus {
  const manualReviewCandidates = acquisitionManualReviewCandidates(job);

  switch (job.reasonCode) {
    case 'validated':
      return 'verified';
    case 'missing-audio':
      return 'missing-language';
    case 'missing-subs':
      return 'no-subs';
    case 'crashed':
    case 'download-failed':
    case 'import-blocked':
    case 'import-timeout':
    case 'manual-selection-lost':
      return 'unknown';
    case 'no-acceptable-release':
      return manualReviewCandidates.length > 0 ? 'release-blocked' : 'not-found';
    case 'no-release-available':
      if (manualReviewCandidates.length > 0) {
        return 'release-blocked';
      }
      return 'not-found';
    default:
      return 'pending';
  }
}

function acquisitionManualReviewCandidates(
  job: AcquisitionJob,
): NonNullable<AcquisitionJob['releaseCandidates']> {
  return (job.releaseCandidates ?? []).filter((candidate) => {
    if (candidate.status === 'failed') {
      return false;
    }

    const record = candidate as unknown as Record<string, unknown>;
    return (
      record.identityStatus !== 'mismatch' &&
      record.scopeStatus !== 'mismatch' &&
      record.scopeStatus !== 'partial' &&
      record.scopeStatus !== 'unknown'
    );
  });
}

function acquisitionJobDetail(job: AcquisitionJob): string | null {
  const releaseCandidates = acquisitionManualReviewCandidates(job);
  if (
    releaseCandidates.length > 0 &&
    (job.reasonCode === 'no-release-available' || job.reasonCode === 'no-acceptable-release')
  ) {
    return `${releaseCandidates.length} release option${
      releaseCandidates.length === 1 ? '' : 's'
    } need manual review.`;
  }

  return job.currentRelease ?? job.validationSummary ?? job.failureReason;
}

function radarrMovieStatus(item: MediaItem): string | null {
  return asString(asRecord(item.requestPayload).status)?.toLowerCase() ?? null;
}

function acquisitionItemAuditStatus(job: AcquisitionJob, item: MediaItem): AuditStatus {
  const auditStatus = acquisitionAuditStatus(job);
  const movieStatus = radarrMovieStatus(item);
  if (
    auditStatus === 'not-found' &&
    job.kind === 'movie' &&
    job.sourceService === 'radarr' &&
    movieStatus !== null &&
    movieStatus !== 'released'
  ) {
    return 'not-released';
  }

  return auditStatus;
}

function commandName(value: Record<string, unknown>): string {
  return (asString(value.name) ?? asString(value.commandName) ?? '').trim().toLowerCase();
}

function commandTimestampMs(value: Record<string, unknown>): number {
  return Math.max(
    acquisitionTimeMs(asString(value.startedAt)),
    acquisitionTimeMs(asString(value.startedOn)),
    acquisitionTimeMs(asString(value.queuedAt)),
    acquisitionTimeMs(asString(value.triggeredAt)),
    acquisitionTimeMs(asString(value.endedAt)),
    acquisitionTimeMs(asString(value.endedOn)),
    acquisitionTimeMs(asString(value.completedAt)),
    acquisitionTimeMs(asString(value.updatedAt)),
  );
}

function commandBody(value: Record<string, unknown>): Record<string, unknown> {
  const body = value.body;
  if (typeof body === 'string') {
    try {
      return asRecord(JSON.parse(body) as unknown);
    } catch {
      return {};
    }
  }

  return asRecord(body);
}

function commandMovieIds(command: Record<string, unknown>): number[] {
  const body = commandBody(command);
  const ids = [
    ...asArray(body.movieIds),
    body.movieId,
    ...asArray(command.movieIds),
    command.movieId,
  ];

  return [
    ...new Set(
      ids
        .map((value) => {
          if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.trunc(value);
          }

          if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
            return Number(value.trim());
          }

          return null;
        })
        .filter((value): value is number => value !== null && value > 0),
    ),
  ];
}

function commandIsMovieSearch(command: Record<string, unknown>): boolean {
  const name = commandName(command);
  return name === 'moviessearch' || name === 'moviesearch' || name === 'movies search';
}

async function radarrMovieWasSearchedRecently(movieId: number, sinceMs: number): Promise<boolean> {
  try {
    const commands = asRecordsArray(await arrFetch<unknown>('radarr', '/api/v3/command'));

    return commands.map(asRecord).some((command) => {
      if (!commandIsMovieSearch(command)) {
        return false;
      }

      const searchedAtMs = commandTimestampMs(command);
      return searchedAtMs >= sinceMs && commandMovieIds(command).includes(movieId);
    });
  } catch (error) {
    logger.warn('Unable to inspect recent Radarr search commands', {
      movieId,
      ...toErrorLogContext(error),
    });
    return false;
  }
}

async function radarrMovieIsReleased(movieId: number): Promise<boolean> {
  try {
    const movie = asRecord(await arrFetch<unknown>('radarr', `/api/v3/movie/${movieId}`));
    return asString(movie.status)?.toLowerCase() === 'released';
  } catch (error) {
    logger.warn('Unable to inspect Radarr movie release status for daily missing search', {
      movieId,
      ...toErrorLogContext(error),
    });
    return false;
  }
}

function activeAcquisitionJobExists(job: AcquisitionJob, jobs: AcquisitionJob[]): boolean {
  return jobs.some(
    (candidate) =>
      candidate.id !== job.id &&
      candidate.kind === job.kind &&
      candidate.sourceService === job.sourceService &&
      candidate.arrItemId === job.arrItemId &&
      !isTerminalJobStatus(candidate.status),
  );
}

function jobNeedsDailyMissingMovieSearch(
  job: AcquisitionJob,
  jobs: AcquisitionJob[],
  sinceMs: number,
): boolean {
  return (
    job.kind === 'movie' &&
    job.sourceService === 'radarr' &&
    job.status === 'failed' &&
    acquisitionAuditStatus(job) === 'not-found' &&
    acquisitionJobLastSearchMs(job) < sinceMs &&
    !activeAcquisitionJobExists(job, jobs)
  );
}

function jobNeedsAutomaticReleaseRetry(job: AcquisitionJob, jobs: AcquisitionJob[]): boolean {
  return (
    job.kind === 'movie' &&
    job.sourceService === 'radarr' &&
    job.status === 'failed' &&
    acquisitionAuditStatus(job) === 'release-blocked' &&
    !activeAcquisitionJobExists(job, jobs)
  );
}

async function enqueueDailyMissingMovieSearch(job: AcquisitionJob): Promise<void> {
  const jobs = getAcquisitionJobRepository();
  const result = jobs.updateJobIfStatus(job.id, ['failed'], {
    attempt: job.attempt + 1,
    autoRetrying: false,
    completedAt: null,
    currentRelease: null,
    failureReason: null,
    liveDownloadId: null,
    liveQueueId: null,
    progress: null,
    queuedManualSelection: null,
    queueStatus: 'Queued daily release search',
    reasonCode: null,
    selectedReleaser: null,
    status: 'queued',
    validationSummary: null,
  });

  if (!result.updated || !result.job) {
    return;
  }

  const { getAcquisitionRunner } = await import('$lib/server/acquisition-runner');
  getAcquisitionRunner().enqueue(result.job.id);

  logger.info('Queued daily missing movie search', {
    arrItemId: job.arrItemId,
    jobId: job.id,
    title: job.title,
  });
}

async function enqueueAutomaticReleaseRetry(job: AcquisitionJob): Promise<void> {
  let selection: Awaited<ReturnType<typeof findReleaseSelection>>;
  try {
    selection = await findReleaseSelection(job as PersistedAcquisitionJob);
  } catch (error) {
    logger.warn('Unable to inspect release-blocked job for automatic retry', {
      arrItemId: job.arrItemId,
      jobId: job.id,
      title: job.title,
      ...toErrorLogContext(error),
    });
    return;
  }

  if (!selection.selectedGuid || !selection.selectedRelease || !selection.selection.payload) {
    return;
  }

  if (!selection.selectedRelease.reason.includes(adjacentYearFallbackReason)) {
    return;
  }

  const jobs = getAcquisitionJobRepository();
  const current = jobs.getJob(job.id) ?? job;
  let result: ReturnType<typeof jobs.updateJobIfStatus>;
  try {
    result = jobs.updateJobIfStatus(job.id, ['failed'], {
      attempt: current.attempt + 1,
      autoRetrying: false,
      completedAt: null,
      currentRelease: null,
      failureReason: null,
      liveDownloadId: null,
      liveQueueId: null,
      progress: null,
      queuedManualSelection: null,
      queueStatus: 'Queued automatic release retry',
      reasonCode: null,
      selectedReleaser: null,
      status: 'queued',
      validationSummary: null,
    });
  } catch (error) {
    logger.warn('Unable to queue automatic release retry', {
      arrItemId: job.arrItemId,
      jobId: job.id,
      title: job.title,
      ...toErrorLogContext(error),
    });
    return;
  }

  if (!result.updated || !result.job) {
    return;
  }

  const { getAcquisitionRunner } = await import('$lib/server/acquisition-runner');
  getAcquisitionRunner().enqueue(result.job.id);

  logger.info('Queued automatic release retry', {
    arrItemId: job.arrItemId,
    jobId: job.id,
    selectedTitle: selection.selectedRelease.title,
    title: job.title,
  });
}

async function triggerAutomaticReleaseRetries(): Promise<void> {
  if (!getConfiguredServiceFlags().radarrConfigured) {
    return;
  }

  const jobs = getAcquisitionJobRepository().listJobs();
  for (const job of jobs) {
    if (jobNeedsAutomaticReleaseRetry(job, jobs)) {
      await enqueueAutomaticReleaseRetry(job);
    }
  }
}

async function triggerDailyMissingMovieSearches(nowMs = Date.now()): Promise<void> {
  if (!getConfiguredServiceFlags().radarrConfigured) {
    return;
  }

  const sinceMs = nowMs - dailyMissingMovieSearchIntervalMs;
  const jobs = getAcquisitionJobRepository().listJobs();
  for (const job of jobs) {
    if (!jobNeedsDailyMissingMovieSearch(job, jobs, sinceMs)) {
      continue;
    }

    if (!(await radarrMovieIsReleased(job.arrItemId))) {
      logger.info('Skipped daily missing movie search for unreleased Radarr movie', {
        arrItemId: job.arrItemId,
        jobId: job.id,
        title: job.title,
      });
      continue;
    }

    if (await radarrMovieWasSearchedRecently(job.arrItemId, sinceMs)) {
      logger.info('Skipped daily missing movie search after recent Radarr search command', {
        arrItemId: job.arrItemId,
        jobId: job.id,
        title: job.title,
      });
      continue;
    }

    await enqueueDailyMissingMovieSearch(job);
  }
}

function recentAcquisitionCheckJobs(options: { includeAll?: boolean } = {}): AcquisitionJob[] {
  const nowMs = Date.now();
  const cutoffMs = nowMs - acquisitionDashboardWindowMs;
  const jobsByItem = new Map<string, AcquisitionJob>();

  for (const job of getAcquisitionJobRepository().listJobs()) {
    if (job.status === 'cancelled') {
      continue;
    }

    const acquiredAt = acquisitionJobAcquiredAt(job);
    const acquiredAtMs = acquisitionTimeMs(acquiredAt);
    if (acquiredAtMs === 0 || (!options.includeAll && acquiredAtMs < cutoffMs)) {
      continue;
    }

    const key = `${job.sourceService}:${job.kind}:${job.arrItemId}`;
    const existing = jobsByItem.get(key);
    if (!existing || acquiredAtMs > acquisitionTimeMs(acquisitionJobAcquiredAt(existing))) {
      jobsByItem.set(key, job);
    }
  }

  return [...jobsByItem.values()].sort(
    (left, right) =>
      acquisitionTimeMs(acquisitionJobAcquiredAt(right)) -
      acquisitionTimeMs(acquisitionJobAcquiredAt(left)),
  );
}

async function buildAcquisitionHistoryItems(
  preferences: Preferences,
  options: { includeAll?: boolean } = {},
): Promise<MediaItem[]> {
  const items: MediaItem[] = [];

  for (const job of recentAcquisitionCheckJobs(options)) {
    const acquiredAt = acquisitionJobAcquiredAt(job);
    const detail = acquisitionJobDetail(job);

    try {
      const item =
        job.kind === 'movie'
          ? await fetchExistingMovie(job.arrItemId, preferences)
          : await fetchExistingSeries(job.arrItemId, preferences, null, detail ?? job.title);
      const auditStatus = acquisitionItemAuditStatus(job, item);
      items.push({
        ...item,
        acquiredAt: acquiredAt ?? item.acquiredAt ?? null,
        auditStatus,
        detail: item.detail ?? detail ?? null,
        id: options.includeAll ? `acquisition:${job.id}` : item.id,
        requestPayload: {
          ...asRecord(item.requestPayload),
          acquisitionJob: job,
          acquisitionJobId: job.id,
          acquisitionJobStatus: job.status,
          acquisitionRelease: job.currentRelease,
        },
      });
    } catch {
      const auditStatus = acquisitionAuditStatus(job);
      items.push(
        normalizeItem(job.kind, {}, preferences, {
          acquiredAt,
          arrItemId: job.arrItemId,
          auditStatus,
          canAdd: false,
          detail,
          id: `acquisition:${job.id}`,
          inArr: true,
          isExisting: true,
          isRequested: true,
          requestPayload: {
            acquisitionJob: job,
            acquisitionJobId: job.id,
            acquisitionJobStatus: job.status,
            acquisitionRelease: job.currentRelease,
            currentRelease: job.currentRelease,
            reasonCode: job.reasonCode,
            status: job.status,
          },
          sourceService: job.sourceService,
          status: job.status === 'completed' ? 'Downloaded' : job.status,
          title: job.title,
        }),
      );
    }
  }

  return items;
}

async function buildMovieHistoryItems(preferences: Preferences): Promise<MediaItem[]> {
  if (!getConfiguredServiceFlags().radarrConfigured) {
    return [];
  }

  const [history, queue] = await Promise.all([
    arrFetch<unknown>('radarr', '/api/v3/history', undefined, {
      pageSize: 8,
      page: 1,
      sortKey: 'date',
      sortDirection: 'descending',
    })
      .then(asRecordsArray)
      .catch(() => []),
    arrFetch<unknown>('radarr', '/api/v3/queue', undefined, {
      pageSize: 5,
      page: 1,
      sortKey: 'timeleft',
      sortDirection: 'ascending',
    })
      .then(asRecordsArray)
      .catch(() => []),
  ]);

  const items: MediaItem[] = [];

  for (const entry of queue) {
    const record = asRecord(entry);
    const queueItem = normalizeQueueItem('radarr', record);
    if (!queueItem) {
      continue;
    }
    const movie = asRecord(record.movie);
    const movieId = queueItem.arrItemId;
    items.push(
      normalizeItem('movie', movie, preferences, {
        arrItemId: movieId ?? null,
        id: `movie:queue:${queueItem.id}`,
        title: queueItem.title,
        year: queueItem.year,
        poster: queueItem.poster,
        status: queueItem.status,
        isExisting: true,
        isRequested: true,
        auditStatus: 'pending',
        acquiredAt: queueItem.addedAt,
        detail: queueItem.detail,
        inArr: true,
        canAdd: false,
        requestPayload: Object.keys(movie).length > 0 ? movie : record,
      }),
    );
  }

  for (const entry of history) {
    const record = asRecord(entry);
    const movieId = asNumber(record.movieId);
    if (!movieId) {
      continue;
    }

    try {
      const acquiredAt = arrHistoryAcquiredAt(record);
      const item = await fetchExistingMovie(movieId, preferences);
      items.push({ ...item, acquiredAt: acquiredAt ?? item.acquiredAt ?? null });
    } catch {
      const movie = asRecord(record.movie);
      items.push(
        normalizeItem('movie', movie, preferences, {
          acquiredAt: arrHistoryAcquiredAt(record),
          arrItemId: movieId,
          id: `movie:history:${movieId}`,
          detail: asString(record.sourceTitle),
          isExisting: true,
          isRequested: true,
          inArr: true,
          canAdd: false,
        }),
      );
    }
  }

  return items;
}

async function buildSeriesHistoryItems(preferences: Preferences): Promise<MediaItem[]> {
  if (!getConfiguredServiceFlags().sonarrConfigured) {
    return [];
  }

  const [history, queue] = await Promise.all([
    arrFetch<unknown>('sonarr', '/api/v3/history', undefined, {
      pageSize: 8,
      page: 1,
      sortKey: 'date',
      sortDirection: 'descending',
    })
      .then(asRecordsArray)
      .catch(() => []),
    arrFetch<unknown>('sonarr', '/api/v3/queue', undefined, {
      pageSize: 5,
      page: 1,
      sortKey: 'timeleft',
      sortDirection: 'ascending',
    })
      .then(asRecordsArray)
      .catch(() => []),
  ]);

  const items: MediaItem[] = [];

  for (const entry of queue) {
    const record = asRecord(entry);
    const queueItem = normalizeQueueItem('sonarr', record);
    if (!queueItem) {
      continue;
    }
    const series = asRecord(record.series);
    const episode = asRecord(record.episode);
    const seriesId = queueItem.arrItemId;
    items.push(
      normalizeItem('series', series, preferences, {
        arrItemId: seriesId ?? null,
        id: `series:queue:${queueItem.id}`,
        title: queueItem.title,
        year: queueItem.year,
        poster: queueItem.poster,
        status: queueItem.status,
        isExisting: true,
        isRequested: true,
        auditStatus: 'pending',
        acquiredAt: queueItem.addedAt,
        detail: queueItem.detail ?? asString(episode.title),
        inArr: true,
        canAdd: false,
        requestPayload: Object.keys(series).length > 0 ? series : record,
      }),
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
      const acquiredAt = arrHistoryAcquiredAt(record);
      const item = await fetchExistingSeries(
        seriesId,
        preferences,
        episodeFileId,
        asString(record.sourceTitle) ?? asString(asRecord(record.episode).title),
      );
      items.push({
        ...item,
        acquiredAt: acquiredAt ?? item.acquiredAt ?? null,
      });
    } catch {
      const series = asRecord(record.series);
      items.push(
        normalizeItem('series', series, preferences, {
          acquiredAt: arrHistoryAcquiredAt(record),
          arrItemId: seriesId,
          id: `series:history:${seriesId}:${episodeFileId ?? crypto.randomUUID()}`,
          detail: asString(record.sourceTitle) ?? asString(asRecord(record.episode).title),
          isExisting: true,
          isRequested: true,
          inArr: true,
          canAdd: false,
        }),
      );
    }
  }

  return items;
}

function dedupeItems(items: MediaItem[]): MediaItem[] {
  const map = new Map<string, MediaItem>();

  const itemKey = (item: MediaItem): string =>
    item.arrItemId !== null && item.arrItemId !== undefined
      ? `arr:${item.kind}:${item.arrItemId}`
      : `${item.kind}:${item.title}:${item.detail ?? ''}`;

  const itemRank = (item: MediaItem): number => {
    const payloadSize = Object.keys(asRecord(item.requestPayload)).length;
    let score = 0;

    if (!item.id.includes(':queue:')) {
      score += 4;
    }
    if (item.title !== 'Untitled') {
      score += 2;
    }
    if (payloadSize > 0) {
      score += 2;
    }
    if (item.poster) {
      score += 1;
    }
    if (item.auditStatus !== 'pending') {
      score += 1;
    }

    return score;
  };

  for (const item of items) {
    const key = itemKey(item);
    const existing = map.get(key);
    if (!existing || itemRank(item) > itemRank(existing)) {
      map.set(key, {
        ...item,
        acquiredAt: newestAcquiredAt(item.acquiredAt, existing?.acquiredAt),
      });
    } else if (acquisitionTimeMs(item.acquiredAt) > acquisitionTimeMs(existing.acquiredAt)) {
      map.set(key, {
        ...existing,
        acquiredAt: item.acquiredAt ?? existing.acquiredAt ?? null,
      });
    }
  }

  return [...map.values()];
}

async function mergeDashboardPlexItems(items: MediaItem[]): Promise<MediaItem[]> {
  if (!getConfiguredServiceFlags().plexConfigured || items.length === 0) {
    return items;
  }

  const recentPlexItems = await getRecentPlexItems(Math.max(12, items.length));
  const findPlexMatch = (item: MediaItem, candidates: MediaItem[]): MediaItem | null => {
    const matchKeys = new Set(itemMatchKeys(item));
    return (
      candidates.find(
        (plexItem) =>
          plexItem.kind === item.kind && itemMatchKeys(plexItem).some((key) => matchKeys.has(key)),
      ) ?? null
    );
  };

  const mergedRecentItems = items.map((item) => {
    const plexMatch = findPlexMatch(item, recentPlexItems);
    return plexMatch ? mergeItems(item, plexMatch) : item;
  });

  const unresolvedItems = mergedRecentItems.filter((item) => !item.inPlex);
  if (unresolvedItems.length === 0) {
    return mergedRecentItems;
  }

  const searchQueries = [
    ...new Map(
      unresolvedItems.flatMap((item) =>
        itemSearchTitles(item)
          .map((title) => title.trim())
          .filter((title) => title.length >= 2)
          .map((title) => [`${item.kind}:${title}`, { kind: item.kind, title }] as const),
      ),
    ).values(),
  ];
  const searchedPlexItems = (
    await Promise.all(searchQueries.map((query) => searchPlex(query.title, query.kind)))
  ).flat();
  if (searchedPlexItems.length === 0) {
    return mergedRecentItems;
  }

  return mergedRecentItems.map((item) => {
    if (item.inPlex) {
      return item;
    }

    const plexMatch = findPlexMatch(item, searchedPlexItems);
    return plexMatch ? mergeItems(item, plexMatch) : item;
  });
}

async function buildQueueItems(service: ArrService): Promise<QueueItem[]> {
  const flags = getConfiguredServiceFlags();
  if (!flags[service === 'radarr' ? 'radarrConfigured' : 'sonarrConfigured']) {
    return [];
  }

  const records = await fetchQueueRecords(service);

  return records
    .map((record) => normalizeQueueItem(service, record))
    .filter((item): item is QueueItem => item !== null);
}

function buildManagedQueueEntry(
  job: AcquisitionJob,
  liveQueueItems: QueueItem[],
): ManagedQueueEntry {
  const liveSummary = buildManagedLiveSummary(liveQueueItems);
  const capabilities = managedQueueEntryCapabilities(job, liveQueueItems);
  return {
    kind: 'managed',
    id: job.id,
    job,
    liveQueueItems,
    liveSummary,
    canCancel: capabilities.canCancel,
    canRemove: capabilities.canRemove,
  };
}

function buildExternalQueueEntry(item: QueueItem): ExternalQueueEntry {
  const capabilities = externalQueueEntryCapabilities(item);
  return {
    kind: 'external',
    id: queueItemEntryId(item),
    item,
    canCancel: capabilities.canCancel,
    canRemove: capabilities.canRemove,
  };
}

function enrichQueueItemsWithManagedTitles(
  acquisitionJobs: AcquisitionJob[],
  items: QueueItem[],
): QueueItem[] {
  return items.map((item) => {
    const matchingJob =
      acquisitionJobs.find((job) => queueItemMatchesManagedTarget(job, item)) ?? null;
    if (!matchingJob || item.title === matchingJob.title) {
      return item;
    }

    return {
      ...item,
      title: matchingJob.title,
      detail: item.detail ?? item.title,
    };
  });
}

function queueEntryTitle(entry: QueueEntry): string {
  return entry.kind === 'managed' ? entry.job.title : entry.item.title;
}

function queueEntryAcquiredAt(entry: QueueEntry): number {
  if (entry.kind === 'managed') {
    return acquisitionTimeMs(entry.job.startedAt);
  }

  return acquisitionTimeMs(entry.item.addedAt);
}

function liveQueueItemsForManagedJob(job: AcquisitionJob, items: QueueItem[]): QueueItem[] {
  if (isTerminalJobStatus(job.status)) {
    return [];
  }

  if (job.kind === 'movie') {
    const matched = bestQueueIdentityCandidate(job, items);
    return matched ? [matched] : [];
  }

  const identityMatches = items.filter((item) => queueItemMatchesManagedIdentity(job, item));
  const remainingItems =
    identityMatches.length === 0 ? items : items.filter((item) => !identityMatches.includes(item));
  const scopeMatches = remainingItems.filter((item) => queueItemMatchesManagedTarget(job, item));
  return [...identityMatches, ...scopeMatches];
}

function claimManagedQueueIdentities(
  acquisitionJobs: AcquisitionJob[],
  items: QueueItem[],
): AcquisitionJob[] {
  const jobs = getAcquisitionJobRepository();
  let updated = false;
  const nextJobs = acquisitionJobs.map((job) => {
    if (isTerminalJobStatus(job.status)) {
      return job;
    }

    const claimedItem = bestQueueIdentityCandidate(job, items);
    if (!claimedItem) {
      return job;
    }

    const nextQueueId = claimedItem.queueId ?? null;
    const nextDownloadId = claimedItem.downloadId ?? null;
    if (nextQueueId === null && nextDownloadId === null) {
      return job;
    }

    if (
      (job.liveQueueId ?? null) === nextQueueId &&
      (job.liveDownloadId ?? null) === nextDownloadId
    ) {
      return job;
    }

    const persisted = jobs.updateJob(job.id, {
      liveDownloadId: nextDownloadId,
      liveQueueId: nextQueueId,
    });
    updated = true;
    return persisted;
  });

  return updated ? nextJobs : acquisitionJobs;
}

export function composeQueueEntries(
  acquisitionJobs: AcquisitionJob[],
  items: QueueItem[],
): QueueEntry[] {
  let unmatchedItems = enrichQueueItemsWithManagedTitles(acquisitionJobs, items);
  const managedEntries = acquisitionJobs.map((job) => {
    const liveQueueItems = liveQueueItemsForManagedJob(job, unmatchedItems);
    if (liveQueueItems.length > 0) {
      const matchedIds = new Set(liveQueueItems.map((item) => queueItemEntryId(item)));
      unmatchedItems = unmatchedItems.filter((item) => !matchedIds.has(queueItemEntryId(item)));
    }

    return buildManagedQueueEntry(job, liveQueueItems);
  });
  const externalEntries = unmatchedItems.map((item) => buildExternalQueueEntry(item));

  return [...managedEntries, ...externalEntries].sort((left, right) => {
    const acquisitionSort = queueEntryAcquiredAt(right) - queueEntryAcquiredAt(left);
    if (acquisitionSort !== 0) {
      return acquisitionSort;
    }

    return queueEntryTitle(left).localeCompare(queueEntryTitle(right));
  });
}

export async function getQueue(options?: { force?: boolean }): Promise<QueueResponse> {
  ensureAcquisitionWorkers();
  const cacheKey = 'queue';
  const now = Date.now();
  const cached = queueCache.get(cacheKey);

  if (!options?.force && cached && cached.expiresAt > now) {
    return cached.value;
  }

  const items = (await Promise.all([buildQueueItems('radarr'), buildQueueItems('sonarr')])).flat();
  const acquisitionJobs = claimManagedQueueIdentities(getQueueAcquisitionJobs(), items);
  const entries = composeQueueEntries(acquisitionJobs, items);

  const value: QueueResponse = {
    updatedAt: new Date().toISOString(),
    entries,
    total: entries.length,
  };

  queueCache.set(cacheKey, { expiresAt: now + 15_000, value });
  return value;
}

export async function getDashboard(
  preferences?: Partial<Preferences>,
  options?: DashboardOptions,
): Promise<DashboardResponse> {
  const normalizedPreferences = sanitizePreferences(preferences);
  const includeAllBountarr = options?.includeAllBountarr === true;
  const cacheKey = JSON.stringify({
    ...normalizedPreferences,
    includeAllBountarr,
  });
  const now = Date.now();
  const cached = dashboardCache.get(cacheKey);

  if (!options?.force && cached && cached.expiresAt > now) {
    return cached.value;
  }

  if (options?.force) {
    await triggerAutomaticReleaseRetries();
    await triggerDailyMissingMovieSearches(now);
  }

  const recentArrItems = includeAllBountarr
    ? await buildAcquisitionHistoryItems(normalizedPreferences, { includeAll: true })
    : dedupeItems(
        (
          await Promise.all([
            buildAcquisitionHistoryItems(normalizedPreferences),
            buildMovieHistoryItems(normalizedPreferences),
            buildSeriesHistoryItems(normalizedPreferences),
          ])
        ).flat(),
      );
  const items = (await mergeDashboardPlexItems(recentArrItems)).sort((left, right) => {
    const acquisitionSort =
      acquisitionTimeMs(right.acquiredAt) - acquisitionTimeMs(left.acquiredAt);
    if (acquisitionSort !== 0) {
      return acquisitionSort;
    }

    return left.title.localeCompare(right.title);
  });
  const visibleItems = includeAllBountarr ? items : items.slice(0, 14);

  const value: DashboardResponse = {
    updatedAt: new Date().toISOString(),
    items: visibleItems,
    summary: summarizeDashboard(visibleItems),
  };

  dashboardCache.set(cacheKey, { expiresAt: now + 30_000, value });
  return value;
}
