import {
  cancelAcquisitionJob,
  cancelQueueItem,
  deleteArrItem,
  fetchManualReleaseResults,
  fetchDashboard,
  fetchQueue,
  fetchRecentPlexItems,
  fetchSearchResults,
  refreshDashboard,
  selectManualRelease,
  submitRequest,
} from '$lib/client/api';
import {
  canOperatorRequestFromPlex,
  defaultQualityProfileId,
  kindLabel,
  mergeSearchItem,
  operatorOverrideItem,
  qualityProfileOptions,
  requestFeedbackMessage,
} from '$lib/client/app-ui';
import {
  ensureNotificationPermission,
  notifyAuditFailures,
  pushNotification,
} from '$lib/client/notifications';
import {
  applyTheme,
  loadPreferences,
  loadSearchState,
  savePreferences,
  saveSearchState,
} from '$lib/client/storage';
import { defaultPreferences } from '$lib/shared/preferences';
import type {
  AcquisitionJob,
  ArrDeleteTarget,
  AppView,
  CardViewMode,
  ConfigStatus,
  DashboardResponse,
  ManualReleaseListResponse,
  MediaItem,
  Preferences,
  QualityProfileOption,
  QueueItem,
  QueueResponse,
  SearchKind,
  SearchAvailability,
  SearchSortDirection,
  SearchSortField,
  SearchState,
  ThemeMode,
} from '$lib/shared/types';
import type { PreferredLanguage } from '$lib/shared/languages';

type AppStateApi = {
  cancelAcquisitionJob: typeof cancelAcquisitionJob;
  cancelQueueItem: typeof cancelQueueItem;
  deleteArrItem: typeof deleteArrItem;
  fetchManualReleaseResults: typeof fetchManualReleaseResults;
  fetchDashboard: typeof fetchDashboard;
  refreshDashboard: typeof refreshDashboard;
  fetchRecentPlexItems: typeof fetchRecentPlexItems;
  fetchSearchResults: typeof fetchSearchResults;
  fetchQueue: typeof fetchQueue;
  selectManualRelease: typeof selectManualRelease;
  submitRequest: typeof submitRequest;
};

type AppStateStorage = {
  applyTheme: typeof applyTheme;
  loadPreferences: typeof loadPreferences;
  loadSearchState: typeof loadSearchState;
  savePreferences: typeof savePreferences;
  saveSearchState: typeof saveSearchState;
};

type AppStateNotifications = {
  ensureNotificationPermission: typeof ensureNotificationPermission;
  notifyAuditFailures: typeof notifyAuditFailures;
  pushNotification: typeof pushNotification;
};

type AppStateTimers = {
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
};

type AppStateConfirm = (message: string) => boolean;

export type AppStateDependencies = {
  api: AppStateApi;
  storage: AppStateStorage;
  notifications: AppStateNotifications;
  timers: AppStateTimers;
  confirm: AppStateConfirm;
};

const defaultDependencies: AppStateDependencies = {
  api: {
    cancelAcquisitionJob,
    cancelQueueItem,
    deleteArrItem,
    fetchManualReleaseResults,
    fetchDashboard,
    refreshDashboard,
    fetchRecentPlexItems,
    fetchSearchResults,
    fetchQueue,
    selectManualRelease,
    submitRequest,
  },
  storage: {
    applyTheme,
    loadPreferences,
    loadSearchState,
    savePreferences,
    saveSearchState,
  },
  notifications: {
    ensureNotificationPermission,
    notifyAuditFailures,
    pushNotification,
  },
  timers: {
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  },
  confirm: (message: string) => globalThis.confirm?.(message) ?? false,
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractPopularity(item: MediaItem): number {
  const payload = asRecord(item.requestPayload);
  return (
    asNumber(payload.popularity) ??
    asNumber(asRecord(payload.ratings).value) ??
    asNumber(asRecord(asRecord(payload.ratings).tmdb).value) ??
    asNumber(asRecord(asRecord(payload.ratings).imdb).value) ??
    0
  );
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left - right;
}

function compareNullableNumbersByDirection(
  left: number | null,
  right: number | null,
  direction: SearchSortDirection,
): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return direction === 'asc' ? left - right : right - left;
}

