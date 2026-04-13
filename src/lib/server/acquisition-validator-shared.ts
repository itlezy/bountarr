import { arrFetch } from '$lib/server/arr-client';
import { normalizeToken } from '$lib/server/media-identity';
import { asNumber, asRecord, asRecordsArray, asString } from '$lib/server/raw';
import type { ArrService, PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import type { AcquisitionReasonCode, MediaItem } from '$lib/shared/types';

const acquisitionLookupPageSize = 500;

export function lookupPageSize(): number {
  return acquisitionLookupPageSize;
}

export type ValidationProbe = {
  outcome: 'pending' | 'success' | 'failure';
  preferredReleaser: string | null;
  progress: number | null;
  queueStatus: string | null;
  reasonCode: AcquisitionReasonCode | null;
  summary: string | null;
};

export function normalizeReleaseTitle(value: string | null): string {
  return normalizeToken(value ?? '');
}

export async function fetchQueueRecords(service: ArrService): Promise<Record<string, unknown>[]> {
  return arrFetch<unknown>(service, '/api/v3/queue', undefined, {
    pageSize: acquisitionLookupPageSize,
    page: 1,
    sortKey: 'timeleft',
    sortDirection: 'ascending',
  })
    .then(asRecordsArray)
    .then((records) => records.map(asRecord))
    .catch(() => []);
}

export async function fetchHistoryRecords(
  service: ArrService,
  itemId: number,
): Promise<Record<string, unknown>[]> {
  return arrFetch<unknown>(service, '/api/v3/history', undefined, {
    pageSize: acquisitionLookupPageSize,
    page: 1,
    sortKey: 'date',
    sortDirection: 'descending',
  })
    .then(asRecordsArray)
    .then((records) =>
      records
        .map(asRecord)
        .filter((record) =>
          service === 'radarr'
            ? asNumber(record.movieId) === itemId
            : asNumber(record.seriesId) === itemId,
        ),
    )
    .catch(() => []);
}

export function historySince(
  records: Record<string, unknown>[],
  startedAt: string,
  releaseTitle: string | null,
): Record<string, unknown>[] {
  const startedMs = Date.parse(startedAt);
  const normalizedReleaseTitle = normalizeReleaseTitle(releaseTitle);

  return records.filter((record) => {
    const dateMs = Date.parse(asString(record.date) ?? '');
    if (!Number.isFinite(dateMs) || dateMs < startedMs) {
      return false;
    }

    if (!normalizedReleaseTitle) {
      return true;
    }

    const sourceTitle = normalizeReleaseTitle(asString(record.sourceTitle));
    return (
      sourceTitle.length === 0 ||
      sourceTitle.includes(normalizedReleaseTitle) ||
      normalizedReleaseTitle.includes(sourceTitle)
    );
  });
}

export function validationSummary(item: MediaItem): string | null {
  if (item.auditStatus === 'verified') {
    return `Verified audio ${item.audioLanguages.join(', ') || 'unknown'} with subtitles ${item.subtitleLanguages.join(', ') || 'present'}`;
  }

  if (item.auditStatus === 'missing-language') {
    return `Missing preferred audio. Found ${item.audioLanguages.join(', ') || 'unknown audio'}`;
  }

  if (item.auditStatus === 'no-subs') {
    return `Imported file is missing the selected subtitle language. Found ${item.subtitleLanguages.join(', ') || 'no subtitle metadata'}`;
  }

  return null;
}

export type WaitForAttemptOutcomeResult = {
  outcome: 'success' | 'failure' | 'timeout';
  preferredReleaser: string | null;
  progress: number | null;
  queueStatus: string | null;
  reasonCode: AcquisitionReasonCode;
  summary: string;
};

export type AttemptProgressHandler = (progress: {
  progress: number | null;
  queueStatus: string | null;
}) => void;

export type AttemptValidator = (
  job: PersistedAcquisitionJob,
  attemptStart: string,
) => Promise<ValidationProbe>;
