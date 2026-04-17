import type { AcquisitionJob } from '$lib/shared/types';
import { normalizeToken } from '$lib/server/media-identity';
import { asArray, asNumber, asRecord } from '$lib/server/raw';

export type SeriesScope = {
  episodeIds: number[] | null;
  episodeScopedHint?: boolean;
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

function isSubset(left: number[] | null, right: number[] | null): boolean {
  if (!left || !right) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function seriesEpisodeRecords(raw: Record<string, unknown>): Record<string, unknown>[] {
  const records = asArray(raw.episodes).map(asRecord);
  const singleEpisode = asRecord(raw.episode);
  if (Object.keys(singleEpisode).length > 0) {
    records.unshift(singleEpisode);
  }

  return records;
}

function titleSeasonNumbers(value: string | null): number[] {
  if (!value) {
    return [];
  }

  const seasonNumbers: Array<number | null> = [];
  for (const pattern of [
    /\bs(?:eason)?[ ._-]?(\d{1,2})(?=e\d{1,2}|[ ._-]|$)/giu,
    /\bseason[ ._-]?(\d{1,2})\b/giu,
    /\b(\d{1,2})x\d{1,2}\b/giu,
  ]) {
    for (const match of value.matchAll(pattern)) {
      const seasonNumber = Number.parseInt(match[1] ?? '', 10);
      seasonNumbers.push(Number.isFinite(seasonNumber) ? seasonNumber : null);
    }
  }

  return uniqueSortedNumbers(seasonNumbers) ?? [];
}

function titleLooksEpisodeScoped(value: string | null): boolean {
  if (!value) {
    return false;
  }

  return /\bs\d{1,2}e\d{1,3}(?:[ ._-]*e?\d{1,3})*\b|\b\d{1,2}x\d{1,3}(?:[ ._-]*\d{1,3})*\b/iu.test(
    value,
  );
}

export function normalizeNumberArray(value: number[] | null | undefined): number[] | null {
  return uniqueSortedNumbers(value ?? []);
}

export function scopeFromTarget(value: {
  targetEpisodeIds?: number[] | null;
  targetSeasonNumbers?: number[] | null;
}): SeriesScope {
  return {
    episodeIds: normalizeNumberArray(value.targetEpisodeIds),
    episodeScopedHint: false,
    seasonNumbers: normalizeNumberArray(value.targetSeasonNumbers),
  };
}

export function extractSeriesScope(rawValue: unknown): SeriesScope {
  const raw = asRecord(rawValue);
  const episodeRecords = seriesEpisodeRecords(raw);
  const inferredSeasonNumbers = uniqueSortedNumbers([
    ...titleSeasonNumbers(typeof raw.title === 'string' ? raw.title : null),
    ...titleSeasonNumbers(typeof raw.sourceTitle === 'string' ? raw.sourceTitle : null),
    ...titleSeasonNumbers(typeof raw.releaseTitle === 'string' ? raw.releaseTitle : null),
    ...titleSeasonNumbers(typeof raw.detail === 'string' ? raw.detail : null),
  ]);
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
    ...(inferredSeasonNumbers ?? []),
  ]);

  return {
    episodeIds,
    episodeScopedHint:
      episodeIds !== null ||
      episodeRecords.length > 0 ||
      titleLooksEpisodeScoped(typeof raw.title === 'string' ? raw.title : null) ||
      titleLooksEpisodeScoped(typeof raw.sourceTitle === 'string' ? raw.sourceTitle : null) ||
      titleLooksEpisodeScoped(typeof raw.releaseTitle === 'string' ? raw.releaseTitle : null) ||
      titleLooksEpisodeScoped(typeof raw.detail === 'string' ? raw.detail : null),
    seasonNumbers,
  };
}

export function scopeFromSeriesJob(
  job: Pick<AcquisitionJob, 'kind' | 'targetEpisodeIds' | 'targetSeasonNumbers'>,
): SeriesScope | null {
  if (job.kind !== 'series') {
    return null;
  }

  return scopeFromTarget(job);
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

  if (candidate.seasonNumbers && target.seasonNumbers) {
    if (sameNumbers(candidate.seasonNumbers, target.seasonNumbers)) {
      if (candidate.episodeIds && target.episodeIds) {
        if (sameNumbers(candidate.episodeIds, target.episodeIds)) {
          return {
            reason: 'Release scope matches the targeted seasons and episodes exactly.',
            status: 'exact',
          };
        }

        return isSubset(candidate.episodeIds, target.episodeIds)
          ? {
              reason: 'Release scope only covers part of the targeted seasons.',
              status: 'partial',
            }
          : {
              reason: 'Release scope matches the targeted seasons and covers the known episodes.',
              status: 'exact',
            };
      }

      if (candidate.episodeScopedHint && (!target.episodeIds || target.episodeIds.length !== 1)) {
        return {
          reason: 'Release appears to cover individual episodes within the targeted seasons.',
          status: 'partial',
        };
      }

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

export function titleSuggestsCompleteSeriesPack(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = normalizeToken(value);
  return (
    (/\bcomplete\b/.test(normalized) || /\bfull\b/.test(normalized)) &&
    /\bseries\b|\bseasons\b/.test(normalized)
  );
}
