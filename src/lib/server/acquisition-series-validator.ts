import { jobStatusLabel } from '$lib/server/acquisition-domain';
import {
  fetchHistoryRecords,
  fetchQueueRecords,
  historySince,
  queueImportBlock,
  type ValidationProbe,
} from '$lib/server/acquisition-validator-shared';
import { buildManagedLiveSummary } from '$lib/server/queue-live-summary';
import { normalizeItem, normalizeLanguageEntries } from '$lib/server/media-normalize';
import {
  bestQueueIdentityCandidate,
  queueItemMatchesManagedTarget,
} from '$lib/server/queue-matching';
import { normalizeQueueItem } from '$lib/server/queue-normalize';
import { asNumber, asRecord, asString } from '$lib/server/raw';
import { fetchEpisodeFile, fetchSeriesEpisodeRecords } from '$lib/server/lookup-service';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import { defaultPreferences } from '$lib/shared/preferences';
import type { QueueItem } from '$lib/shared/types';

type SeriesEpisodeRecord = {
  episodeFileId: number | null;
  episodeId: number | null;
  seasonNumber: number | null;
};

function targetEpisodesForJob(
  job: PersistedAcquisitionJob,
  episodeRecords: Record<string, unknown>[],
): SeriesEpisodeRecord[] {
  const targetEpisodeIds = job.targetEpisodeIds ? new Set(job.targetEpisodeIds) : null;
  const targetSeasonNumbers = job.targetSeasonNumbers ? new Set(job.targetSeasonNumbers) : null;

  return episodeRecords
    .map((episode) => ({
      episodeFileId: asNumber(episode.episodeFileId),
      episodeId: asNumber(episode.id),
      seasonNumber: asNumber(episode.seasonNumber),
    }))
    .filter(
      (episode): episode is SeriesEpisodeRecord =>
        episode.episodeId !== null &&
        (
          targetSeasonNumbers
            ? targetSeasonNumbers.has(episode.seasonNumber ?? Number.NaN)
            : targetEpisodeIds
              ? targetEpisodeIds.has(episode.episodeId)
              : true
        ),
    );
}

function pendingProgress(
  job: PersistedAcquisitionJob,
  queueItems: QueueItem[],
): { progress: number | null; queueStatus: string | null } {
  const liveSummary = buildManagedLiveSummary(queueItems);
  return {
    progress: liveSummary?.progress ?? job.progress,
    queueStatus: liveSummary?.status ?? job.queueStatus ?? jobStatusLabel(job.status),
  };
}

