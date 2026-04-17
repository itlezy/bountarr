import type { PreferredLanguage } from '$lib/shared/languages';
export type { CardViewMode } from '$lib/shared/card-views';
export type { ThemeMode } from '$lib/shared/themes';

export type SearchKind = 'all' | 'movie' | 'series';
export type SearchAvailability = 'all' | 'available-only' | 'not-available-only';
export type SearchSortField = 'title' | 'year' | 'popularity' | 'rating';
export type SearchSortDirection = 'asc' | 'desc';
export type MediaKind = 'movie' | 'series';
export type AuditStatus = 'pending' | 'verified' | 'missing-language' | 'no-subs' | 'unknown';
export type AppView = 'search' | 'queue' | 'dashboard' | 'status' | 'settings';
export type AcquisitionStatus =
  | 'queued'
  | 'searching'
  | 'grabbing'
  | 'validating'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type AcquisitionReasonCode =
  | 'validated'
  | 'missing-audio'
  | 'missing-subs'
  | 'import-timeout'
  | 'no-release-available'
  | 'no-acceptable-release'
  | 'manual-selection-lost'
  | 'cancelled'
  | 'crashed';

export interface Preferences {
  cardsView: import('$lib/shared/card-views').CardViewMode;
  preferredLanguage: PreferredLanguage;
  subtitleLanguage: PreferredLanguage;
  theme: import('$lib/shared/themes').ThemeMode;
}

export interface QualityProfileOption {
  id: number;
  name: string;
  isDefault: boolean;
}

export interface RuntimeVolume {
  driveLetter: string | null;
  mountPoint: string;
  label: string | null;
  fileSystem: string | null;
  freeSpaceBytes: number | null;
  totalSpaceBytes: number | null;
}

export interface RuntimeHealth {
  checkedAt: string;
  healthy: boolean;
  issues: string[];
  warnings: string[];
  logFilePath: string;
  logLevel: string;
  dataPath: string;
  storagePath: string;
  freeSpaceBytes: number | null;
  totalSpaceBytes: number | null;
  databasePath: string;
  databaseSizeBytes: number | null;
  databaseJobCount: number | null;
  databaseAttemptCount: number | null;
  databaseEventCount: number | null;
  uptimeSeconds: number;
  nodeVersion: string;
  hostName: string;
  platform: string;
  arch: string;
  processId: number;
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  systemTotalMemoryBytes: number;
  systemFreeMemoryBytes: number;
  volumes: RuntimeVolume[];
}

export interface ArrServiceStats {
  qualityProfileCount: number;
  rootFolderCount: number;
  queueCount: number | null;
  defaultQualityProfileName: string | null;
  primaryRootFolderPath: string | null;
}

export interface PlexServiceStats {
  libraryCount: number;
  movieLibraryCount: number;
  showLibraryCount: number;
  libraryTitles: string[];
}

export interface ConfigStatus {
  radarrConfigured: boolean;
  sonarrConfigured: boolean;
  plexConfigured: boolean;
  configured: boolean;
  radarrQualityProfiles: QualityProfileOption[];
  sonarrQualityProfiles: QualityProfileOption[];
  defaultRadarrQualityProfileId: number | null;
  defaultSonarrQualityProfileId: number | null;
  radarrStats: ArrServiceStats;
  sonarrStats: ArrServiceStats;
  plexStats: PlexServiceStats;
  runtime: RuntimeHealth;
}

export interface HealthResponse {
  checkedAt: string;
  status: 'ok' | 'degraded';
  configured: boolean;
  services: {
    radarr: boolean;
    sonarr: boolean;
    plex: boolean;
  };
  runtime: RuntimeHealth;
}

export type ResultOrigin = 'arr' | 'plex' | 'merged';

export interface MediaItem {
  id: string;
  arrItemId?: number | null;
  kind: MediaKind;
  title: string;
  year: number | null;
  rating: number | null;
  poster: string | null;
  overview: string;
  status: string;
  isExisting: boolean;
  isRequested: boolean;
  auditStatus: AuditStatus;
  audioLanguages: string[];
  subtitleLanguages: string[];
  sourceService: 'radarr' | 'sonarr' | 'plex';
  origin: ResultOrigin;
  inArr: boolean;
  inPlex: boolean;
  plexLibraries: string[];
  canAdd: boolean;
  canDeleteFromArr?: boolean;
  detail: string | null;
  requestPayload: Record<string, unknown> | null;
}

export type ArrDeleteTarget =
  | {
      deleteMode: 'library';
      id: string;
      arrItemId: number;
      kind: MediaKind;
      sourceService: 'radarr' | 'sonarr';
      title: string;
    }
  | {
      deleteMode: 'queue-entry';
      id: string;
      kind: MediaKind;
      queueId: number;
      sourceService: 'radarr' | 'sonarr';
      title: string;
    };

export interface ReleaseDecisionCandidate {
  title: string;
  guid: string;
  indexer: string;
  indexerId: number;
  protocol: string;
  size: number;
  languages: string[];
  score: number;
  reason: string;
}

