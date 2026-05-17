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
  ReleaseArrOverrideMode,
  ReleaseAutoBlockedReason,
  ReleaseAutoDecision,
  ReleaseIdentityStatus,
  ReleaseScopeStatus,
  ReleaseYearMatch,
  SearchKind,
} from '$lib/shared/types';
import { acquisitionNextAction, acquisitionReasonLabel } from '$lib/shared/acquisition-reasons';

export type AuditEvidenceRow = {
  label: string;
  value: string;
};

export const viewOptions: Array<{ value: AppView; label: string }> = [
  { value: 'search', label: 'Search' },
  { value: 'queue', label: 'Queue' },
  { value: 'dashboard', label: 'Download checks' },
  { value: 'status', label: 'System status' },
  { value: 'settings', label: 'Settings' },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export const statusTone: Record<AuditStatus, string> = {
  pending:
    'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100',
  verified:
    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
  'missing-language':
    'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200',
  'no-subs':
    'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  'not-found':
    'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200',
  'not-released':
    'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200',
  'release-blocked':
    'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-200',
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
    case 'not-found':
      return 'No release found';
    case 'not-released':
      return 'Not released yet';
    case 'release-blocked':
      return 'Needs manual review';
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
    return item.inArr ? 'Grab Again' : 'Grab';
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

export function auditAcquisitionJobId(item: MediaItem): string | null {
  return asString(asRecord(item.requestPayload).acquisitionJobId);
}

export function auditManualReleaseJobId(item: MediaItem): string | null {
  return item.auditStatus === 'release-blocked' ? auditAcquisitionJobId(item) : null;
}

export function auditEvidenceRows(item: MediaItem): AuditEvidenceRow[] {
  const payload = asRecord(item.requestPayload);
  const rows: AuditEvidenceRow[] = [];
  const jobId = asString(payload.acquisitionJobId);
  const status = asString(payload.acquisitionJobStatus) ?? asString(payload.status);
  const release = asString(payload.acquisitionRelease) ?? asString(payload.currentRelease);
  const reasonCode = asString(payload.reasonCode);
  const reason = reasonCode
    ? (acquisitionReasonLabel(reasonCode as AcquisitionJob['reasonCode']) ?? reasonCode)
    : null;

  if (jobId) {
    rows.push({ label: 'Grab job', value: jobId });
  }

  if (status) {
    rows.push({ label: 'Grab status', value: status });
  }

  if (release) {
    rows.push({ label: 'Release', value: release });
  }

  if (reason) {
    rows.push({ label: 'Reason', value: reason });
  }

  return rows;
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
  if (attempt.detectedAudioLanguages?.length) {
    parts.push(`audio ${attempt.detectedAudioLanguages.join(', ')}`);
  }
  if (attempt.detectedSubtitleLanguages?.length) {
    parts.push(`subtitles ${attempt.detectedSubtitleLanguages.join(', ')}`);
  }

  return parts.join(' · ');
}

export function acquisitionJourneySummary(job: AcquisitionJob): string {
  return `${mediaKindLabel(job.kind)} grab · ${acquisitionStatusLabel(job.status)}`;
}

export function acquisitionRecoverySummary(job: AcquisitionJob): string | null {
  switch (job.recoveryStatus) {
    case 'queued':
      return 'Initial release restore queued';
    case 'grabbing':
      return 'Restoring initial release';
    case 'restored':
      return 'Initial release restored';
    case 'failed':
      return 'Initial release recovery failed';
    default:
      return null;
  }
}

export function queueItemSummary(item: QueueItem): string {
  return `${mediaKindLabel(item.kind)} download · ${item.status}`;
}

export function queueItemNextStep(item: QueueItem): string {
  const blockedOrCompleted =
    (item.progress !== null && item.progress >= 100) ||
    item.status.toLowerCase().includes('warning') ||
    item.status.toLowerCase().includes('blocked');

  if (item.statusDetail && blockedOrCompleted) {
    return item.statusDetail;
  }

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

export function releaseAutoDecisionLabel(status: ReleaseAutoDecision | null | undefined): string {
  switch (status) {
    case 'auto-selected':
      return 'Auto selected';
    case 'blocked':
      return 'Blocked';
    case 'reviewable':
      return 'Manual review';
    default:
      return 'Not recorded';
  }
}

export function releaseAutoBlockedReasonLabel(
  reason: ReleaseAutoBlockedReason | null | undefined,
): string {
  switch (reason) {
    case 'adjacent-year-superseded':
      return 'Exact-year candidate available';
    case 'arr-rejected':
      return 'Arr rejected';
    case 'local-rules':
      return 'Local rules';
    case 'scope-mismatch':
      return 'Scope mismatch';
    case 'title-mismatch':
      return 'Title mismatch';
    case 'year-mismatch':
      return 'Year mismatch';
    case 'year-unknown':
      return 'Release year missing';
    default:
      return 'None';
  }
}

export function releaseArrOverrideModeLabel(
  mode: ReleaseArrOverrideMode | null | undefined,
): string {
  switch (mode) {
    case 'exact-year':
      return 'Exact-year override';
    case 'adjacent-year':
      return 'Adjacent-year fallback';
    default:
      return 'No override';
  }
}

export function releaseIdentityStatusLabel(
  status: ReleaseIdentityStatus | null | undefined,
): string {
  switch (status) {
    case 'exact-match':
      return 'Exact title';
    case 'weak-match':
      return 'Weak title';
    case 'mismatch':
      return 'Title mismatch';
    default:
      return 'Not recorded';
  }
}

export function releaseScopeStatusLabel(status: ReleaseScopeStatus | null | undefined): string {
  switch (status) {
    case 'exact':
      return 'Exact scope';
    case 'partial':
      return 'Partial scope';
    case 'mismatch':
      return 'Scope mismatch';
    case 'unknown':
      return 'Scope not detected';
    case 'not-applicable':
      return 'Not applicable';
    default:
      return 'Not recorded';
  }
}

export function releaseYearMatchLabel(status: ReleaseYearMatch | null | undefined): string {
  switch (status) {
    case 'exact':
      return 'Exact year';
    case 'adjacent':
      return 'Adjacent year';
    case 'mismatch':
      return 'Year mismatch';
    case 'unknown':
      return 'Year not detected';
    case 'not-applicable':
      return 'Not applicable';
    default:
      return 'Not recorded';
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
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

export function formatBitrateKbps(kbps: number | null | undefined): string | null {
  if (kbps === null || kbps === undefined || !Number.isFinite(kbps) || kbps <= 0) {
    return null;
  }

  if (kbps >= 1000) {
    return `${(kbps / 1000).toFixed(2)} Mbps`;
  }

  return `${Math.round(kbps)} Kbps`;
}

export function formatRuntimeSeconds(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h`;
  }

  return `${minutes}m`;
}

export function mediaDetailRows(
  details: MediaItem['mediaDetails'] | null | undefined,
): AuditEvidenceRow[] {
  if (!details) {
    return [];
  }

  return [
    details.resolution ? { label: 'Resolution', value: details.resolution } : null,
    details.bitrate ? { label: 'Bitrate', value: formatBitrateKbps(details.bitrate) } : null,
    details.videoCodec ? { label: 'Video', value: details.videoCodec } : null,
    details.audioCodec ? { label: 'Audio codec', value: details.audioCodec } : null,
    details.runtimeSeconds
      ? { label: 'Runtime', value: formatRuntimeSeconds(details.runtimeSeconds) }
      : null,
    details.fileSizeBytes ? { label: 'Size', value: formatBytes(details.fileSizeBytes) } : null,
  ].filter((row): row is AuditEvidenceRow => row !== null && row.value !== null);
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
    mediaDetails: next.mediaDetails ?? existing.mediaDetails ?? null,
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
    result.job.releaseCandidates?.length
      ? `${result.job.releaseCandidates.filter((candidate) => candidate.status === 'failed').length} failed releases`
      : `attempt ${result.job.attempt}`,
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
    case 'not-found':
      return 'No matching release was available from the configured grab sources.';
    case 'not-released':
      return 'Radarr says this movie is not released yet, so Bountarr is waiting instead of searching daily.';
    case 'release-blocked':
      return 'Release options are available but need manual review before grabbing.';
    case 'unknown':
      return 'The app could not read enough media details to confirm this item yet.';
    default:
      return 'The app is still checking this download.';
  }
}

export function downloadedSummary(item: Pick<QueueItem, 'size' | 'sizeLeft'>): string {
  if (item.size === null || item.sizeLeft === null) {
    return 'Unknown';
  }

  const downloadedGb = Math.max(0, (item.size - item.sizeLeft) / 1024 / 1024 / 1024);
  const totalGb = item.size / 1024 / 1024 / 1024;
  return `${downloadedGb.toFixed(2)} GB / ${totalGb.toFixed(2)} GB`;
}