export async function validateSeriesAttempt(
  job: PersistedAcquisitionJob,
  attemptStart: string,
): Promise<ValidationProbe> {
  const [queueRecords, historyRecords, episodeRecords] = await Promise.all([
    fetchQueueRecords('sonarr'),
    fetchHistoryRecords('sonarr', job.arrItemId),
    fetchSeriesEpisodeRecords(job.arrItemId),
  ]);
  const matchingQueueEntries = queueRecords
    .map((record) => ({
      item: normalizeQueueItem('sonarr', record),
      record,
    }))
    .filter(
      (entry): entry is { item: QueueItem; record: Record<string, unknown> } =>
        entry.item !== null && queueItemMatchesManagedTarget(job, entry.item),
    );
  const queueItems = matchingQueueEntries.map((entry) => entry.item);
  const claimedQueueItem = bestQueueIdentityCandidate(job, queueItems);
  const importBlocks = matchingQueueEntries
    .map((entry) => queueImportBlock(entry.record))
    .filter((entry) => entry !== null);
  const relevantHistory = historySince(historyRecords, attemptStart, job.currentRelease);
  const historyEpisodeFileIds = new Set(
    relevantHistory
      .map((record) => asNumber(record.episodeFileId) ?? asNumber(asRecord(record.data).episodeFileId))
      .filter((value): value is number => value !== null && value > 0),
  );
  const targetEpisodes = targetEpisodesForJob(job, episodeRecords);
  const importedTargetEpisodes = targetEpisodes.filter(
    (episode) =>
      episode.episodeFileId !== null && historyEpisodeFileIds.has(episode.episodeFileId),
  );
  const progress = pendingProgress(job, queueItems);
  const blockingImport =
    importBlocks.length > 0 && importBlocks.length === matchingQueueEntries.length
      ? importBlocks[0]
      : null;

  if (targetEpisodes.length === 0) {
    return {
      outcome: 'pending',
      preferredReleaser: null,
      progress: progress.progress,
      queueStatus: progress.queueStatus,
      liveDownloadId: claimedQueueItem?.downloadId ?? null,
      liveQueueId: claimedQueueItem?.queueId ?? null,
      reasonCode: null,
      summary: 'Waiting for Sonarr to resolve the targeted episodes for this grab.',
    };
  }

  if (blockingImport && importedTargetEpisodes.length < targetEpisodes.length) {
    return {
      outcome: 'failure',
      preferredReleaser: null,
      progress: 100,
      queueStatus: blockingImport.queueStatus,
      liveDownloadId: null,
      liveQueueId: null,
      reasonCode: blockingImport.reasonCode,
      summary: blockingImport.summary,
    };
  }

  if (importedTargetEpisodes.length < targetEpisodes.length) {
    return {
      outcome: 'pending',
      preferredReleaser: null,
      progress: progress.progress,
      queueStatus: progress.queueStatus,
      liveDownloadId: claimedQueueItem?.downloadId ?? null,
      liveQueueId: claimedQueueItem?.queueId ?? null,
      reasonCode: null,
      summary:
        importedTargetEpisodes.length > 0
          ? `Imported ${importedTargetEpisodes.length} of ${targetEpisodes.length} targeted episodes`
          : null,
    };
  }

  const validations = await Promise.all(
    importedTargetEpisodes.map(async ({ episodeFileId }) => {
      if (episodeFileId === null) {
        return {
          auditStatus: 'unknown',
          audioLanguages: [],
          episodeFileId: 0,
          subtitleLanguages: [],
        };
      }

      const episodeFile = await fetchEpisodeFile(episodeFileId);
      const mediaInfo = asRecord(episodeFile?.mediaInfo);
      const audioLanguages = normalizeLanguageEntries(mediaInfo.audioLanguages);
      const subtitleLanguages = normalizeLanguageEntries(
        mediaInfo.subtitles ?? mediaInfo.subtitleLanguages,
      );
      const auditStatus = normalizeItem(
        'series',
        { mediaInfo },
        {
          cardsView: defaultPreferences.cardsView,
          preferredLanguage: job.preferences.preferredLanguage,
          subtitleLanguage: job.preferences.subtitleLanguage,
          theme: 'system',
        },
      ).auditStatus;

      return {
        auditStatus,
        audioLanguages,
        episodeFileId,
        subtitleLanguages,
      };
    }),
  );

  if (validations.some((entry) => entry.auditStatus === 'unknown')) {
    return {
      outcome: 'pending',
      preferredReleaser: null,
      progress: progress.progress,
      queueStatus: progress.queueStatus,
      liveDownloadId: claimedQueueItem?.downloadId ?? null,
      liveQueueId: claimedQueueItem?.queueId ?? null,
      reasonCode: null,
      summary: 'Imported episodes are waiting for media info',
    };
  }

  const failed = validations.find(
    (entry) => entry.auditStatus === 'missing-language' || entry.auditStatus === 'no-subs',
  );

  if (failed) {
    return {
      outcome: 'failure',
      preferredReleaser: null,
      progress: 100,
      queueStatus: 'Imported',
      liveDownloadId: null,
      liveQueueId: null,
      reasonCode: failed.auditStatus === 'no-subs' ? 'missing-subs' : 'missing-audio',
      summary:
        failed.auditStatus === 'no-subs'
          ? `One or more imported episodes are missing ${job.preferences.subtitleLanguage} subtitles`
          : `One or more imported episodes are missing preferred audio (${failed.audioLanguages.join(', ') || 'unknown audio'})`,
    };
  }

  return {
    outcome: 'success',
    preferredReleaser: job.selectedReleaser,
    progress: 100,
    queueStatus: 'Imported',
    liveDownloadId: null,
    liveQueueId: null,
    reasonCode: 'validated',
    summary: `Validated ${importedTargetEpisodes.length} targeted episode${importedTargetEpisodes.length === 1 ? '' : 's'}`,
  };
}
