import type { AcquisitionJob } from '$lib/shared/types';

function normalizeNumbers(values: number[] | null | undefined): number[] {
  return [
    ...new Set(
      (values ?? []).filter((value) => Number.isFinite(value)).map((value) => Math.trunc(value)),
    ),
  ]
    .filter((value) => value >= 0)
    .sort((left, right) => left - right);
}

export function describeAcquisitionTarget(
  job: Pick<AcquisitionJob, 'kind' | 'targetEpisodeIds' | 'targetSeasonNumbers'>,
): string | null {
  if (job.kind !== 'series') {
    return null;
  }

  const seasonNumbers = normalizeNumbers(job.targetSeasonNumbers);
  if (seasonNumbers.length > 0) {
    if (seasonNumbers.length === 1) {
      return seasonNumbers[0] === 0 ? 'Specials' : `Season ${seasonNumbers[0]}`;
    }

    return `Seasons ${seasonNumbers.join(', ')}`;
  }

  const episodeIds = normalizeNumbers(job.targetEpisodeIds);
  if (episodeIds.length > 0) {
    return `${episodeIds.length} episode${episodeIds.length === 1 ? '' : 's'}`;
  }

  return 'Entire series';
}
