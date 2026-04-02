import type {
  AcquisitionJob,
  AppView,
  AuditStatus,
  ConfigStatus,
  ManualReleaseResult,
  MediaItem,
  QualityProfileOption,
  QueueItem,
  RequestResponse,
  SearchKind,
} from '$lib/shared/types';

export const viewOptions: Array<{ value: AppView; label: string }> = [
  { value: 'search', label: 'Search' },
  { value: 'queue', label: 'Queue' },
  { value: 'dashboard', label: 'Audit queue' },
  { value: 'status', label: 'Arr / Plex status' },
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
      return 'Verified';
    case 'missing-language':
      return 'Missing audio';
    case 'no-subs':
      return 'Missing subs';
    case 'unknown':
      return 'Unknown';
    default:
      return 'Pending';
  }
}

export function actionLabel(item: MediaItem, requestingId: string | null): string {
  if (requestingId === item.id) {
    return 'Adding...';
  }

  if (item.canAdd) {
    return 'Add to Arr';
  }

  if (item.inArr) {
    return 'Already in Arr';
  }

  if (item.inPlex) {
    return 'Only in Plex';
  }

  return 'Unavailable';
}

export function actionDisabled(item: MediaItem, requestingId: string | null): boolean {
  return requestingId === item.id || !item.canAdd;
}

export function deleteActionLabel(item: MediaItem, deletingId: string | null): string {
  if (deletingId === item.id) {
    return 'Deleting...';
  }

  return 'Delete from Arr';
}

export function resultState(item: MediaItem): string {
  if (item.inArr && item.inPlex) {
    return 'In Arr + Plex';
  }

  if (item.inArr) {
    return 'In Arr';
  }

  if (item.inPlex) {
    return 'In Plex only';
  }

  return 'Addable';
}

export function resultSummary(item: MediaItem): string {
  const source =
    item.kind === 'movie'
      ? item.sourceService === 'radarr'
        ? 'Radarr'
        : 'Plex'
      : item.sourceService === 'sonarr'
        ? 'Sonarr'
        : 'Plex';

  return `${item.kind} · ${resultState(item)} · ${source}`;
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
      return 'Audit queue';
    case 'status':
      return 'Service status';
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
      return 'Cancelled';
    case 'validating':
      return 'Validating';
    default:
      return status.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }
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
  return {
    ...existing,
    ...next,
    arrItemId: next.arrItemId ?? existing.arrItemId ?? null,
    inPlex: existing.inPlex || next.inPlex,
    plexLibraries: Array.from(
      new Set([...(existing.plexLibraries ?? []), ...(next.plexLibraries ?? [])]),
    ),
    canAdd: !(existing.inPlex || next.inPlex) && next.canAdd,
    canDeleteFromArr: next.canDeleteFromArr || existing.canDeleteFromArr,
    origin: existing.inPlex || next.inPlex ? 'merged' : next.origin,
  };
}

export function requestFeedbackMessage(result: RequestResponse): string {
  if (!result.job) {
    return result.releaseDecision?.reason ?? result.message;
  }

  return `${acquisitionStatusLabel(result.job.status)} · attempt ${result.job.attempt}/${result.job.maxRetries}${result.job.validationSummary ? ` · ${result.job.validationSummary}` : ''}`;
}

export function downloadedSummary(item: QueueItem): string {
  if (item.size === null || item.sizeLeft === null) {
    return 'Unknown';
  }

  const downloadedGb = Math.max(0, (item.size - item.sizeLeft) / 1024 / 1024 / 1024);
  const totalGb = item.size / 1024 / 1024 / 1024;
  return `${downloadedGb.toFixed(2)} GB / ${totalGb.toFixed(2)} GB`;
}
