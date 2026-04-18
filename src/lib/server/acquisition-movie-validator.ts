import { jobStatusLabel } from '$lib/server/acquisition-domain';
import {
  bestQueueIdentityCandidate,
  queueItemMatchesManagedTarget,
} from '$lib/server/queue-matching';
import {
  fetchHistoryRecords,
  fetchQueueRecords,
  historySince,
  queueImportBlock,
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
  const matchingQueueEntries = queueRecords
    .map((record) => ({
      item: normalizeQueueItem('radarr', record),
      record,
    }))
    .filter(
      (entry): entry is { item: QueueItem; record: Record<string, unknown> } =>
        entry.item !== null && queueItemMatchesManagedTarget(job, entry.item),
    );
  const queueItems = matchingQueueEntries.map((entry) => entry.item);
  const liveSummary = buildManagedLiveSummary(queueItems);
  const claimedQueueItem = bestQueueIdentityCandidate(job, queueItems);
  const importBlock = matchingQueueEntries
    .map((entry) => queueImportBlock(entry.record))
    .find((entry) => entry !== null);
  const relevantHistory = historySince(historyRecords, attemptStart, job.currentRelease);

  if (relevantHistory.length === 0) {
    if (importBlock) {
      return {
        outcome: 'failure',
        preferredReleaser: null,
        progress: 100,
        queueStatus: importBlock.queueStatus,
        liveDownloadId: null,
        liveQueueId: null,
        reasonCode: importBlock.reasonCode,
        summary: importBlock.summary,
      };
    }

    if (liveSummary) {
      return {
        outcome: 'pending',
        preferredReleaser: null,
        progress: liveSummary.progress,
        queueStatus: liveSummary.status ?? jobStatusLabel(job.status),
        liveDownloadId: claimedQueueItem?.downloadId ?? null,
        liveQueueId: claimedQueueItem?.queueId ?? null,
        reasonCode: null,
        summary: null,
      };
    }

    return {
      outcome: 'pending',
      preferredReleaser: null,
      progress: job.progress,
      queueStatus: job.queueStatus,
      liveDownloadId: null,
      liveQueueId: null,
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
      liveDownloadId: null,
      liveQueueId: null,
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
      liveDownloadId: null,
      liveQueueId: null,
      reasonCode: item.auditStatus === 'no-subs' ? 'missing-subs' : 'missing-audio',
      summary,
    };
  }

  return {
    outcome: 'pending',
    preferredReleaser: null,
    progress: liveSummary?.progress ?? job.progress,
    queueStatus: liveSummary?.status ?? job.queueStatus,
    liveDownloadId: claimedQueueItem?.downloadId ?? null,
    liveQueueId: claimedQueueItem?.queueId ?? null,
    reasonCode: null,
    summary,
  };
}
