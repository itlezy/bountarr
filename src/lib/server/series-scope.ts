import type { AcquisitionJob } from '$lib/shared/types';
import { asArray, asNumber, asRecord } from '$lib/server/raw';

export type SeriesScope = {
  episodeIds: number[] | null;
  seasonNumbers: number[] | null;
};

type SeriesScopeMatchStatus = 'exact' | 'partial' | 'mismatch' | 'unknown';

function uniqueSortedNumbers(values: Array<number | null | undefined>): number[] | null {
  const normalized = [...new Set(
    values
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .map((value) => Math.trunc(value))
      .filter((value) => value >= 0),
  )].sort((left, right) => left - right);

  return normalized.length > 0 ? normalized : null;
}

function sameNumbers(left: number[] | null, right: number[] | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function overlaps(left: number[] | null, right: number[] | null): boolean {
  if (!left || !right) {
    return false;
  }

  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function seriesEpisodeRecords(raw: Record<string, unknown>): Record<string, unknown>[] {
  const records = asArray(raw.episodes).map(asRecord);
  const singleEpisode = asRecord(raw.episode);
  if (Object.keys(singleEpisode).length > 0) {
    records.unshift(singleEpisode);
  }

  return records;
}

export function normalizeNumberArray(value: number[] | null | undefined): number[] | null {
  return uniqueSortedNumbers(value ?? []);
}

export function extractSeriesScope(rawValue: unknown): SeriesScope {
  const raw = asRecord(rawValue);
  const episodeRecords = seriesEpisodeRecords(raw);
  const episodeIds = uniqueSortedNumbers([
    asNumber(raw.episodeId),
    ...asArray(raw.episodeIds).map(asNumber),
    ...episodeRecords.map((episode) => asNumber(episode.id) ?? asNumber(episode.episodeId)),
  ]);
  const seasonNumbers = uniqueSortedNumbers([
    asNumber(raw.seasonNumber),
    ...asArray(raw.seasonNumbers).map(asNumber),
    ...asArray(raw.seasons).flatMap((season) => {
      const seasonRecord = asRecord(season);
      return [
        asNumber(season),
        asNumber(seasonRecord.seasonNumber),
        asNumber(seasonRecord.value),
      ];
    }),
    ...episodeRecords.map((episode) => asNumber(episode.seasonNumber)),
  ]);

  return {
    episodeIds,
    seasonNumbers,
  };
}

export function scopeFromSeriesJob(
  job: Pick<AcquisitionJob, 'kind' | 'targetEpisodeIds' | 'targetSeasonNumbers'>,
): SeriesScope | null {
  if (job.kind !== 'series') {
    return null;
  }

  return {
    episodeIds: normalizeNumberArray(job.targetEpisodeIds),
    seasonNumbers: normalizeNumberArray(job.targetSeasonNumbers),
  };
}

export function classifySeriesScopeMatch(
  target: SeriesScope | null,
  candidate: SeriesScope,
): { reason: string; status: SeriesScopeMatchStatus } {
  if (!target || (!target.episodeIds && !target.seasonNumbers)) {
    return {
      reason: 'This grab does not have a persisted series scope yet.',
      status: 'unknown',
    };
  }

  if (!candidate.episodeIds && !candidate.seasonNumbers) {
    return {
      reason: 'The release does not expose season or episode scope.',
      status: 'unknown',
    };
  }

  if (candidate.episodeIds && target.episodeIds) {
    if (sameNumbers(candidate.episodeIds, target.episodeIds)) {
      return {
        reason: 'Release scope matches the targeted episodes exactly.',
        status: 'exact',
      };
    }

    return overlaps(candidate.episodeIds, target.episodeIds)
      ? {
          reason: 'Release scope overlaps the targeted episodes but does not match exactly.',
          status: 'partial',
        }
      : {
          reason: 'Release scope targets different episodes.',
          status: 'mismatch',
        };
  }

  if (candidate.seasonNumbers && target.seasonNumbers) {
    if (sameNumbers(candidate.seasonNumbers, target.seasonNumbers)) {
      return {
        reason: 'Release scope matches the targeted seasons exactly.',
        status: 'exact',
      };
    }

    return overlaps(candidate.seasonNumbers, target.seasonNumbers)
      ? {
          reason: 'Release scope overlaps the targeted seasons but does not match exactly.',
          status: 'partial',
        }
      : {
          reason: 'Release scope targets different seasons.',
          status: 'mismatch',
        };
  }

  return {
    reason: 'Release scope could not be compared reliably against the targeted scope.',
    status: 'unknown',
  };
}

export function seriesScopeOverlapsTarget(
  target: SeriesScope | null,
  candidate: SeriesScope,
): boolean {
  const match = classifySeriesScopeMatch(target, candidate);
  return match.status === 'exact' || match.status === 'partial';
}

export function describeSeriesScope(scope: SeriesScope | null): string | null {
  if (!scope) {
    return null;
  }

  if (scope.seasonNumbers && scope.seasonNumbers.length > 0) {
    if (scope.seasonNumbers.length === 1) {
      return scope.seasonNumbers[0] === 0 ? 'Specials' : `Season ${scope.seasonNumbers[0]}`;
    }

    return `Seasons ${scope.seasonNumbers.join(', ')}`;
  }

  if (scope.episodeIds && scope.episodeIds.length > 0) {
    return `${scope.episodeIds.length} episode${scope.episodeIds.length === 1 ? '' : 's'}`;
  }

  return null;
}
