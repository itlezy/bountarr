import { jobStatusLabel } from '$lib/server/acquisition-domain';
import {
  fetchHistoryRecords,
  fetchQueueRecords,
  historySince,
  type ValidationProbe,
  validationSummary,
} from '$lib/server/acquisition-validator-shared';
import { normalizeQueueItem } from '$lib/server/queue-normalize';
import { asNumber, asRecord } from '$lib/server/raw';
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
  const queueRecord =
    queueRecords.find((record) => asNumber(asRecord(record.movie).id) === job.arrItemId) ?? null;
  const relevantHistory = historySince(historyRecords, attemptStart, job.currentRelease);

  if (relevantHistory.length === 0) {
    if (queueRecord) {
      const queueItem = normalizeQueueItem('radarr', queueRecord);
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
    progress: queueRecord
      ? (normalizeQueueItem('radarr', queueRecord)?.progress ?? null)
      : job.progress,
    queueStatus: queueRecord
      ? (normalizeQueueItem('radarr', queueRecord)?.status ?? job.queueStatus)
      : job.queueStatus,
    reasonCode: null,
    summary,
  };
}
