import { extractPoster } from '$lib/server/media-normalize';
import { asNumber, asRecord, asString } from '$lib/server/raw';
import { extractSeriesScope } from '$lib/server/series-scope';
import type { ArrService } from '$lib/server/acquisition-domain';
import type { QueueItem } from '$lib/shared/types';

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

  return {
    id: `${service}:queue:${asString(record.downloadId) ?? asString(record.id) ?? crypto.randomUUID()}`,
    arrItemId:
      service === 'radarr'
        ? (asNumber(record.movieId) ?? asNumber(parent.id))
        : (asNumber(record.seriesId) ?? asNumber(parent.id)),
    canCancel: asNumber(record.id) !== null,
    kind: service === 'radarr' ? 'movie' : 'series',
    title,
    year: asNumber(parent.year),
    poster: extractPoster(parent),
    sourceService: service,
    status: formatQueueStatus(record),
    progress,
    timeLeft: asString(record.timeleft) ?? asString(record.timeLeft),
    estimatedCompletionTime: asString(record.estimatedCompletionTime),
    size,
    sizeLeft,
    queueId: asNumber(record.id),
    detail:
      (asString(record.title) ?? asString(record.sourceTitle) ?? asString(episode.title) ?? null) ===
      title
        ? null
        : (asString(record.title) ?? asString(record.sourceTitle) ?? asString(episode.title) ?? null),
    episodeIds: seriesScope?.episodeIds ?? null,
    seasonNumbers: seriesScope?.seasonNumbers ?? null,
  };
}