export type ReleaseIdentityStatus = 'exact-match' | 'weak-match' | 'mismatch';
export type ReleaseScopeStatus = 'not-applicable' | 'exact' | 'partial' | 'mismatch' | 'unknown';

export type ManualReleaseStatus =
  | 'selected'
  | 'accepted'
  | 'locally-rejected'
  | 'arr-rejected'
  | 'previously-failed';

export interface ManualReleaseResult extends ReleaseDecisionCandidate {
  canSelect: boolean;
  downloadAllowed: boolean;
  identityReason: string;
  identityStatus: ReleaseIdentityStatus;
  scopeReason: string | null;
  scopeStatus: ReleaseScopeStatus;
  selectionBlockedReason: string | null;
  rejectedByArr: boolean;
  rejectionReasons: string[];
  status: ManualReleaseStatus;
}

export interface ReleaseDecision {
  considered: number;
  accepted: number;
  selected: ReleaseDecisionCandidate | null;
  reason: string;
}

export interface ManualReleaseListResponse {
  jobId: string;
  releases: ManualReleaseResult[];
  selectedGuid: string | null;
  summary: string;
  updatedAt: string;
}

export interface AcquisitionAttempt {
  attempt: number;
  status: AcquisitionStatus;
  reasonCode: AcquisitionReasonCode | null;
  releaseTitle: string | null;
  releaser: string | null;
  reason: string | null;
  submittedGuid?: string | null;
  submittedIndexerId?: number | null;
  submissionClaimedAt?: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AcquisitionJob {
  id: string;
  itemId: string;
  arrItemId: number;
  kind: MediaKind;
  title: string;
  sourceService: 'radarr' | 'sonarr';
  status: AcquisitionStatus;
  attempt: number;
  maxRetries: number;
  currentRelease: string | null;
  selectedReleaser: string | null;
  preferredReleaser: string | null;
  reasonCode: AcquisitionReasonCode | null;
  failureReason: string | null;
  validationSummary: string | null;
  autoRetrying: boolean;
  progress: number | null;
  queueStatus: string | null;
  preferences: Pick<Preferences, 'preferredLanguage' | 'subtitleLanguage'>;
  targetSeasonNumbers: number[] | null;
  targetEpisodeIds: number[] | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  attempts: AcquisitionAttempt[];
}

export interface DashboardSummary {
  total: number;
  verified: number;
  pending: number;
  attention: number;
}

export interface DashboardResponse {
  updatedAt: string;
  items: MediaItem[];
  summary: DashboardSummary;
}

export interface GrabResponse {
  existing: boolean;
  item: MediaItem;
  message: string;
  releaseDecision: ReleaseDecision | null;
  job: AcquisitionJob | null;
}

export interface SearchState {
  activeView: AppView;
  query: string;
  kind: SearchKind;
  availability: SearchAvailability;
  sortField: SearchSortField;
  sortDirection: SearchSortDirection;
}

export interface QueueItem {
  id: string;
  downloadId?: string | null;
  arrItemId: number | null;
  canCancel: boolean;
  kind: MediaKind;
  title: string;
  year: number | null;
  poster: string | null;
  sourceService: 'radarr' | 'sonarr';
  status: string;
  progress: number | null;
  timeLeft: string | null;
  estimatedCompletionTime: string | null;
  size: number | null;
  sizeLeft: number | null;
  queueId: number | null;
  detail: string | null;
  episodeIds: number[] | null;
  seasonNumbers: number[] | null;
}

export interface ManagedQueueLiveSummary {
  rowCount: number;
  progress: number | null;
  status: string | null;
  timeLeft: string | null;
  estimatedCompletionTime: string | null;
  size: number | null;
  sizeLeft: number | null;
  byteMetricsPartial: boolean;
}

export interface ManagedQueueEntry {
  kind: 'managed';
  id: string;
  job: AcquisitionJob;
  liveQueueItems: QueueItem[];
  liveSummary: ManagedQueueLiveSummary | null;
  canCancel: boolean;
  canRemove: boolean;
}

export interface ExternalQueueEntry {
  kind: 'external';
  id: string;
  item: QueueItem;
  canCancel: boolean;
  canRemove: boolean;
}

export type QueueEntry = ManagedQueueEntry | ExternalQueueEntry;

export interface QueueResponse {
  updatedAt: string;
  entries: QueueEntry[];
  total: number;
}

export type QueueCancelRequest =
  | {
      kind: 'managed';
      jobId: string;
    }
  | {
      kind: 'external';
      id: string;
      arrItemId: number | null;
      queueId: number;
      sourceService: 'radarr' | 'sonarr';
      title: string;
    };

export interface AcquisitionResponse {
  updatedAt: string;
  jobs: AcquisitionJob[];
}

export interface AcquisitionJobActionResponse {
  job: AcquisitionJob;
  message: string;
}

export interface QueueActionResponse {
  itemId: string;
  message: string;
}

export interface MediaItemActionResponse {
  itemId: string;
  message: string;
}
