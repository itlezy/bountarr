import { jobStatusLabel } from '$lib/server/acquisition-domain';
import {
  fetchHistoryRecords,
  fetchQueueRecords,
  findQueueRecordForArrItem,
  historySince,
  type ValidationProbe,
} from '$lib/server/acquisition-validator-shared';
import { normalizeItem, normalizeLanguageEntries } from '$lib/server/media-normalize';
import { normalizeQueueItem } from '$lib/server/queue-normalize';
import { asNumber, asRecord } from '$lib/server/raw';
import { fetchEpisodeFile } from '$lib/server/lookup-service';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import { defaultPreferences } from '$lib/shared/preferences';

export async function validateSeriesAttempt(
  job: PersistedAcquisitionJob,
  attemptStart: string,
): Promise<ValidationProbe> {
  const [queueRecords, historyRecords] = await Promise.all([
    fetchQueueRecords('sonarr'),
    fetchHistoryRecords('sonarr', job.arrItemId),
  ]);
  const queueRecord = findQueueRecordForArrItem(queueRecords, 'sonarr', job.arrItemId);
  const queueItem = queueRecord ? normalizeQueueItem('sonarr', queueRecord) : null;
  const relevantHistory = historySince(historyRecords, attemptStart, job.currentRelease);
  const episodeFileIds = Array.from(
    new Set(
      relevantHistory
        .map(
          (record) =>
            asNumber(record.episodeFileId) ?? asNumber(asRecord(record.data).episodeFileId),
        )
        .filter((value): value is number => value !== null && value > 0),
    ),
  );

  if (episodeFileIds.length === 0) {
    if (queueItem) {
      return {
        outcome: 'pending',
        preferredReleaser: null,
        progress: queueItem?.progress ?? null,
        queueStatus: queueItem?.status ?? jobStatusLabel(job.status),
        reasonCode: null,
        summary: null,
      };
    }

    return {
      outcome: 'pending',
      preferredReleaser: null,
      progress: job.progress,
      queueStatus: job.queueStatus,
      reasonCode: null,
      summary: null,
    };
  }

  const validations = await Promise.all(
    episodeFileIds.map(async (episodeFileId) => {
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
      progress: queueItem?.progress ?? job.progress,
      queueStatus: queueItem?.status ?? job.queueStatus,
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
    reasonCode: 'validated',
    summary: `Validated ${episodeFileIds.length} imported episode${episodeFileIds.length === 1 ? '' : 's'}`,
  };
}
