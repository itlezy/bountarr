export type SearchKind = 'all' | 'movie' | 'series';
export type MediaKind = 'movie' | 'series';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AuditStatus = 'pending' | 'verified' | 'missing-language' | 'no-subs' | 'unknown';

export interface Preferences {
  preferredLanguage: string;
  requireSubtitles: boolean;
  theme: ThemeMode;
}

export interface ConfigStatus {
  radarrConfigured: boolean;
  sonarrConfigured: boolean;
  plexConfigured: boolean;
  configured: boolean;
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
}
