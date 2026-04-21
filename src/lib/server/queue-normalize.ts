import { normalizeToken } from '$lib/server/media-identity';
import { extractPoster } from '$lib/server/media-normalize';
import { asNumber, asRecord, asString } from '$lib/server/raw';
import { extractSeriesScope } from '$lib/server/series-scope';
import type { ArrService } from '$lib/server/acquisition-domain';
import type { QueueItem } from '$lib/shared/types';

const importBlockedMessagePatterns = [
  /not an upgrade for existing .* file/i,
  /not a custom format upgrade for existing .* file/i,
];

const staleExternalMessagePatterns = [
  ...importBlockedMessagePatterns,
  /destination path already exists/i,
];

function formatQueueStatus(record: Record<string, unknown>): string {
  return (
    asString(record.status) ??
    asString(record.trackedDownloadStatus) ??
    asString(record.trackedDownloadState) ??
    'Queued'
  )
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function queueStatusDetail(record: Record<string, unknown>): string | null {
  const redundantTitle = asString(record.title) ?? asString(record.sourceTitle);
  const messages = (Array.isArray(record.statusMessages) ? record.statusMessages : [])
    .map(asRecord)
    .flatMap((entry) => {
      const title = asString(entry.title);
      const entryMessages = (Array.isArray(entry.messages) ? entry.messages : [])
        .map(asString)
        .filter((value): value is string => value !== null);

      if (entryMessages.length === 0) {
        return title ? [title] : [];
      }

      if (!title || title === redundantTitle) {
        return entryMessages;
      }

      return entryMessages.map((message) => `${title}: ${message}`);
    });

  const uniqueMessages = [...new Set(messages)];
  return uniqueMessages.length > 0 ? uniqueMessages.join(' · ') : null;
}

function normalizeIdentityPart(value: string | null): string {
  const normalized = value ? normalizeToken(value).replace(/\s+/g, '-') : '';
  return normalized.length > 0 ? normalized : 'unknown';
}

export function queueFallbackIdentity(
  service: ArrService,
  record: Record<string, unknown>,
): string {
  const parent = service === 'radarr' ? asRecord(record.movie) : asRecord(record.series);
  const episode = asRecord(record.episode);
  const arrItemId =
    service === 'radarr'
      ? (asNumber(record.movieId) ?? asNumber(parent.id))
      : (asNumber(record.seriesId) ?? asNumber(parent.id));
  const scope = service === 'sonarr' ? extractSeriesScope(record) : null;
  const titlePart = normalizeIdentityPart(
    asString(record.title) ??
      asString(record.sourceTitle) ??
      asString(parent.title) ??
      asString(episode.title),
  );
  const scopePart =
    service === 'sonarr'
      ? scope?.episodeIds?.length
        ? `episodes-${scope.episodeIds.join('.')}`
        : scope?.seasonNumbers?.length
          ? `seasons-${scope.seasonNumbers.join('.')}`
          : 'noscope'
      : 'noscope';

  return `${service}-${arrItemId ?? 'na'}-${titlePart}-${scopePart}`;
}

function queueItemId(
  service: ArrService,
  queueId: number | null,
  downloadId: string | null,
  record: Record<string, unknown>,
): string {
  const fallbackId = queueFallbackIdentity(service, record);

  if (downloadId) {
    return `${service}:download:${downloadId}:${fallbackId}`;
  }

  if (queueId !== null) {
    return `${service}:queue:${queueId}`;
  }

  return `${service}:queue:${fallbackId}`;
}

function normalizeTrackedDownloadValue(value: unknown): string | null {
  const normalized = asString(value)?.trim().toLowerCase() ?? null;
  return normalized && normalized.length > 0 ? normalized : null;
}

export function queueItemIsImportBlocked(
  item: Pick<
    QueueItem,
    'status' | 'statusDetail' | 'trackedDownloadState' | 'trackedDownloadStatus'
  >,
): boolean {
  if (item.trackedDownloadState !== 'importpending') {
    return false;
  }

  const normalizedStatus = item.status.trim().toLowerCase();
  if (item.trackedDownloadStatus !== 'warning' && normalizedStatus !== 'completed') {
    return false;
  }

  const detail = item.statusDetail ?? '';
  return importBlockedMessagePatterns.some((pattern) => pattern.test(detail));
}

export function queueItemIsStaleExternal(
  item: Pick<
    QueueItem,
    'status' | 'statusDetail' | 'trackedDownloadState' | 'trackedDownloadStatus'
  >,
): boolean {
  if (item.trackedDownloadState !== 'importpending') {
    return false;
  }

  const normalizedStatus = item.status.trim().toLowerCase();
  if (item.trackedDownloadStatus !== 'warning' && normalizedStatus !== 'completed') {
    return false;
  }

  const detail = item.statusDetail?.trim() ?? '';
  return staleExternalMessagePatterns.some((pattern) => pattern.test(detail));
}

export function normalizeQueueItem(service: ArrService, rawValue: unknown): QueueItem | null {
  const record = asRecord(rawValue);
  const parent = service === 'radarr' ? asRecord(record.movie) : asRecord(record.series);
  const fallbackTitle =
    asString(record.movieTitle) ??
    asString(record.seriesTitle) ??
    asString(record.title) ??
    asString(record.sourceTitle);
  const title = asString(parent.title) ?? fallbackTitle;
  if (!title) {
    return null;
  }

  const size = asNumber(record.size);
  const sizeLeft = asNumber(record.sizeleft) ?? asNumber(record.sizeLeft);
  const computedProgress =
    size !== null && size > 0 && sizeLeft !== null
      ? Math.max(0, Math.min(100, ((size - sizeLeft) / size) * 100))
      : null;
  const progress = asNumber(record.progress) ?? computedProgress;
  const episode = asRecord(record.episode);
  const seriesScope = service === 'sonarr' ? extractSeriesScope(record) : null;
  const queueId = asNumber(record.id);
  const downloadId = asString(record.downloadId);

  return {
    id: queueItemId(service, queueId, downloadId, record),
    downloadId,
    arrItemId:
      service === 'radarr'
        ? (asNumber(record.movieId) ?? asNumber(parent.id))
        : (asNumber(record.seriesId) ?? asNumber(parent.id)),
    canCancel: queueId !== null,
    kind: service === 'radarr' ? 'movie' : 'series',
    title,
    year: asNumber(parent.year),
    poster: extractPoster(parent),
    sourceService: service,
    status: formatQueueStatus(record),
    statusDetail: queueStatusDetail(record),
    trackedDownloadStatus: normalizeTrackedDownloadValue(record.trackedDownloadStatus),
    trackedDownloadState: normalizeTrackedDownloadValue(record.trackedDownloadState),
    progress,
    timeLeft: asString(record.timeleft) ?? asString(record.timeLeft),
    estimatedCompletionTime: asString(record.estimatedCompletionTime),
    size,
    sizeLeft,
    queueId,
    detail:
      (asString(record.title) ??
        asString(record.sourceTitle) ??
        asString(episode.title) ??
        null) === title
        ? null
        : (asString(record.title) ??
          asString(record.sourceTitle) ??
          asString(episode.title) ??
          null),
    episodeIds: seriesScope?.episodeIds ?? null,
    seasonNumbers: seriesScope?.seasonNumbers ?? null,
  };
}
