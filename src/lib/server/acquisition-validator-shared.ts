import { arrFetch } from '$lib/server/arr-client';
import { normalizeToken } from '$lib/server/media-identity';
import { asNumber, asPositiveNumber, asRecord, asRecordsArray, asString } from '$lib/server/raw';
import type { ArrService, PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import type { AcquisitionReasonCode, MediaItem } from '$lib/shared/types';

const acquisitionLookupPageSize = 1000;
const acquisitionLookupMaxPages = 20;

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

type PagedArrResponse = {
  pageSize: number | null;
  records: Record<string, unknown>[];
  totalRecords: number | null;
};

export function normalizeReleaseTitle(value: string | null): string {
  return normalizeToken(value ?? '');
}

function pagedArrResponse(payload: unknown): PagedArrResponse {
  if (Array.isArray(payload)) {
    return {
      pageSize: null,
      records: payload.map(asRecord),
      totalRecords: payload.length,
    };
  }

  const record = asRecord(payload);
  return {
    pageSize: asPositiveNumber(record.pageSize),
    records: asRecordsArray(record).map(asRecord),
    totalRecords: asPositiveNumber(record.totalRecords),
  };
}

async function fetchPagedRecords(
  service: ArrService,
  requestPath: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<Record<string, unknown>[]> {
  try {
    const records: Record<string, unknown>[] = [];

    for (let page = 1; page <= acquisitionLookupMaxPages; page += 1) {
      const payload = pagedArrResponse(
        await arrFetch<unknown>(service, requestPath, undefined, {
          ...query,
          page,
          pageSize: acquisitionLookupPageSize,
        }),
      );
      records.push(...payload.records);

      if (payload.records.length === 0) {
        break;
      }

      if (payload.totalRecords !== null && records.length >= payload.totalRecords) {
        break;
      }

      if (payload.pageSize === null || payload.records.length < payload.pageSize) {
        break;
      }
    }

    return records;
  } catch {
    return [];
  }
}

export async function fetchQueueRecords(service: ArrService): Promise<Record<string, unknown>[]> {
  return fetchPagedRecords(service, '/api/v3/queue', {
    sortKey: 'timeleft',
    sortDirection: 'ascending',
  });
}

export function queueRecordArrItemId(
  service: ArrService,
  record: Record<string, unknown>,
): number | null {
  if (service === 'radarr') {
    return asNumber(record.movieId) ?? asNumber(asRecord(record.movie).id);
  }

  return asNumber(record.seriesId) ?? asNumber(asRecord(record.series).id);
}

export function findQueueRecordsForArrItem(
  records: Record<string, unknown>[],
  service: ArrService,
  arrItemId: number,
): Record<string, unknown>[] {
  return records.filter((record) => queueRecordArrItemId(service, record) === arrItemId);
}

export function findQueueRecordForArrItem(
  records: Record<string, unknown>[],
  service: ArrService,
  arrItemId: number,
): Record<string, unknown> | null {
  return findQueueRecordsForArrItem(records, service, arrItemId)[0] ?? null;
}

export function queueRecordId(record: Record<string, unknown>): number | null {
  return asNumber(record.id);
}

function historyRecordArrItemId(
  service: ArrService,
  record: Record<string, unknown>,
): number | null {
  if (service === 'radarr') {
    return asNumber(record.movieId) ?? asNumber(asRecord(record.movie).id);
  }

  return asNumber(record.seriesId) ?? asNumber(asRecord(record.series).id);
}

export async function fetchHistoryRecords(
  service: ArrService,
  itemId: number,
): Promise<Record<string, unknown>[]> {
  const records = await fetchPagedRecords(service, '/api/v3/history', {
    sortKey: 'date',
    sortDirection: 'descending',
  });

  return records.filter((record) => historyRecordArrItemId(service, record) === itemId);
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
