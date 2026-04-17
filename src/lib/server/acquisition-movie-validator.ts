import { jobStatusLabel } from '$lib/server/acquisition-domain';
import {
  fetchHistoryRecords,
  fetchQueueRecords,
  findQueueRecordsForArrItem,
  historySince,
  type ValidationProbe,
  validationSummary,
} from '$lib/server/acquisition-validator-shared';
import { buildManagedLiveSummary } from '$lib/server/queue-live-summary';
import { normalizeQueueItem } from '$lib/server/queue-normalize';
import { fetchExistingMovie } from '$lib/server/lookup-service';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import { defaultPreferences } from '$lib/shared/preferences';
import type { QueueItem } from '$lib/shared/types';

export async function validateMovieAttempt(
  job: PersistedAcquisitionJob,
  attemptStart: string,
): Promise<ValidationProbe> {
  const [queueRecords, historyRecords] = await Promise.all([
    fetchQueueRecords('radarr'),
    fetchHistoryRecords('radarr', job.arrItemId),
  ]);
  const queueItems = findQueueRecordsForArrItem(queueRecords, 'radarr', job.arrItemId)
    .map((record) => normalizeQueueItem('radarr', record))
    .filter((item): item is QueueItem => item !== null);
  const liveSummary = buildManagedLiveSummary(queueItems);
  const relevantHistory = historySince(historyRecords, attemptStart, job.currentRelease);

  if (relevantHistory.length === 0) {
    if (liveSummary) {
      return {
        outcome: 'pending',
        preferredReleaser: null,
        progress: liveSummary.progress,
        queueStatus: liveSummary.status ?? jobStatusLabel(job.status),
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
    progress: liveSummary?.progress ?? job.progress,
    queueStatus: liveSummary?.status ?? job.queueStatus,
    reasonCode: null,
    summary,
  };
}
