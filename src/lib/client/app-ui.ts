import type {
  AcquisitionAttempt,
  AcquisitionJob,
  AppView,
  AuditStatus,
  ConfigStatus,
  GrabResponse,
  ManualReleaseResult,
  MediaItem,
  QualityProfileOption,
  QueueItem,
  SearchKind,
} from '$lib/shared/types';
import { acquisitionNextAction, acquisitionReasonLabel } from '$lib/shared/acquisition-reasons';

export const viewOptions: Array<{ value: AppView; label: string }> = [
  { value: 'search', label: 'Search' },
  { value: 'queue', label: 'Queue' },
  { value: 'dashboard', label: 'Download checks' },
  { value: 'status', label: 'System status' },
  { value: 'settings', label: 'Settings' },
];

export const statusTone: Record<AuditStatus, string> = {
  pending:
    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100',
  verified:
    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
  'missing-language':
    'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200',
  'no-subs':
    'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  unknown:
    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100',
};

export function auditLabel(status: AuditStatus): string {
  switch (status) {
    case 'verified':
      return 'Looks good';
    case 'missing-language':
      return 'Missing audio';
    case 'no-subs':
      return 'Missing subtitles';
    case 'unknown':
      return 'Unknown';
    default:
      return 'Checking';
  }
}

export function actionLabel(item: MediaItem, grabbingId: string | null): string {
  if (grabbingId === item.id) {
    return 'Grabbing...';
  }

  if (canStartGrabFlow(item)) {
    return 'Grab';
  }

  if (item.inArr) {
    return 'Already Grabbed';
  }

  if (item.inPlex) {
    return 'Available now';
  }

  return 'Unavailable';
}

export function actionDisabled(item: MediaItem, grabbingId: string | null): boolean {
  return grabbingId === item.id || !canStartGrabFlow(item);
}

export function deleteActionLabel(item: MediaItem, deletingId: string | null): string {
  if (deletingId === item.id) {
    return 'Removing...';
  }

  return 'Remove from Library';
}

export function mediaKindLabel(kind: MediaItem['kind']): string {
  return kind === 'movie' ? 'Movie' : 'Show';
}

export function resultState(item: MediaItem): string {
  if (item.inArr && item.inPlex) {
    return 'Already Grabbed and available now';
  }

  if (item.inArr) {
    return 'Already Grabbed';
  }

  if (item.inPlex) {
    return 'Available in Plex';
  }

  return 'Ready to Grab';
}

export function resultSummary(item: MediaItem): string {
  return `${mediaKindLabel(item.kind)} · ${resultState(item)}`;
}

export function resultMessage(item: MediaItem): string {
  if (item.inArr && item.inPlex) {
    return 'This title is already in your grab system and already available in Plex.';
  }

  if (item.inArr) {
    return 'This title is already being tracked in your grab system.';
  }

  if (item.inPlex) {
    return 'This title is already available in Plex.';
  }

  return 'This title can be grabbed now.';
}

// Already-available or already-tracked results still use the managed grab flow, but the user must
// explicitly confirm that they want an alternate release.
export function canGrabWithConfirmation(item: MediaItem): boolean {
  if (item.requestPayload === null) {
    return false;
  }

  if (item.inArr) {
    return item.sourceService !== 'plex';
  }

  return item.inPlex && item.origin === 'merged';
}

// Pure Plex results need one extra resolve step before the normal grab dialog can open.
export function canResolveGrabCandidate(item: MediaItem): boolean {
  return item.sourceService === 'plex' && item.requestPayload !== null;
}

export function canStartGrabFlow(item: MediaItem): boolean {
  return item.canAdd || canGrabWithConfirmation(item) || canResolveGrabCandidate(item);
}

export function confirmedGrabItem(item: MediaItem): MediaItem {
  return {
    ...item,
    canAdd: true,
    sourceService: item.kind === 'movie' ? 'radarr' : 'sonarr',
    origin: 'arr',
  };
}

export function formatRating(rating: number | null): string | null {
  if (rating === null || !Number.isFinite(rating)) {
    return null;
  }

  return rating.toFixed(1);
}

export function viewLabel(view: AppView): string {
  switch (view) {
    case 'queue':
      return 'Queue';
    case 'dashboard':
      return 'Download checks';
    case 'status':
      return 'System status';
    case 'settings':
      return 'Settings';
    default:
      return 'Search';
  }
}

export function kindLabel(kind: SearchKind): string {
  switch (kind) {
    case 'movie':
      return 'Movies';
    case 'series':
      return 'Shows';
    default:
      return 'All';
  }
}

export function qualityProfileOptions(
  item: MediaItem | null,
  config: ConfigStatus,
): QualityProfileOption[] {
  if (!item) {
    return [];
  }

  return item.kind === 'movie' ? config.radarrQualityProfiles : config.sonarrQualityProfiles;
}

export function defaultQualityProfileId(
  item: MediaItem | null,
  config: ConfigStatus,
): number | null {
  if (!item) {
    return null;
  }

  return item.kind === 'movie'
    ? config.defaultRadarrQualityProfileId
    : config.defaultSonarrQualityProfileId;
}