function sortSearchItems(
  items: MediaItem[],
  sortField: SearchSortField,
  sortDirection: SearchSortDirection,
): MediaItem[] {
  return [...items].sort((left, right) => {
    let comparison = 0;

    if (sortField === 'title') {
      comparison = left.title.localeCompare(right.title, undefined, {
        sensitivity: 'base',
        numeric: true,
      });
      if (sortDirection === 'desc') {
        comparison *= -1;
      }
    } else if (sortField === 'year') {
      comparison = compareNullableNumbersByDirection(left.year, right.year, sortDirection);
    } else if (sortField === 'rating') {
      comparison = compareNullableNumbersByDirection(left.rating, right.rating, sortDirection);
    } else {
      comparison = compareNullableNumbersByDirection(
        extractPopularity(left),
        extractPopularity(right),
        sortDirection,
      );
    }

    if (comparison !== 0) {
      return comparison;
    }

    const titleComparison = left.title.localeCompare(right.title, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
    if (titleComparison !== 0) {
      return titleComparison;
    }

    return compareNullableNumbers(left.year, right.year);
  });
}

export type PageData = {
  config: ConfigStatus;
  recentPlex: MediaItem[];
};

export class AppState {
  readonly dependencies: AppStateDependencies;
  readonly readData: () => PageData;
  private searchRequestSequence = 0;
  private latestSearchRequest = 0;
  private searchDebounceHandle: ReturnType<typeof globalThis.setTimeout> | null = null;
  private addSuccessToastHandle: ReturnType<typeof globalThis.setTimeout> | null = null;

  initialized = $state(false);
  activeView = $state<AppView>('search');
  query = $state('');
  kind = $state<SearchKind>('all');
  availability = $state<SearchAvailability>('not-available-only');
  sortField = $state<SearchSortField>('popularity');
  sortDirection = $state<SearchSortDirection>('desc');
  preferredLanguage = $state(defaultPreferences.preferredLanguage);
  subtitleLanguage = $state(defaultPreferences.subtitleLanguage);
  cardsView = $state<CardViewMode>(defaultPreferences.cardsView);
  theme = $state<ThemeMode>(defaultPreferences.theme);
  searchResults = $state<MediaItem[]>([]);
  recentPlexOverride = $state<MediaItem[] | null>(null);
  dashboard = $state<DashboardResponse | null>(null);
  queue = $state<QueueResponse | null>(null);
  searchError = $state<string | null>(null);
  recentPlexError = $state<string | null>(null);
  dashboardError = $state<string | null>(null);
  queueError = $state<string | null>(null);
  manualReleaseError = $state<Record<string, string | null>>({});
  manualReleaseLists = $state<Record<string, ManualReleaseListResponse | null>>({});
  manualReleaseOpen = $state<Record<string, boolean>>({});
  manualSelectionError = $state<Record<string, string | null>>({});
  requestError = $state<string | null>(null);
  deleteError = $state<string | null>(null);
  latestActionMessage = $state<string | null>(null);
  addSuccessToastMessage = $state<string | null>(null);
  requestFeedback = $state<Record<string, string>>({});
  searchLoading = $state(false);
  recentPlexLoading = $state(false);
  dashboardLoading = $state(false);
  queueLoading = $state(false);
  manualReleaseLoading = $state<Record<string, boolean>>({});
  requesting = $state<string | null>(null);
  deletingItemId = $state<string | null>(null);
  cancelingAcquisitionJobId = $state<string | null>(null);
  cancelingQueueItemId = $state<string | null>(null);
  manualSelectingJobId = $state<string | null>(null);
  notificationState = $state<NotificationPermission | 'unsupported' | 'idle'>('idle');
  kindMenuOpen = $state(false);
  confirmAddItem = $state<MediaItem | null>(null);
  confirmOperatorOverride = $state(false);
  confirmQualityProfileId = $state<number | null>(null);
  confirmPreferredLanguage = $state<PreferredLanguage>(defaultPreferences.preferredLanguage);
  confirmSubtitleLanguage = $state<PreferredLanguage>(defaultPreferences.subtitleLanguage);
  operatorReveals = $state<Record<string, boolean>>({});
  guidedQueueJobId = $state<string | null>(null);
  guidedQueueTitle = $state<string | null>(null);

  constructor(
    dataSource: PageData | (() => PageData),
    dependencies: AppStateDependencies = defaultDependencies,
  ) {
    this.readData = typeof dataSource === 'function' ? dataSource : () => dataSource;
    this.dependencies = dependencies;
  }

  get data(): PageData {
    return this.readData();
  }

  get config(): ConfigStatus {
    return this.data.config;
  }

  get preferences(): Preferences {
    return {
      cardsView: this.cardsView,
      preferredLanguage: this.preferredLanguage,
      subtitleLanguage: this.subtitleLanguage,
      theme: this.theme,
    };
  }

  get recentPlexItems(): MediaItem[] {
    return this.recentPlexOverride ?? this.data.recentPlex;
  }

  get currentKindLabel(): string {
    return kindLabel(this.kind);
  }

  get visibleSearchResults(): MediaItem[] {
    return sortSearchItems(this.searchResults, this.sortField, this.sortDirection);
  }

  get auditAttentionItems(): MediaItem[] {
    return [...(this.dashboard?.items ?? [])]
      .filter((item) => item.auditStatus !== 'verified')
      .sort((left, right) =>
        left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }),
      );
  }

  get auditVerifiedItems(): MediaItem[] {
    return [...(this.dashboard?.items ?? [])]
      .filter((item) => item.auditStatus === 'verified')
      .sort((left, right) =>
        left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }),
      );
  }

  qualityProfileOptions(item: MediaItem | null): QualityProfileOption[] {
    return qualityProfileOptions(item, this.config);
  }

  defaultQualityProfileId(item: MediaItem | null): number | null {
    return defaultQualityProfileId(item, this.config);
  }

  closeMenus(): void {
    this.kindMenuOpen = false;
  }

  closeKindMenu(): void {
    this.kindMenuOpen = false;
  }

  manualReleaseList(jobId: string): ManualReleaseListResponse | null {
    return this.manualReleaseLists[jobId] ?? null;
  }

  manualReleaseListOpen(jobId: string): boolean {
    return this.manualReleaseOpen[jobId] === true;
  }

  async loadManualReleaseResults(jobId: string, force = false): Promise<void> {
    if (!force && this.manualReleaseLoading[jobId]) {
      return;
    }

    if (!force && this.manualReleaseLists[jobId]) {
      return;
    }

    this.manualReleaseLoading = {
      ...this.manualReleaseLoading,
      [jobId]: true,
    };
    this.manualReleaseError = {
      ...this.manualReleaseError,
      [jobId]: null,
    };

    try {
      const results = await this.dependencies.api.fetchManualReleaseResults(jobId);
      this.manualReleaseLists = {
        ...this.manualReleaseLists,
        [jobId]: results,
      };
    } catch (error) {
      this.manualReleaseError = {
        ...this.manualReleaseError,
        [jobId]: error instanceof Error ? error.message : 'Unable to load manual-search releases.',
      };
    } finally {
      this.manualReleaseLoading = {
        ...this.manualReleaseLoading,
        [jobId]: false,
      };
    }
  }

  async toggleManualReleaseList(jobId: string): Promise<void> {
    const nextOpen = !this.manualReleaseListOpen(jobId);
    this.manualReleaseOpen = {
      ...this.manualReleaseOpen,
      [jobId]: nextOpen,
    };

    if (nextOpen) {
      await this.loadManualReleaseResults(jobId);
    }
  }

  private clearPendingSearchDebounce(): void {
    if (this.searchDebounceHandle !== null) {
      this.dependencies.timers.clearTimeout(this.searchDebounceHandle);
      this.searchDebounceHandle = null;
    }
  }

  private clearAddSuccessToastTimer(): void {
    if (this.addSuccessToastHandle !== null) {
      this.dependencies.timers.clearTimeout(this.addSuccessToastHandle);
      this.addSuccessToastHandle = null;
    }
  }

  private showAddSuccessToast(message: string): void {
    this.clearAddSuccessToastTimer();
    this.addSuccessToastMessage = message;
    this.addSuccessToastHandle = this.dependencies.timers.setTimeout(() => {
      this.addSuccessToastHandle = null;
      this.addSuccessToastMessage = null;
    }, 3_000);
  }

  toggleKindMenu(): void {
    this.kindMenuOpen = !this.kindMenuOpen;
  }

  setActiveView(view: AppView): void {
    this.activeView = view;
    this.kindMenuOpen = false;
  }

  private operatorRevealKey(scope: 'search' | 'queue' | 'audit' | 'job', id: string): string {
    return `${scope}:${id}`;
  }

  operatorRevealOpen(scope: 'search' | 'queue' | 'audit' | 'job', id: string): boolean {
    return this.operatorReveals[this.operatorRevealKey(scope, id)] === true;
  }

  toggleOperatorReveal(scope: 'search' | 'queue' | 'audit' | 'job', id: string): void {
    const key = this.operatorRevealKey(scope, id);
    this.operatorReveals = {
      ...this.operatorReveals,
      [key]: !this.operatorRevealOpen(scope, id),
    };
  }

  canOperatorRequestFromPlex(item: MediaItem): boolean {
    return canOperatorRequestFromPlex(item);
  }

  hasSearchOperatorActions(item: MediaItem): boolean {
    return this.canOperatorRequestFromPlex(item) || item.canDeleteFromArr === true;
  }

  hasQueueOperatorActions(item: QueueItem): boolean {
    return item.arrItemId !== null || item.queueId !== null;
  }

  hasAuditOperatorActions(item: MediaItem): boolean {
    return item.canDeleteFromArr === true;
  }

  isGuidedQueueJob(jobId: string): boolean {
    return this.guidedQueueJobId === jobId;
  }

  get queueGuidanceMessage(): string | null {
    if (!this.guidedQueueTitle) {
      return null;
    }

    return `Tracking ${this.guidedQueueTitle} below so you can see what happens next.`;
  }

  openAddConfirm(item: MediaItem, options?: { operatorOverride?: boolean }): void {
    const requestItem =
      options?.operatorOverride && this.canOperatorRequestFromPlex(item)
        ? operatorOverrideItem(item)
        : item;

    if (!requestItem.canAdd) {
      return;
    }

    this.confirmAddItem = requestItem;
    this.confirmOperatorOverride = options?.operatorOverride === true;
    this.confirmQualityProfileId = this.defaultQualityProfileId(requestItem);
    this.confirmPreferredLanguage = this.preferredLanguage;
    this.confirmSubtitleLanguage = this.subtitleLanguage;
    this.requestError = null;
    this.closeMenus();
  }

  closeAddConfirm(): void {
    if (this.confirmAddItem && this.requesting === this.confirmAddItem.id) {
      return;
    }

    this.resetAddConfirm();
  }

  resetAddConfirm(): void {
    this.confirmAddItem = null;
    this.confirmOperatorOverride = false;
    this.confirmQualityProfileId = null;
    this.confirmPreferredLanguage = this.preferredLanguage;
    this.confirmSubtitleLanguage = this.subtitleLanguage;
  }

  async loadDashboard(force = false): Promise<void> {
    if (!this.config.configured) {
      return;
    }

    this.dashboardLoading = true;
    this.dashboardError = null;

    try {
      this.dashboard = force
        ? await this.dependencies.api.refreshDashboard({
            preferredLanguage: this.preferredLanguage,
            subtitleLanguage: this.subtitleLanguage,
          })
        : await this.dependencies.api.fetchDashboard({
            preferredLanguage: this.preferredLanguage,
            subtitleLanguage: this.subtitleLanguage,
          });
      this.dependencies.notifications.notifyAuditFailures(this.dashboard.items);
    } catch (error) {
      this.dashboardError =
        error instanceof Error ? error.message : 'Unable to load the dashboard.';
    } finally {
      this.dashboardLoading = false;
    }
  }

  async loadRecentPlex(): Promise<void> {
    if (!this.config.plexConfigured) {
      this.recentPlexOverride = [];
      this.recentPlexError = null;
      return;
    }

    this.recentPlexLoading = true;
    this.recentPlexError = null;

    try {
      this.recentPlexOverride = await this.dependencies.api.fetchRecentPlexItems();
    } catch (error) {
      this.recentPlexError =
        error instanceof Error ? error.message : 'Unable to load Plex recent items.';
    } finally {
      this.recentPlexLoading = false;
    }
  }

  async loadSearch(
    searchTerm: string,
    searchKind: SearchKind,
    searchAvailability: SearchAvailability,
  ): Promise<void> {
    if (searchTerm.trim().length < 2) {
      this.latestSearchRequest = ++this.searchRequestSequence;
      this.searchResults = [];
      this.searchError = null;
      this.searchLoading = false;
      return;
    }

    const requestId = ++this.searchRequestSequence;
    this.latestSearchRequest = requestId;
    this.searchLoading = true;
    this.searchError = null;

    try {
      const results = await this.dependencies.api.fetchSearchResults(
        searchTerm,
        searchKind,
        searchAvailability,
      );

      if (requestId !== this.latestSearchRequest) {
        return;
      }

      this.searchResults = results;
    } catch (error) {
      if (requestId !== this.latestSearchRequest) {
        return;
      }

      this.searchError = error instanceof Error ? error.message : 'Search failed.';
    } finally {
      if (requestId === this.latestSearchRequest) {
        this.searchLoading = false;
      }
    }
  }

  async runSearchNow(): Promise<void> {
    this.clearPendingSearchDebounce();
    this.closeMenus();
    await this.loadSearch(this.query, this.kind, this.availability);
  }

  async loadQueue(): Promise<void> {
    if (!this.config.configured) {
      this.queue = null;
      this.queueError = null;
      return;
    }

    this.queueLoading = true;
    this.queueError = null;

    try {
      this.queue = await this.dependencies.api.fetchQueue();
    } catch (error) {
      this.queueError = error instanceof Error ? error.message : 'Unable to load the queue.';
    } finally {
      this.queueLoading = false;
    }
  }

  async selectManualRelease(jobId: string, guid: string, indexerId: number): Promise<void> {
    this.manualSelectingJobId = jobId;
    this.manualSelectionError = {
      ...this.manualSelectionError,
      [jobId]: null,
    };
    this.latestActionMessage = null;

    try {
      const result = await this.dependencies.api.selectManualRelease(jobId, guid, indexerId);
      this.latestActionMessage = result.message;
      this.manualReleaseOpen = {
        ...this.manualReleaseOpen,
        [jobId]: true,
      };
      await Promise.all([
        this.loadManualReleaseResults(jobId, true),
        this.loadQueue(),
        this.loadDashboard(true),
      ]);
    } catch (error) {
      this.manualSelectionError = {
        ...this.manualSelectionError,
        [jobId]: error instanceof Error ? error.message : 'Unable to select the requested release.',
      };
    } finally {
      this.manualSelectingJobId = null;
    }
  }

  async cancelAcquisitionJob(jobId: string): Promise<void> {
    this.cancelingAcquisitionJobId = jobId;
    this.manualSelectionError = {
      ...this.manualSelectionError,
      [jobId]: null,
    };
    this.latestActionMessage = null;

    try {
      const result = await this.dependencies.api.cancelAcquisitionJob(jobId);
      this.latestActionMessage = result.message;
      await Promise.all([this.loadQueue(), this.loadDashboard(true)]);
    } catch (error) {
      this.manualSelectionError = {
        ...this.manualSelectionError,
        [jobId]: error instanceof Error ? error.message : 'Unable to cancel the selected download.',
      };
    } finally {
      this.cancelingAcquisitionJobId = null;
    }
  }

  async cancelQueueItem(item: QueueItem): Promise<void> {
    this.cancelingQueueItemId = item.id;
    this.queueError = null;
    this.latestActionMessage = null;

    try {
      const result = await this.dependencies.api.cancelQueueItem(item);
      this.latestActionMessage = result.message;
      await Promise.all([this.loadQueue(), this.loadDashboard(true)]);
    } catch (error) {
      this.queueError =
        error instanceof Error ? error.message : 'Unable to cancel the selected download.';
    } finally {
      this.cancelingQueueItemId = null;
    }
  }

  async deleteArrItem(item: ArrDeleteTarget): Promise<void> {
    const serviceName = item.sourceService === 'radarr' ? 'Radarr' : 'Sonarr';
    if (
      !this.dependencies.confirm(`Delete ${item.title} from ${serviceName} and remove its files?`)
    ) {
      return;
    }

    this.deletingItemId = item.id;
    this.deleteError = null;
    this.latestActionMessage = null;

    try {
      const result = await this.dependencies.api.deleteArrItem(item);
      this.latestActionMessage = result.message;
      await Promise.all([
        this.loadDashboard(true),
        this.loadQueue(),
        this.query.trim().length >= 2
          ? this.loadSearch(this.query, this.kind, this.availability)
          : Promise.resolve(),
      ]);
    } catch (error) {
      this.deleteError =
        error instanceof Error ? error.message : 'Unable to delete the selected Arr item.';
    } finally {
      this.deletingItemId = null;
    }
  }

  async deleteMediaItem(item: MediaItem): Promise<void> {
    if (!item.canDeleteFromArr || item.arrItemId == null || item.sourceService === 'plex') {
      return;
    }

    await this.deleteArrItem({
      arrItemId: item.arrItemId,
      id: item.id,
      kind: item.kind,
      sourceService: item.sourceService,
      title: item.title,
    });
  }

  async deleteQueueArrItem(item: QueueItem): Promise<void> {
    if (item.arrItemId == null && item.queueId == null) {
      return;
    }

    await this.deleteArrItem({
      arrItemId: item.arrItemId,
      id: item.id,
      kind: item.kind,
      queueId: item.queueId,
      sourceService: item.sourceService,
      title: item.title,
    });
  }

  async deleteAcquisitionJob(job: AcquisitionJob): Promise<void> {
    await this.deleteArrItem({
      arrItemId: job.arrItemId,
      id: job.id,
      kind: job.kind,
      sourceService: job.sourceService,
      title: job.title,
    });
  }

  submitRequest(item: MediaItem, qualityProfileId?: number | null): Promise<void>;
  submitRequest(
    item: MediaItem,
    qualityProfileId: number | null | undefined,
    preferencesOverride: Preferences,
  ): Promise<void>;
  async submitRequest(
    item: MediaItem,
    qualityProfileId?: number | null,
    preferencesOverride?: Preferences,
  ): Promise<void> {
    if (!item.canAdd) {
      return;
    }

    const requestPreferences = preferencesOverride ?? {
      cardsView: this.cardsView,
      preferredLanguage: this.preferredLanguage,
      subtitleLanguage: this.subtitleLanguage,
      theme: this.theme,
    };
    this.requesting = item.id;
    this.requestError = null;
    this.latestActionMessage = null;

    try {
      const result = await this.dependencies.api.submitRequest(
        item,
        requestPreferences,
        qualityProfileId,
      );

      this.preferredLanguage = requestPreferences.preferredLanguage;
      this.subtitleLanguage = requestPreferences.subtitleLanguage;
      this.dependencies.storage.savePreferences(this.preferences);
      this.showAddSuccessToast(result.message);
      this.latestActionMessage = result.job
        ? `Request sent. ${result.item.title} is now in Queue.`
        : result.message;
      this.requestFeedback = {
        ...this.requestFeedback,
        [item.id]: requestFeedbackMessage(result),
      };
      this.dependencies.notifications.pushNotification('Bountarr', result.message);
      this.searchResults = this.searchResults.map((candidate) =>
        candidate.id === item.id ? mergeSearchItem(candidate, result.item) : candidate,
      );
      this.resetAddConfirm();
      this.guidedQueueJobId = result.job?.id ?? null;
      this.guidedQueueTitle = result.item.title;
      this.activeView = 'queue';
      await Promise.all([this.loadDashboard(true), this.loadQueue()]);
    } catch (error) {
      this.requestError = error instanceof Error ? error.message : 'Add failed.';
      this.dependencies.notifications.pushNotification('Bountarr add failed', this.requestError);
    } finally {
      this.requesting = null;
    }
  }

  async enableNotifications(): Promise<void> {
    this.notificationState = await this.dependencies.notifications.ensureNotificationPermission();
  }

  mount(): () => void {
    const searchState = this.dependencies.storage.loadSearchState();
    const preferences = this.dependencies.storage.loadPreferences();

    this.activeView = searchState.activeView;
    this.query = searchState.query;
    this.kind = searchState.kind;
    this.availability = searchState.availability;
    this.sortField = searchState.sortField;
    this.sortDirection = searchState.sortDirection;
    this.preferredLanguage = preferences.preferredLanguage;
    this.subtitleLanguage = preferences.subtitleLanguage;
    this.cardsView = preferences.cardsView;
    this.theme = preferences.theme;
    this.dependencies.storage.applyTheme(this.theme, this.cardsView);
    this.initialized = true;

    if (this.config.plexConfigured && this.data.recentPlex.length === 0) {
      void this.loadRecentPlex();
    }

    void this.loadDashboard();
    void this.loadQueue();

    const dashboardInterval = this.dependencies.timers.setInterval(() => {
      void this.loadDashboard();
    }, 5 * 60_000);
    const queueInterval = this.dependencies.timers.setInterval(() => {
      void this.loadQueue();
    }, 15_000);

    return () => {
      this.dependencies.timers.clearInterval(dashboardInterval);
      this.dependencies.timers.clearInterval(queueInterval);
    };
  }

  handlePreferencesChanged(): void {
    if (!this.initialized) {
      return;
    }

    this.dependencies.storage.savePreferences(this.preferences);
    this.dependencies.storage.applyTheme(this.theme, this.cardsView);
    void this.loadDashboard();
  }

  handleSearchStateChanged(): void {
    if (!this.initialized) {
      return;
    }

    const nextState: SearchState = {
      activeView: this.activeView,
      query: this.query,
      kind: this.kind,
      availability: this.availability,
      sortField: this.sortField,
      sortDirection: this.sortDirection,
    };

    this.dependencies.storage.saveSearchState(nextState);
  }

  handleSearchInputChanged(): (() => void) | undefined {
    if (!this.initialized) {
      return;
    }

    const currentQuery = this.query;
    const currentKind = this.kind;
    const currentAvailability = this.availability;

    this.clearPendingSearchDebounce();

    const handle = this.dependencies.timers.setTimeout(() => {
      this.searchDebounceHandle = null;
      void this.loadSearch(currentQuery, currentKind, currentAvailability);
    }, 250);
    this.searchDebounceHandle = handle;

    return () => {
      if (this.searchDebounceHandle === handle) {
        this.clearPendingSearchDebounce();
        return;
      }

      this.dependencies.timers.clearTimeout(handle);
    };
  }
}
