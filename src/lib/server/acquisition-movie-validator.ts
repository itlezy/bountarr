import { jobStatusLabel } from '$lib/server/acquisition-domain';
import {
  fetchHistoryRecords,
  fetchQueueRecords,
  findQueueRecordForArrItem,
  historySince,
  type ValidationProbe,
  validationSummary,
} from '$lib/server/acquisition-validator-shared';
import { normalizeQueueItem } from '$lib/server/queue-normalize';
import { fetchExistingMovie } from '$lib/server/lookup-service';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import { defaultPreferences } from '$lib/shared/preferences';

export async function validateMovieAttempt(
  job: PersistedAcquisitionJob,
  attemptStart: string,
): Promise<ValidationProbe> {
  const [queueRecords, historyRecords] = await Promise.all([
    fetchQueueRecords('radarr'),
    fetchHistoryRecords('radarr', job.arrItemId),
  ]);
  const queueRecord = findQueueRecordForArrItem(queueRecords, 'radarr', job.arrItemId);
  const queueItem = queueRecord ? normalizeQueueItem('radarr', queueRecord) : null;
  const relevantHistory = historySince(historyRecords, attemptStart, job.currentRelease);

  if (relevantHistory.length === 0) {
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

  const item = await fetchExistingMovie(job.arrItemId, {
    cardsView: defaultPreferences.cardsView,
    preferredLanguage: job.preferences.preferredLanguage,
    subtitleLanguage: job.preferences.subtitleLanguage,
    theme: 'system',
  });
  const summary = validationSummary(item);

  if (item.auditStatus === 'verified') {
    return {
      outcome: 'success',
      preferredReleaser: job.selectedReleaser,
      progress: 100,
      queueStatus: 'Imported',
      reasonCode: 'validated',
      summary,
    };
  }

  if (item.auditStatus === 'missing-language' || item.auditStatus === 'no-subs') {
    return {
      outcome: 'failure',
      preferredReleaser: null,
      progress: 100,
      queueStatus: 'Imported',
      reasonCode: item.auditStatus === 'no-subs' ? 'missing-subs' : 'missing-audio',
      summary,
    };
  }

  return {
    outcome: 'pending',
    preferredReleaser: null,
    progress: queueItem?.progress ?? job.progress,
    queueStatus: queueItem?.status ?? job.queueStatus,
    reasonCode: null,
    summary,
  };
}