export function acquisitionStatusLabel(status: AcquisitionJob['status']): string {
  switch (status) {
    case 'cancelled':
      return '🛑 Stopped';
    case 'grabbing':
      return '📤 Sending to downloader';
    case 'retrying':
      return '🔁 Trying another option';
    case 'searching':
      return '🔎 Looking for a release';
    case 'queued':
      return '⏳ Getting started';
    case 'validating':
      return '🧪 Checking the download';
    case 'completed':
      return '✅ Ready';
    case 'failed':
      return '⚠️ Needs attention';
    default:
      return '⚙️ Working';
  }
}

export function acquisitionReasonSummary(job: AcquisitionJob): string | null {
  return acquisitionReasonLabel(job.reasonCode) ?? job.failureReason ?? job.validationSummary;
}

export function acquisitionNextStep(job: AcquisitionJob): string | null {
  return acquisitionNextAction(job);
}

export function acquisitionAttemptSummary(attempt: AcquisitionAttempt): string {
  const parts = [acquisitionStatusLabel(attempt.status)];
  const reason = acquisitionReasonLabel(attempt.reasonCode) ?? attempt.reason;
  if (reason) {
    parts.push(reason);
  }

  return parts.join(' · ');
}

export function acquisitionJourneySummary(job: AcquisitionJob): string {
  return `${mediaKindLabel(job.kind)} grab · ${acquisitionStatusLabel(job.status)}`;
}

export function queueItemSummary(item: QueueItem): string {
  return `${mediaKindLabel(item.kind)} download · ${item.status}`;
}

export function queueItemNextStep(item: QueueItem): string {
  if (item.progress !== null && item.progress >= 100) {
    return 'Waiting for import to finish.';
  }

  if (item.timeLeft) {
    return `About ${item.timeLeft} left.`;
  }

  if (item.estimatedCompletionTime) {
    return `Expected around ${new Date(item.estimatedCompletionTime).toLocaleTimeString()}.`;
  }

  return 'Download progress is updating.';
}

export function queueEtaLabel(
  item: Pick<QueueItem, 'timeLeft' | 'estimatedCompletionTime'>,
): string | null {
  if (item.timeLeft) {
    return `${item.timeLeft} remaining`;
  }

  if (item.estimatedCompletionTime) {
    return `Expected around ${new Date(item.estimatedCompletionTime).toLocaleTimeString()}.`;
  }

  return null;
}

export function manualReleaseStatusLabel(status: ManualReleaseResult['status']): string {
  switch (status) {
    case 'selected':
      return 'Selected';
    case 'accepted':
      return 'Accepted';
    case 'locally-rejected':
      return 'Locally rejected';
    case 'arr-rejected':
      return 'Arr rejected';
    default:
      return 'Failed before';
  }
}

export function manualReleaseStatusTone(status: ManualReleaseResult['status']): string {
  switch (status) {
    case 'selected':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200';
    case 'accepted':
      return 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200';
    case 'locally-rejected':
      return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200';
    case 'arr-rejected':
      return 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200';
    default:
      return 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 'Unknown';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

export function mergeSearchItem(existing: MediaItem, next: MediaItem): MediaItem {
  const inPlex = existing.inPlex || next.inPlex;
  const plexOverrideEligible = inPlex && !next.inArr && next.requestPayload !== null;

  return {
    ...existing,
    ...next,
    arrItemId: next.arrItemId ?? existing.arrItemId ?? null,
    inPlex,
    plexLibraries: Array.from(
      new Set([...(existing.plexLibraries ?? []), ...(next.plexLibraries ?? [])]),
    ),
    canAdd: plexOverrideEligible ? false : next.canAdd,
    canDeleteFromArr: next.canDeleteFromArr || existing.canDeleteFromArr,
    origin: inPlex ? 'merged' : next.origin,
  };
}

export function grabFeedbackMessage(result: GrabResponse): string {
  if (!result.job) {
    return result.releaseDecision?.reason ?? result.message;
  }

  const parts = [
    acquisitionStatusLabel(result.job.status),
    `attempt ${result.job.attempt}/${result.job.maxRetries}`,
  ];
  const summary = acquisitionReasonSummary(result.job);
  if (summary) {
    parts.push(summary);
  }

  return parts.join(' · ');
}

export function auditDetailSummary(item: MediaItem): string {
  switch (item.auditStatus) {
    case 'verified':
      return 'Audio and subtitle checks match your current preferences.';
    case 'missing-language':
      return 'The downloaded media is missing your preferred audio language.';
    case 'no-subs':
      return 'The downloaded media is missing the subtitle language you asked for.';
    case 'unknown':
      return 'The app could not read enough media details to confirm this item yet.';
    default:
      return 'The app is still checking this download.';
  }
}

export function downloadedSummary(item: QueueItem): string {
  if (item.size === null || item.sizeLeft === null) {
    return 'Unknown';
  }

  const downloadedGb = Math.max(0, (item.size - item.sizeLeft) / 1024 / 1024 / 1024);
  const totalGb = item.size / 1024 / 1024 / 1024;
  return `${downloadedGb.toFixed(2)} GB / ${totalGb.toFixed(2)} GB`;
}
