import { arrFetch, isArrFetchError } from '$lib/server/arr-client';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import { asNumber, asRecord } from '$lib/server/raw';

export type FailedImportCleanupResult = {
  deletedFileIds: number[];
  skipped: boolean;
};

function targetEpisodeFileIds(
  job: Pick<PersistedAcquisitionJob, 'targetEpisodeIds' | 'targetSeasonNumbers'>,
  episodeRecords: Record<string, unknown>[],
): number[] {
  const targetEpisodeIds = job.targetEpisodeIds ? new Set(job.targetEpisodeIds) : null;
  const targetSeasonNumbers = job.targetSeasonNumbers ? new Set(job.targetSeasonNumbers) : null;

  if (!targetEpisodeIds && !targetSeasonNumbers) {
    return [];
  }

  const fileIds = episodeRecords
    .filter((episode) => {
      const episodeId = asNumber(episode.id);
      const seasonNumber = asNumber(episode.seasonNumber);
      return targetSeasonNumbers
        ? targetSeasonNumbers.has(seasonNumber ?? Number.NaN)
        : targetEpisodeIds?.has(episodeId ?? Number.NaN);
    })
    .map((episode) => asNumber(episode.episodeFileId))
    .filter(
      (episodeFileId): episodeFileId is number => episodeFileId !== null && episodeFileId > 0,
    );

  return [...new Set(fileIds)];
}

async function deleteFile(service: 'radarr' | 'sonarr', fileId: number): Promise<boolean> {
  try {
    await arrFetch<unknown>(
      service,
      service === 'radarr' ? `/api/v3/moviefile/${fileId}` : `/api/v3/episodefile/${fileId}`,
      {
        method: 'DELETE',
      },
      {
        deleteFiles: true,
      },
    );
    return true;
  } catch (error) {
    if (isArrFetchError(error) && error.status === 404) {
      return false;
    }

    throw error;
  }
}

async function cleanupMovieFile(
  job: Pick<PersistedAcquisitionJob, 'arrItemId'>,
): Promise<number[]> {
  const movie = asRecord(await arrFetch<unknown>('radarr', `/api/v3/movie/${job.arrItemId}`));
  const movieFileId = asNumber(movie.movieFileId) ?? asNumber(asRecord(movie.movieFile).id);

  if (movieFileId === null || movieFileId <= 0) {
    return [];
  }

  return (await deleteFile('radarr', movieFileId)) ? [movieFileId] : [];
}

async function cleanupSeriesFiles(
  job: Pick<PersistedAcquisitionJob, 'arrItemId' | 'targetEpisodeIds' | 'targetSeasonNumbers'>,
): Promise<number[]> {
  const episodes = (
    await arrFetch<unknown[]>('sonarr', '/api/v3/episode', undefined, {
      seriesId: job.arrItemId,
    })
  ).map(asRecord);
  const episodeFileIds = targetEpisodeFileIds(job, episodes);
  const deletedFileIds: number[] = [];

  for (const episodeFileId of episodeFileIds) {
    if (await deleteFile('sonarr', episodeFileId)) {
      deletedFileIds.push(episodeFileId);
    }
  }

  return deletedFileIds;
}

export async function cleanupFailedImportForRetry(
  job: PersistedAcquisitionJob,
): Promise<FailedImportCleanupResult> {
  const deletedFileIds =
    job.kind === 'movie' ? await cleanupMovieFile(job) : await cleanupSeriesFiles(job);

  return {
    deletedFileIds,
    skipped: deletedFileIds.length === 0,
  };
}
