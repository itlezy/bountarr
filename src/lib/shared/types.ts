export type SearchKind = 'all' | 'movie' | 'series';
export type MediaKind = 'movie' | 'series';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AuditStatus = 'pending' | 'verified' | 'missing-language' | 'no-subs' | 'unknown';
export type AppView = 'search' | 'queue' | 'dashboard' | 'status' | 'settings';
export type AcquisitionStatus =
  | 'queued'
  | 'searching'
  | 'grabbing'
  | 'downloading'
  | 'import-check'
  | 'retrying'
  | 'completed'
  | 'failed';

export interface Preferences {
  preferredLanguage: string;
  requireSubtitles: boolean;
  theme: ThemeMode;
}

export interface QualityProfileOption {
  id: number;
  name: string;
  isDefault: boolean;
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
}

export type ResultOrigin = 'arr' | 'plex' | 'merged';

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  year: number | null;
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
  detail: string | null;
  requestPayload: Record<string, unknown> | null;
}

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

export interface ReleaseDecision {
  considered: number;
  accepted: number;
  selected: ReleaseDecisionCandidate | null;
  reason: string;
}

export interface AcquisitionAttempt {
  attempt: number;
  status: AcquisitionStatus;
  releaseTitle: string | null;
  releaser: string | null;
  reason: string | null;
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
  failureReason: string | null;
  validationSummary: string | null;
  progress: number | null;
  queueStatus: string | null;
  preferences: Pick<Preferences, 'preferredLanguage' | 'requireSubtitles'>;
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

export interface RequestResponse {
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
  includeAvailable: boolean;
}

export interface QueueItem {
  id: string;
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
  detail: string | null;
}

export interface QueueResponse {
  updatedAt: string;
  items: QueueItem[];
  acquisitionJobs: AcquisitionJob[];
  total: number;
}

export interface AcquisitionResponse {
  updatedAt: string;
  jobs: AcquisitionJob[];
}
