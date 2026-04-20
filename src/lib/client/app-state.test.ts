import { describe, expect, it, vi } from 'vitest';
import { AppState } from '$lib/client/app-state.svelte';
import type { AppStateDependencies } from '$lib/client/app-state.svelte';
import type { PageData } from '$lib/client/app-state.svelte';
import { externalQueueEntryCapabilities } from '$lib/server/queue-entry-capabilities';
import { managedQueueEntryCapabilities } from '$lib/shared/queue-entry-capabilities';
import type {
  AcquisitionJob,
  DashboardResponse,
  ExternalQueueEntry,
  GrabResponse,
  ManagedQueueEntry,
  ManagedQueueLiveSummary,
  MediaItem,
  ManualReleaseListResponse,
  QueueEntry,
  QueueItem,
  QueueResponse,
} from '$lib/shared/types';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error?: unknown) => void;
};

const runtime = {
  checkedAt: '2026-04-02T10:00:00.000Z',
  healthy: true,
  issues: [],
  warnings: [],
  logFilePath: 'data/logs/backend.log',
  logLevel: 'info',
  dataPath: 'data',
  storagePath: 'C:\\prj\\p2p\\bountarr\\data',
  freeSpaceBytes: 512_000_000_000,
  totalSpaceBytes: 1_024_000_000_000,
  databasePath: 'C:\\prj\\p2p\\bountarr\\data\\acquisition.db',
  databaseSizeBytes: 2_097_152,
  databaseJobCount: 4,
  databaseAttemptCount: 6,
  databaseEventCount: 18,
  uptimeSeconds: 12_345,
  nodeVersion: 'v24.9.0',
  hostName: 'bountarr-box',
  platform: 'win32',
  arch: 'x64',
  processId: 4242,
  rssBytes: 96_000_000,
  heapTotalBytes: 48_000_000,
  heapUsedBytes: 26_000_000,
  systemTotalMemoryBytes: 34_359_738_368,
  systemFreeMemoryBytes: 12_884_901_888,
  volumes: [
    {
      driveLetter: 'C:',
      mountPoint: 'C:\\',
      label: 'SYSC',
      fileSystem: 'NTFS',
      freeSpaceBytes: 512_000_000_000,
      totalSpaceBytes: 1_024_000_000_000,
    },
    {
      driveLetter: null,
      mountPoint: 'C:\\M\\Archive\\',
      label: 'Archive',
      fileSystem: 'NTFS',
      freeSpaceBytes: 4_487_500_000_000,
      totalSpaceBytes: 18_627_000_000_000,
    },
  ],
};

const pageData: PageData = {
  config: {
    radarrConfigured: true,
    sonarrConfigured: true,
    plexConfigured: true,
    configured: true,
    radarrQualityProfiles: [{ id: 7, name: 'HD-1080p', isDefault: true }],
    sonarrQualityProfiles: [{ id: 11, name: 'Series-HD', isDefault: true }],
    defaultRadarrQualityProfileId: 7,
    defaultSonarrQualityProfileId: 11,
    radarrStats: {
      qualityProfileCount: 1,
      rootFolderCount: 2,
      queueCount: 3,
      defaultQualityProfileName: 'HD-1080p',
      primaryRootFolderPath: 'C:\\Media\\Movies',
    },
    sonarrStats: {
      qualityProfileCount: 1,
      rootFolderCount: 1,
      queueCount: 5,
      defaultQualityProfileName: 'Series-HD',
      primaryRootFolderPath: 'C:\\Media\\Shows',
    },
    plexStats: {
      libraryCount: 3,
      movieLibraryCount: 2,
      showLibraryCount: 1,
      libraryTitles: ['Movies', 'Shows', '4K Remux Archive'],
    },
    runtime,
  },
  recentPlex: [],
};

const movieItem: MediaItem = {
  id: 'movie:603',
  kind: 'movie',
  title: 'The Matrix',
  year: 1999,
  rating: 8.7,
  poster: null,
  overview: 'Sci-fi',
  status: 'Ready to add',
  isExisting: false,
  isRequested: false,
  auditStatus: 'pending',
  audioLanguages: [],
  subtitleLanguages: [],
  sourceService: 'radarr',
  origin: 'arr',
  inArr: false,
  inPlex: false,
  plexLibraries: [],
  canAdd: true,
  detail: null,
  requestPayload: { tmdbId: 603 },
};

const seriesItem: MediaItem = {
  id: 'series:1399',
  kind: 'series',
  title: 'Game of Thrones',
  year: 2011,
  rating: 9.2,
  poster: null,
  overview: 'Fantasy',
  status: 'Ready to add',
  isExisting: false,
  isRequested: false,
  auditStatus: 'pending',
  audioLanguages: [],
  subtitleLanguages: [],
  sourceService: 'sonarr',
  origin: 'arr',
  inArr: false,
  inPlex: false,
  plexLibraries: [],
  canAdd: true,
  detail: null,
  requestPayload: {
    tvdbId: 121361,
    seasons: [
      { seasonNumber: 0, monitored: false },
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: false },
    ],
  },
};

const queueResponse: QueueResponse = {
  updatedAt: '2026-04-02T10:05:00.000Z',
  entries: [],
  total: 0,
};

const acquisitionJob: AcquisitionJob = {
  id: 'job-1',
  itemId: movieItem.id,
  arrItemId: 603,
  kind: 'movie',
  title: movieItem.title,
  sourceService: 'radarr',
  status: 'queued',
  attempt: 1,
  maxRetries: 4,
  currentRelease: null,
  selectedReleaser: null,
  preferredReleaser: 'flux',
  reasonCode: null,
  failureReason: null,
  validationSummary: null,
  autoRetrying: false,
  progress: null,
  queueStatus: 'Queued',
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'English',
  },
  targetSeasonNumbers: null,
  targetEpisodeIds: null,
  startedAt: '2026-04-02T10:05:00.000Z',
  updatedAt: '2026-04-02T10:05:00.000Z',
  completedAt: null,
  attempts: [],
};

const manualReleaseResponse: ManualReleaseListResponse = {
  jobId: 'job-1',
  releases: [
    {
      title: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      guid: 'guid-1',
      indexer: 'Indexer',
      indexerId: 11,
      protocol: 'torrent',
      size: 4_000_000_000,
      languages: ['English'],
      score: 160,
      reason: 'matched proven releaser',
      canSelect: true,
      selectionMode: 'direct',
      blockReason: null,
      identityStatus: 'exact-match',
      scopeStatus: 'not-applicable',
      explanation: {
        summary: 'matched proven releaser',
        matchReasons: ['Structured movie title matched The Matrix'],
        warningReasons: [],
        arrReasons: [],
      },
      status: 'accepted',
    },
  ],
  selectedGuid: null,
  summary: 'One manual-search release is available.',
  updatedAt: '2026-04-02T10:05:00.000Z',
};

const dashboardResponse: DashboardResponse = {
  updatedAt: '2026-04-02T10:05:00.000Z',
  items: [],
  summary: {
    total: 0,
    verified: 0,
    pending: 0,
    attention: 0,
  },
};

function buildManagedLiveSummary(items: QueueItem[]): ManagedQueueLiveSummary | null {
  if (items.length === 0) {
    return null;
  }

  return {
    rowCount: items.length,
    progress:
      items.reduce((sum, item) => sum + (item.progress ?? 0), 0) /
      Math.max(1, items.filter((item) => item.progress !== null).length),
    status: items.length === 1 ? items[0]?.status ?? null : `${items.length} live downloads active`,
    timeLeft: items.find((item) => item.timeLeft)?.timeLeft ?? null,
    estimatedCompletionTime:
      items.find((item) => item.estimatedCompletionTime)?.estimatedCompletionTime ?? null,
    size:
      items.every((item) => item.size !== null)
        ? items.reduce((sum, item) => sum + (item.size ?? 0), 0)
        : null,
    sizeLeft:
      items.every((item) => item.sizeLeft !== null)
        ? items.reduce((sum, item) => sum + (item.sizeLeft ?? 0), 0)
        : null,
    byteMetricsPartial:
      items.some((item) => item.size === null) || items.some((item) => item.sizeLeft === null),
  };
}

function buildManagedEntry(
  job: AcquisitionJob = acquisitionJob,
  liveQueueItems: QueueItem[] = [],
): ManagedQueueEntry {
  const capabilities = managedQueueEntryCapabilities(job, liveQueueItems);
  return {
    kind: 'managed',
    id: job.id,
    job,
    liveQueueItems,
    liveSummary: buildManagedLiveSummary(liveQueueItems),
    canCancel: capabilities.canCancel,
    canRemove: capabilities.canRemove,
  };
}

function buildExternalEntry(item: QueueItem): ExternalQueueEntry {
  const capabilities = externalQueueEntryCapabilities(item);
  return {
    kind: 'external',
    id: item.id,
    item,
    canCancel: capabilities.canCancel,
    canRemove: capabilities.canRemove,
  };
}

function buildQueue(entries: QueueEntry[]): QueueResponse {
  return {
    updatedAt: '2026-04-02T10:05:00.000Z',
    entries,
    total: entries.length,
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createDependencies(
  overrides: {
    api?: Partial<AppStateDependencies['api']>;
    storage?: Partial<AppStateDependencies['storage']>;
    notifications?: Partial<AppStateDependencies['notifications']>;
    timers?: Partial<AppStateDependencies['timers']>;
  } = {},
): AppStateDependencies {
  return {
    api: {
      cancelQueueEntry: vi.fn(),
      deleteArrItem: vi.fn(),
      fetchManualReleaseResults: vi.fn().mockResolvedValue({
        jobId: 'job-1',
        releases: [],
        selectedGuid: null,
        summary: 'No manual-search releases were returned by Arr',
        updatedAt: '2026-04-02T10:05:00.000Z',
      } satisfies ManualReleaseListResponse),
      fetchDashboard: vi.fn().mockResolvedValue(dashboardResponse),
      refreshDashboard: vi.fn().mockResolvedValue(dashboardResponse),
      fetchRecentPlexItems: vi.fn().mockResolvedValue([]),
      resolveGrabCandidate: vi.fn().mockResolvedValue(null),
      fetchSearchResults: vi.fn().mockResolvedValue([movieItem]),
      fetchQueue: vi.fn().mockResolvedValue(queueResponse),
      selectManualRelease: vi.fn(),
      submitGrab: vi.fn(),
      ...overrides.api,
    },
    storage: {
      applyTheme: vi.fn(),
      loadPreferences: vi.fn().mockReturnValue({
        cardsView: 'rounded',
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
        theme: 'system',
      }),
      loadSearchState: vi.fn().mockReturnValue({
        activeView: 'search',
        query: '',
        kind: 'all',
        availability: 'not-available-only',
        sortField: 'popularity',
        sortDirection: 'desc',
      }),
      savePreferences: vi.fn(),
      saveSearchState: vi.fn(),
      ...overrides.storage,
    },
    notifications: {
      ensureNotificationPermission: vi.fn().mockResolvedValue('granted'),
      notifyAuditFailures: vi.fn(),
      pushNotification: vi.fn(),
      ...overrides.notifications,
    },
    timers: {
      setInterval: vi.fn().mockReturnValue(1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      setTimeout: vi.fn().mockImplementation((handler: TimerHandler) => {
        if (typeof handler === 'function') {
          handler();
        }

        return 1 as unknown as ReturnType<typeof globalThis.setTimeout>;
      }) as unknown as typeof globalThis.setTimeout,
      clearTimeout: vi.fn() as unknown as typeof globalThis.clearTimeout,
      ...overrides.timers,
    },
    confirm: vi.fn().mockReturnValue(true),
  };
}

describe('app state', () => {
  it('uses the env-configured default quality profile when opening add confirm', () => {
    const state = new AppState(pageData, createDependencies());

    state.openAddConfirm(movieItem);

    expect(state.confirmAddItem).toEqual(movieItem);
    expect(state.confirmQualityProfileId).toBe(7);
  });

  it('defaults series add confirmation to the first season only', () => {
    const state = new AppState(pageData, createDependencies());

    state.openAddConfirm(seriesItem);

    expect(state.confirmAddItem).toEqual(seriesItem);
    expect(state.confirmQualityProfileId).toBe(11);
    expect(state.confirmSeasonOptions).toEqual([0, 1, 2]);
    expect(state.confirmSeasonNumbers).toEqual([1]);
    expect(state.confirmCanSubmit).toBe(true);
  });

  it('uses the tracked item quality profile for alternate-release series grabs', () => {
    const state = new AppState(pageData, createDependencies());
    const trackedSeriesItem = {
      ...seriesItem,
      inArr: true,
      canAdd: false,
      requestPayload: {
        ...seriesItem.requestPayload,
        qualityProfileId: 2,
      },
      sourceService: 'sonarr',
    } satisfies MediaItem;

    state.openAddConfirm(trackedSeriesItem);

    expect(state.confirmAddItem).not.toBeNull();
    expect(state.confirmQualityProfileId).toBe(2);
  });

  it('clears selected seasons when the add confirmation resets', () => {
    const state = new AppState(pageData, createDependencies());

    state.openAddConfirm(seriesItem);
    state.toggleConfirmSeason(2);
    state.resetAddConfirm();

    expect(state.confirmAddItem).toBeNull();
    expect(state.confirmSeasonNumbers).toEqual([]);
  });

  it('updates the queue view and request feedback after a successful add', async () => {
    const grabResponse: GrabResponse = {
      existing: false,
      item: {
        ...movieItem,
        inArr: true,
        canAdd: false,
        status: 'Already in Arr',
      },
      message: '"The Matrix" was added to Radarr. Acquisition started.',
      releaseDecision: null,
      job: {
        id: 'job-1',
        itemId: movieItem.id,
        arrItemId: 603,
        kind: 'movie',
        title: movieItem.title,
        sourceService: 'radarr',
        status: 'queued',
        attempt: 1,
        maxRetries: 4,
        currentRelease: null,
        selectedReleaser: null,
        preferredReleaser: null,
        reasonCode: null,
        failureReason: null,
        validationSummary: null,
        autoRetrying: false,
        progress: null,
        queueStatus: 'Queued',
        preferences: {
          preferredLanguage: 'English',
          subtitleLanguage: 'English',
        },
        targetSeasonNumbers: null,
        targetEpisodeIds: null,
        startedAt: '2026-04-02T10:05:00.000Z',
        updatedAt: '2026-04-02T10:05:00.000Z',
        completedAt: null,
        attempts: [],
      },
    };
    const dependencies = createDependencies({
      api: {
        submitGrab: vi.fn().mockResolvedValue(grabResponse),
      },
      timers: {
        setTimeout: vi.fn().mockReturnValue(99) as unknown as typeof globalThis.setTimeout,
        clearTimeout: vi.fn() as unknown as typeof globalThis.clearTimeout,
      },
    });
    const state = new AppState(pageData, dependencies);
    state.searchResults = [movieItem];
    state.openAddConfirm(movieItem);

    await state.submitGrab(movieItem, state.confirmQualityProfileId);

    expect(state.activeView).toBe('queue');
    expect(state.latestActionMessage).toBeNull();
    expect(state.addSuccessToastMessage).toBe(grabResponse.message);
    expect(state.grabFeedback[movieItem.id]).toContain('Getting started');
    expect(state.searchResults[0]?.inArr).toBe(true);
    expect(state.confirmAddItem).toBeNull();
    expect(state.guidedQueueJobId).toBe('job-1');
    expect(state.queueGuidanceMessage).toContain('The Matrix');
    expect(dependencies.api.fetchQueue).toHaveBeenCalledTimes(1);
    expect(dependencies.api.refreshDashboard).toHaveBeenCalledTimes(1);
  });

  it('closes the add dialog immediately after request success without waiting for refreshes', async () => {
    const queueRefresh = createDeferred<QueueResponse>();
    const dashboardRefresh = createDeferred<DashboardResponse>();
    const grabResponse: GrabResponse = {
      existing: false,
      item: {
        ...movieItem,
        inArr: true,
        canAdd: false,
        status: 'Already in Arr',
      },
      message: '"The Matrix" was added to Radarr.',
      releaseDecision: null,
      job: {
        id: 'job-1',
        itemId: movieItem.id,
        arrItemId: 603,
        kind: 'movie',
        title: movieItem.title,
        sourceService: 'radarr',
        status: 'queued',
        attempt: 1,
        maxRetries: 4,
        currentRelease: null,
        selectedReleaser: null,
        preferredReleaser: null,
        reasonCode: null,
        failureReason: null,
        validationSummary: null,
        autoRetrying: false,
        progress: null,
        queueStatus: 'Queued',
        preferences: {
          preferredLanguage: 'English',
          subtitleLanguage: 'English',
        },
        targetSeasonNumbers: null,
        targetEpisodeIds: null,
        startedAt: '2026-04-02T10:05:00.000Z',
        updatedAt: '2026-04-02T10:05:00.000Z',
        completedAt: null,
        attempts: [],
      },
    };
    const dependencies = createDependencies({
      api: {
        submitGrab: vi.fn().mockResolvedValue(grabResponse),
        fetchQueue: vi.fn().mockImplementation(() => queueRefresh.promise),
        refreshDashboard: vi.fn().mockImplementation(() => dashboardRefresh.promise),
      },
      timers: {
        setTimeout: vi.fn().mockReturnValue(99) as unknown as typeof globalThis.setTimeout,
        clearTimeout: vi.fn() as unknown as typeof globalThis.clearTimeout,
      },
    });
    const state = new AppState(pageData, dependencies);
    state.openAddConfirm(movieItem);

    await state.submitGrab(movieItem, state.confirmQualityProfileId);

    expect(state.confirmAddItem).toBeNull();
    expect(state.grabbing).toBeNull();
    expect(state.activeView).toBe('queue');
    expect(state.queue?.entries[0]).toMatchObject({
      kind: 'managed',
      id: 'job-1',
    });
    expect(dependencies.api.fetchQueue).toHaveBeenCalledTimes(1);
    expect(dependencies.api.refreshDashboard).toHaveBeenCalledTimes(1);

    queueRefresh.resolve(queueResponse);
    dashboardRefresh.resolve(dashboardResponse);
    await Promise.all([queueRefresh.promise, dashboardRefresh.promise]);
  });

  it('keeps optimistic queue state and shows a warning when refresh fails after a successful grab', async () => {
    const grabResponse: GrabResponse = {
      existing: false,
      item: {
        ...movieItem,
        inArr: true,
        canAdd: false,
        status: 'Already in Arr',
      },
      message: '"The Matrix" was added to Radarr.',
      releaseDecision: null,
      job: {
        id: 'job-1',
        itemId: movieItem.id,
        arrItemId: 603,
        kind: 'movie',
        title: movieItem.title,
        sourceService: 'radarr',
        status: 'queued',
        attempt: 1,
        maxRetries: 4,
        currentRelease: null,
        selectedReleaser: null,
        preferredReleaser: null,
        reasonCode: null,
        failureReason: null,
        validationSummary: null,
        autoRetrying: false,
        progress: null,
        queueStatus: 'Queued',
        preferences: {
          preferredLanguage: 'English',
          subtitleLanguage: 'English',
        },
        targetSeasonNumbers: null,
        targetEpisodeIds: null,
        startedAt: '2026-04-02T10:05:00.000Z',
        updatedAt: '2026-04-02T10:05:00.000Z',
        completedAt: null,
        attempts: [],
      },
    };
    const dependencies = createDependencies({
      api: {
        submitGrab: vi.fn().mockResolvedValue(grabResponse),
        fetchQueue: vi.fn().mockRejectedValue(new Error('Queue refresh failed')),
        refreshDashboard: vi.fn().mockRejectedValue(new Error('Dashboard refresh failed')),
      },
      timers: {
        setTimeout: vi.fn().mockReturnValue(99) as unknown as typeof globalThis.setTimeout,
        clearTimeout: vi.fn() as unknown as typeof globalThis.clearTimeout,
      },
    });
    const state = new AppState(pageData, dependencies);

    await state.submitGrab(movieItem, 7);

    expect(state.queue?.entries[0]).toMatchObject({
      kind: 'managed',
      id: 'job-1',
    });
    await vi.waitFor(() => {
      expect(state.latestActionMessage).toContain('refresh is still catching up');
    });
  });

  it('keeps unrelated external queue rows during optimistic series grab updates', async () => {
    const queueRefresh = createDeferred<QueueResponse>();
    const dashboardRefresh = createDeferred<DashboardResponse>();
    const seriesJob: AcquisitionJob = {
      ...acquisitionJob,
      id: 'job-series',
      itemId: seriesItem.id,
      arrItemId: 1399,
      kind: 'series',
      title: seriesItem.title,
      sourceService: 'sonarr',
      targetSeasonNumbers: [1],
      targetEpisodeIds: [101, 102],
    };
    const dependencies = createDependencies({
      api: {
        submitGrab: vi.fn().mockResolvedValue({
          existing: false,
          item: {
            ...seriesItem,
            arrItemId: 1399,
            inArr: true,
            canAdd: false,
            status: 'Already in Arr',
          },
          message: '"Game of Thrones" was added to Sonarr.',
          releaseDecision: null,
          job: seriesJob,
        } satisfies GrabResponse),
        fetchQueue: vi.fn().mockImplementation(() => queueRefresh.promise),
        refreshDashboard: vi.fn().mockImplementation(() => dashboardRefresh.promise),
      },
      timers: {
        setTimeout: vi.fn().mockReturnValue(99) as unknown as typeof globalThis.setTimeout,
        clearTimeout: vi.fn() as unknown as typeof globalThis.clearTimeout,
      },
    });
    const state = new AppState(pageData, dependencies);
    state.queue = buildQueue([
      buildExternalEntry({
        id: 'sonarr:queue:stale',
        arrItemId: 1399,
        canCancel: true,
        kind: 'series',
        title: seriesItem.title,
        year: seriesItem.year,
        poster: null,
        sourceService: 'sonarr',
        status: 'Downloading',
        progress: 40,
        timeLeft: '20m',
        estimatedCompletionTime: null,
        size: 2_000_000_000,
        sizeLeft: 1_200_000_000,
        queueId: 9,
        detail: 'Game.of.Thrones.S02E01.1080p.WEB-DL-OTHER',
        episodeIds: [201],
        seasonNumbers: [2],
      }),
    ]);

    state.openAddConfirm(seriesItem);
    await state.submitGrab(
      seriesItem,
      11,
      {
        cardsView: state.cardsView,
        preferredLanguage: state.confirmPreferredLanguage,
        subtitleLanguage: state.confirmSubtitleLanguage,
        theme: state.theme,
      },
      [1],
    );

    expect(state.queue?.entries).toHaveLength(2);
    expect(state.queue?.entries[0]).toMatchObject({
      kind: 'managed',
      id: 'job-series',
    });
    expect(state.queue?.entries[1]).toMatchObject({
      kind: 'external',
      id: 'sonarr:queue:stale',
    });

    queueRefresh.resolve(queueResponse);
    dashboardRefresh.resolve(dashboardResponse);
    await Promise.all([queueRefresh.promise, dashboardRefresh.promise]);
  });

  it('suppresses impossible managed actions in optimistic queue entries for download-only live rows', async () => {
    const queueRefresh = createDeferred<QueueResponse>();
    const dashboardRefresh = createDeferred<DashboardResponse>();
    const downloadOnlyJob: AcquisitionJob = {
      ...acquisitionJob,
      status: 'grabbing',
      liveQueueId: null,
      liveDownloadId: 'download-shared',
    };
    const dependencies = createDependencies({
      api: {
        submitGrab: vi.fn().mockResolvedValue({
          existing: false,
          item: movieItem,
          message: '"The Matrix" was grabbed.',
          releaseDecision: null,
          job: downloadOnlyJob,
        } satisfies GrabResponse),
        fetchQueue: vi.fn().mockImplementation(() => queueRefresh.promise),
        refreshDashboard: vi.fn().mockImplementation(() => dashboardRefresh.promise),
      },
      timers: {
        setTimeout: vi.fn().mockReturnValue(99) as unknown as typeof globalThis.setTimeout,
        clearTimeout: vi.fn() as unknown as typeof globalThis.clearTimeout,
      },
    });
    const state = new AppState(pageData, dependencies);

    await state.submitGrab(movieItem);

    expect(state.queue?.entries[0]).toMatchObject({
      kind: 'managed',
      id: downloadOnlyJob.id,
      canCancel: false,
      canRemove: false,
    });

    queueRefresh.resolve(queueResponse);
    dashboardRefresh.resolve(dashboardResponse);
    await Promise.all([queueRefresh.promise, dashboardRefresh.promise]);
  });

  it('ignores duplicate in-flight grab submissions for the same item', async () => {
    const submitGrabResult = createDeferred<GrabResponse>();
    const submitGrab = vi.fn().mockImplementation(() => submitGrabResult.promise);
    const state = new AppState(
      pageData,
      createDependencies({
        api: {
          submitGrab,
        },
      }),
    );

    state.openAddConfirm(movieItem);

    const firstSubmit = state.submitGrab(movieItem, state.confirmQualityProfileId);
    const secondSubmit = state.submitGrab(movieItem, state.confirmQualityProfileId);

    expect(submitGrab).toHaveBeenCalledTimes(1);
    expect(state.grabbing).toBe(movieItem.id);

    submitGrabResult.resolve({
      existing: false,
      item: {
        ...movieItem,
        arrItemId: 603,
        inArr: true,
        canAdd: false,
        status: 'Already in Arr',
      },
      message: '"The Matrix" was added to Radarr.',
      releaseDecision: null,
      job: acquisitionJob,
    });

    await Promise.all([firstSubmit, secondSubmit]);

    expect(submitGrab).toHaveBeenCalledTimes(1);
    expect(state.grabbing).toBeNull();
    expect(state.activeView).toBe('queue');
  });

  it('ignores add-dialog reopen attempts for a short window after a successful request', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    const dependencies = createDependencies({
      api: {
        submitGrab: vi.fn().mockResolvedValue({
          existing: false,
          item: {
            ...movieItem,
            inArr: true,
            canAdd: false,
            status: 'Already in Arr',
          },
          message: '"The Matrix" was added to Radarr.',
          releaseDecision: null,
          job: null,
        } satisfies GrabResponse),
      },
    });
    const state = new AppState(pageData, dependencies);

    state.openAddConfirm(movieItem);
    await state.submitGrab(movieItem, state.confirmQualityProfileId);

    expect(state.confirmAddItem).toBeNull();

    state.openAddConfirm(movieItem);
    expect(state.confirmAddItem).toBeNull();

    nowSpy.mockReturnValue(1_600);
    state.openAddConfirm(movieItem);
    expect(state.confirmAddItem).toEqual(movieItem);

    nowSpy.mockRestore();
  });

  it('still closes the add dialog when client preference persistence fails after a successful request', async () => {
    const dependencies = createDependencies({
      api: {
        submitGrab: vi.fn().mockResolvedValue({
          existing: false,
          item: {
            ...movieItem,
            inArr: true,
            canAdd: false,
            status: 'Already in Arr',
          },
          message: '"The Matrix" was added to Radarr.',
          releaseDecision: null,
          job: null,
        } satisfies GrabResponse),
      },
      storage: {
        savePreferences: vi.fn().mockImplementation(() => {
          throw new Error('localStorage write failed');
        }),
      },
    });
    const state = new AppState(pageData, dependencies);

    state.openAddConfirm(movieItem);
    await state.submitGrab(movieItem, state.confirmQualityProfileId);

    expect(state.confirmAddItem).toBeNull();
    expect(state.grabbing).toBeNull();
    expect(state.activeView).toBe('queue');
    expect(state.grabError).toBe('localStorage write failed');
  });

  it('auto clears the add success popup after three seconds', async () => {
    const grabResponse: GrabResponse = {
      existing: false,
      item: {
        ...movieItem,
        inArr: true,
        canAdd: false,
        status: 'Already in Arr',
      },
      message: '"The Matrix" was added to Radarr. Acquisition started.',
      releaseDecision: null,
      job: null,
    };
    let toastTimer: (() => void) | null = null;
    const dependencies = createDependencies({
      api: {
        submitGrab: vi.fn().mockResolvedValue(grabResponse),
      },
      timers: {
        setTimeout: vi.fn().mockImplementation((handler: TimerHandler) => {
          toastTimer = typeof handler === 'function' ? () => handler() : null;
          return 123 as unknown as ReturnType<typeof globalThis.setTimeout>;
        }) as unknown as typeof globalThis.setTimeout,
        clearTimeout: vi.fn() as unknown as typeof globalThis.clearTimeout,
      },
    });
    const state = new AppState(pageData, dependencies);

    await state.submitGrab(movieItem, 7);

    expect(state.addSuccessToastMessage).toBe(grabResponse.message);
    expect(toastTimer).not.toBeNull();
    const timer =
      toastTimer ??
      (() => {
        throw new Error('Expected add-success timer handler');
      });
    timer();

    expect(state.addSuccessToastMessage).toBeNull();
  });

  it('opens a Plex-confirmed alternate release as a grabbable Arr-backed item', () => {
    const state = new AppState(pageData, createDependencies());
    const plexMergedItem: MediaItem = {
      ...movieItem,
      sourceService: 'plex',
      origin: 'merged',
      inPlex: true,
      canAdd: false,
      plexLibraries: ['Movies'],
      status: 'Available in Plex',
    };

    state.openAddConfirm(plexMergedItem);

    expect(state.confirmAddItem).toMatchObject({
      canAdd: true,
      inPlex: true,
      sourceService: 'radarr',
      origin: 'arr',
    });
  });

  it('does not open the grab dialog for Plex-only items without Arr request context', async () => {
    const state = new AppState(pageData, createDependencies());
    const plexOnlyItem: MediaItem = {
      ...movieItem,
      sourceService: 'plex',
      origin: 'plex',
      inPlex: true,
      canAdd: false,
      requestPayload: null,
      status: 'Available in Plex',
    };

    await state.openAddConfirm(plexOnlyItem);

    expect(state.confirmAddItem).toBeNull();
  });

  it('resolves Plex-only items into alternate-release grabs before opening the dialog', async () => {
    const resolveGrabCandidate = vi.fn().mockResolvedValue({
      ...movieItem,
      sourceService: 'radarr',
      origin: 'merged',
      inPlex: true,
      canAdd: false,
      status: 'Available in Plex',
      requestPayload: { id: 603, tmdbId: 603 },
    } satisfies MediaItem);
    const state = new AppState(
      pageData,
      createDependencies({
        api: {
          resolveGrabCandidate,
        },
      }),
    );
    const plexOnlyItem: MediaItem = {
      ...movieItem,
      sourceService: 'plex',
      origin: 'plex',
      inPlex: true,
      canAdd: false,
      status: 'Available in Plex',
    };
    state.searchResults = [plexOnlyItem];

    await state.openAddConfirm(plexOnlyItem);

    expect(resolveGrabCandidate).toHaveBeenCalledWith(plexOnlyItem, {
      preferredLanguage: state.preferredLanguage,
      subtitleLanguage: state.subtitleLanguage,
    });
    expect(state.confirmAddItem).toMatchObject({
      canAdd: true,
      inPlex: true,
      sourceService: 'radarr',
    });
  });

  it('opens tracked Arr items as alternate-release grabs', () => {
    const state = new AppState(pageData, createDependencies());
    const trackedItem: MediaItem = {
      ...movieItem,
      arrItemId: 603,
      canAdd: false,
      inArr: true,
      isExisting: true,
      isRequested: true,
      status: 'Already in Arr',
      requestPayload: { id: 603, tmdbId: 603 },
    };

    state.openAddConfirm(trackedItem);

    expect(state.confirmAddItem).toMatchObject({
      canAdd: true,
      inArr: true,
      arrItemId: 603,
      sourceService: 'radarr',
    });
  });

  it('passes selected seasons through the request submission flow for series', async () => {
    const dependencies = createDependencies({
      api: {
        submitGrab: vi.fn().mockResolvedValue({
          existing: false,
          item: {
            ...seriesItem,
            inArr: true,
            canAdd: false,
            status: 'Already in Arr',
          },
          message: 'Added',
          releaseDecision: null,
          job: null,
        } satisfies GrabResponse),
      },
    });
    const state = new AppState(pageData, dependencies);

    state.openAddConfirm(seriesItem);
    state.toggleConfirmSeason(2);

    await state.submitGrab(
      seriesItem,
      state.confirmQualityProfileId,
      {
        cardsView: state.cardsView,
        preferredLanguage: state.confirmPreferredLanguage,
        subtitleLanguage: state.confirmSubtitleLanguage,
        theme: state.theme,
      },
      state.confirmSeasonNumbers,
    );

    expect(dependencies.api.submitGrab).toHaveBeenCalledWith(
      seriesItem,
      {
        cardsView: state.cardsView,
        preferredLanguage: state.confirmPreferredLanguage,
        subtitleLanguage: state.confirmSubtitleLanguage,
        theme: state.theme,
      },
      11,
      [1, 2],
    );
  });

  it('opens the manual release overlay, loads releases, and preserves cached results when closed', async () => {
    const fetchManualReleaseResults = vi.fn().mockResolvedValue(manualReleaseResponse);
    const state = new AppState(
      pageData,
      createDependencies({
        api: {
          fetchManualReleaseResults,
        },
      }),
    );
    state.queue = {
      ...buildQueue([buildManagedEntry(acquisitionJob)]),
    };

    await state.openManualReleaseList(acquisitionJob.id);

    expect(state.activeManualReleaseJobId).toBe(acquisitionJob.id);
    expect(state.manualReleaseListOpen(acquisitionJob.id)).toBe(true);
    expect(state.activeManualReleaseJob?.title).toBe(acquisitionJob.title);
    expect(state.hasOpenOverlay).toBe(true);
    expect(fetchManualReleaseResults).toHaveBeenCalledTimes(1);
    expect(state.manualReleaseList(acquisitionJob.id)).toEqual(manualReleaseResponse);

    state.closeManualReleaseList();

    expect(state.activeManualReleaseJobId).toBeNull();
    expect(state.manualReleaseListOpen(acquisitionJob.id)).toBe(false);
    expect(state.manualReleaseList(acquisitionJob.id)).toEqual(manualReleaseResponse);
    expect(state.hasOpenOverlay).toBe(false);
  });

  it('refreshes manual release results when reopening the same overlay', async () => {
    const refreshedManualReleaseResponse = {
      ...manualReleaseResponse,
      summary: 'Updated manual-search releases are available.',
    };
    const fetchManualReleaseResults = vi
      .fn()
      .mockResolvedValueOnce(manualReleaseResponse)
      .mockResolvedValueOnce(refreshedManualReleaseResponse);
    const state = new AppState(
      pageData,
      createDependencies({
        api: {
          fetchManualReleaseResults,
        },
      }),
    );
    state.queue = {
      ...buildQueue([buildManagedEntry(acquisitionJob)]),
    };

    await state.openManualReleaseList(acquisitionJob.id);
    state.closeManualReleaseList();
    await state.openManualReleaseList(acquisitionJob.id);

    expect(fetchManualReleaseResults).toHaveBeenCalledTimes(2);
    expect(state.activeManualReleaseJobId).toBe(acquisitionJob.id);
    expect(state.manualReleaseList(acquisitionJob.id)).toEqual(refreshedManualReleaseResponse);
  });

  it('sends Arr override selection mode when selecting an Arr-rejected manual release', async () => {
    const selectManualRelease = vi.fn().mockResolvedValue({
      job: {
        ...acquisitionJob,
        status: 'queued',
      },
      message: 'Queued manual release override.',
    });
    const state = new AppState(
      pageData,
      createDependencies({
        api: {
          fetchManualReleaseResults: vi.fn().mockResolvedValue({
            ...manualReleaseResponse,
            releases: [
              {
                ...manualReleaseResponse.releases[0],
                canSelect: true,
                selectionMode: 'override-arr-rejection',
                explanation: {
                  ...manualReleaseResponse.releases[0].explanation,
                  arrReasons: ['Rejected by Arr custom format rules'],
                },
                status: 'arr-rejected',
              },
            ],
          }),
          selectManualRelease,
          fetchQueue: vi.fn().mockResolvedValue(buildQueue([buildManagedEntry(acquisitionJob)])),
          refreshDashboard: vi.fn().mockResolvedValue(dashboardResponse),
        },
      }),
    );
    state.queue = buildQueue([buildManagedEntry(acquisitionJob)]);

    await state.openManualReleaseList(acquisitionJob.id);
    const release = state.manualReleaseList(acquisitionJob.id)?.releases[0];
    expect(release).not.toBeNull();

    await state.selectManualRelease(
      acquisitionJob.id,
      release?.guid ?? 'guid-1',
      release?.indexerId ?? 11,
      'override-arr-rejection',
    );

    expect(selectManualRelease).toHaveBeenCalledWith(
      acquisitionJob.id,
      'guid-1',
      11,
      'override-arr-rejection',
    );
    expect(state.latestActionMessage).toBe('Queued manual release override.');
  });

  it('keeps managed queue entries matched to live Arr download items', () => {
    const state = new AppState(pageData, createDependencies());
    const matchingQueueItem: QueueItem = {
      id: 'radarr:queue:4',
      arrItemId: acquisitionJob.arrItemId,
      canCancel: true,
      kind: acquisitionJob.kind,
      title: acquisitionJob.title,
      year: 1999,
      poster: null,
      sourceService: acquisitionJob.sourceService,
      status: 'Downloading',
      progress: 64,
      timeLeft: '12m',
      estimatedCompletionTime: '2026-04-02T10:17:00.000Z',
      size: 4_000_000_000,
      sizeLeft: 1_200_000_000,
      queueId: 4,
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    };

    state.queue = buildQueue([
      buildManagedEntry(acquisitionJob, [matchingQueueItem]),
      buildExternalEntry({
        ...matchingQueueItem,
        id: 'sonarr:queue:4',
        sourceService: 'sonarr',
      }),
    ]);

    expect(state.managedQueueEntry(acquisitionJob.id)?.liveQueueItems).toEqual([matchingQueueItem]);
  });

  it('defaults the selected queue entry to the guided managed job when one is present', async () => {
    const guidedJob: AcquisitionJob = {
      ...acquisitionJob,
      id: 'job-guided',
      title: 'Guided Job',
    };
    const externalEntry = buildExternalEntry({
      id: 'radarr:queue:9',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 40,
      timeLeft: '15m',
      estimatedCompletionTime: '2026-04-02T10:20:00.000Z',
      size: 4_000_000_000,
      sizeLeft: 2_400_000_000,
      queueId: 9,
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    });
    const state = new AppState(
      pageData,
      createDependencies({
        api: {
          fetchQueue: vi.fn().mockResolvedValue(buildQueue([buildManagedEntry(guidedJob), externalEntry])),
        },
      }),
    );
    state.guidedQueueJobId = guidedJob.id;

    await state.loadQueue();

    expect(state.selectedQueueEntry?.id).toBe(guidedJob.id);
  });

  it('keeps the selected queue entry when refreshed queue data still contains it', async () => {
    const managedEntry = buildManagedEntry(acquisitionJob);
    const externalEntry = buildExternalEntry({
      id: 'radarr:queue:10',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 64,
      timeLeft: '9m',
      estimatedCompletionTime: '2026-04-02T10:14:00.000Z',
      size: 4_000_000_000,
      sizeLeft: 1_200_000_000,
      queueId: 10,
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    });
    const refreshedExternalEntry = buildExternalEntry({
      ...externalEntry.item,
      progress: 72,
      sizeLeft: 800_000_000,
    });
    const fetchQueue = vi
      .fn()
      .mockResolvedValueOnce(buildQueue([managedEntry, externalEntry]))
      .mockResolvedValueOnce(buildQueue([managedEntry, refreshedExternalEntry]));
    const state = new AppState(
      pageData,
      createDependencies({
        api: {
          fetchQueue,
        },
      }),
    );

    await state.loadQueue();
    state.selectQueueEntry(externalEntry.id);
    await state.loadQueue();

    expect(state.selectedQueueEntry?.id).toBe(externalEntry.id);
  });

  it('keeps the selected queue entry when the same download later gains a queue id', async () => {
    const managedEntry = buildManagedEntry(acquisitionJob);
    const stableExternalId =
      'radarr:download:download-shared:radarr-603-the-matrix-1999-1080p-web-dl-flux-noscope';
    const externalEntry = buildExternalEntry({
      id: stableExternalId,
      downloadId: 'download-shared',
      arrItemId: 603,
      canCancel: false,
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 64,
      timeLeft: '9m',
      estimatedCompletionTime: '2026-04-02T10:14:00.000Z',
      size: 4_000_000_000,
      sizeLeft: 1_200_000_000,
      queueId: null,
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    });
    const refreshedExternalEntry = buildExternalEntry({
      ...externalEntry.item,
      id: stableExternalId,
      queueId: 10,
      progress: 72,
      sizeLeft: 800_000_000,
    });
    const fetchQueue = vi
      .fn()
      .mockResolvedValueOnce(buildQueue([managedEntry, externalEntry]))
      .mockResolvedValueOnce(buildQueue([managedEntry, refreshedExternalEntry]));
    const state = new AppState(
      pageData,
      createDependencies({
        api: {
          fetchQueue,
        },
      }),
    );

    await state.loadQueue();
    state.selectQueueEntry(externalEntry.id);
    await state.loadQueue();

    expect(state.selectedQueueEntry?.id).toBe(stableExternalId);
    expect(state.selectedQueueEntry?.kind).toBe('external');
  });

  it('clears queue selection instead of jumping to another row when the selected entry disappears', async () => {
    const managedEntry = buildManagedEntry(acquisitionJob);
    const externalEntry = buildExternalEntry({
      id: 'radarr:queue:10',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 64,
      timeLeft: '9m',
      estimatedCompletionTime: '2026-04-02T10:14:00.000Z',
      size: 4_000_000_000,
      sizeLeft: 1_200_000_000,
      queueId: 10,
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    });
    const replacementEntry = buildExternalEntry({
      ...externalEntry.item,
      id: 'radarr:queue:11',
      queueId: 11,
      detail: 'The.Matrix.1999.1080p.BluRay-OLD',
    });
    const fetchQueue = vi
      .fn()
      .mockResolvedValueOnce(buildQueue([managedEntry, externalEntry]))
      .mockResolvedValueOnce(buildQueue([managedEntry, replacementEntry]));
    const state = new AppState(
      pageData,
      createDependencies({
        api: {
          fetchQueue,
        },
      }),
    );

    await state.loadQueue();
    state.selectQueueEntry(externalEntry.id);
    await state.loadQueue();

    expect(state.selectedQueueEntry).toBeNull();
    expect(state.queueSelectionNeedsManualChoice).toBe(true);
  });

  it('auto-selects a new guided queue job even after a previous selection was cleared', async () => {
    const queueRefresh = createDeferred<QueueResponse>();
    const dashboardRefresh = createDeferred<DashboardResponse>();
    const grabResponse: GrabResponse = {
      existing: false,
      item: {
        ...movieItem,
        inArr: true,
        canAdd: false,
        status: 'Already in Arr',
      },
      message: '"The Matrix" was added to Radarr. Acquisition started.',
      releaseDecision: null,
      job: {
        ...acquisitionJob,
        id: 'job-2',
      },
    };
    const dependencies = createDependencies({
      api: {
        fetchQueue: vi.fn().mockImplementation(() => queueRefresh.promise),
        refreshDashboard: vi.fn().mockImplementation(() => dashboardRefresh.promise),
        submitGrab: vi.fn().mockResolvedValue(grabResponse),
      },
      timers: {
        setTimeout: vi.fn().mockReturnValue(99) as unknown as typeof globalThis.setTimeout,
        clearTimeout: vi.fn() as unknown as typeof globalThis.clearTimeout,
      },
    });
    const state = new AppState(pageData, dependencies);
    state.queueSelectionNeedsManualChoice = true;
    state.searchResults = [movieItem];
    state.openAddConfirm(movieItem);

    await state.submitGrab(movieItem, state.confirmQualityProfileId);

    expect(state.guidedQueueJobId).toBe('job-2');
    expect(state.queueSelectionNeedsManualChoice).toBe(false);
    expect(state.selectedQueueEntry?.id).toBe('job-2');
  });

  it('stores queue cancel failures separately from manual release errors', async () => {
    const dependencies = createDependencies({
      api: {
        cancelQueueEntry: vi.fn().mockRejectedValue(new Error('Unable to cancel the selected download.')),
      },
    });
    const state = new AppState(pageData, dependencies);
    const managedEntry = buildManagedEntry(acquisitionJob);
    state.queue = buildQueue([managedEntry]);

    await state.cancelQueueEntry(managedEntry);

    expect(state.queueEntryError(managedEntry.id)).toBe('Unable to cancel the selected download.');
    expect(state.manualSelectionError[acquisitionJob.id] ?? null).toBeNull();
  });

  it('ignores cancel requests for queue entries that are no longer cancelable', async () => {
    const dependencies = createDependencies();
    const state = new AppState(pageData, dependencies);
    const staleEntry = buildExternalEntry({
      id: 'radarr:queue:1996958567',
      arrItemId: 727,
      canCancel: true,
      kind: 'movie',
      title: 'Dangerous Animals',
      year: 2025,
      poster: null,
      sourceService: 'radarr',
      status: 'Completed',
      statusDetail:
        'Not an upgrade for existing movie file. Existing quality: Bluray-2160p.',
      progress: 100,
      timeLeft: '00:00:00',
      estimatedCompletionTime: null,
      size: 7_845_710_150,
      sizeLeft: 0,
      queueId: 1996958567,
      detail: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
      episodeIds: null,
      seasonNumbers: null,
    });
    staleEntry.canCancel = false;
    staleEntry.canRemove = true;

    await state.cancelQueueEntry(staleEntry);

    expect(dependencies.api.cancelQueueEntry).not.toHaveBeenCalled();
    expect(state.queueEntryError(staleEntry.id)).toBeNull();
  });

  it('treats the filter UI as an overlay only on mobile viewports', () => {
    const state = new AppState(pageData, createDependencies());

    state.kindMenuOpen = true;
    state.isMobileViewport = false;
    expect(state.usesFullscreenDialogs).toBe(false);
    expect(state.hasOpenOverlay).toBe(false);

    state.isMobileViewport = true;
    expect(state.usesFullscreenDialogs).toBe(true);
    expect(state.hasOpenOverlay).toBe(true);
  });

  it('clears search results for short queries without hitting the API', async () => {
    const dependencies = createDependencies();
    const state = new AppState(pageData, dependencies);
    state.searchResults = [movieItem];
    state.searchError = 'Old error';

    await state.loadSearch('m', 'movie', 'not-available-only');

    expect(state.searchResults).toEqual([]);
    expect(state.searchError).toBeNull();
    expect(dependencies.api.fetchSearchResults).not.toHaveBeenCalled();
  });

  it('ignores stale search responses that resolve after a newer query', async () => {
    const staleResult: MediaItem = {
      ...movieItem,
      id: 'movie:40465',
      title: 'Rambo: Last Blood',
      year: 2019,
      canAdd: true,
      inPlex: false,
      origin: 'arr',
    };
    const currentResult: MediaItem = {
      ...movieItem,
      id: 'movie:7555',
      title: 'Rambo',
      year: 2008,
      canAdd: false,
      inPlex: true,
      origin: 'merged',
    };
    const staleSearch = createDeferred<MediaItem[]>();
    const currentSearch = createDeferred<MediaItem[]>();
    const fetchSearchResults = vi
      .fn()
      .mockImplementationOnce(() => staleSearch.promise)
      .mockImplementationOnce(() => currentSearch.promise);
    const dependencies = createDependencies({
      api: {
        fetchSearchResults,
      },
    });
    const state = new AppState(pageData, dependencies);

    const staleRequest = state.loadSearch('Rambo: Last Blood 2019', 'movie', 'all');
    const currentRequest = state.loadSearch('Rambo', 'movie', 'not-available-only');

    currentSearch.resolve([currentResult]);
    await currentRequest;
    staleSearch.resolve([staleResult]);
    await staleRequest;

    expect(state.searchResults).toEqual([currentResult]);
    expect(state.searchLoading).toBe(false);
    expect(state.searchError).toBeNull();
  });

  it('hydrates the default availability filter as only not available', () => {
    const state = new AppState(pageData, createDependencies());

    const dispose = state.mount();

    expect(state.availability).toBe('not-available-only');
    expect(state.sortField).toBe('popularity');
    expect(state.sortDirection).toBe('desc');
    dispose();
  });

  it('sorts search results by the selected field and direction without refetching', () => {
    const state = new AppState(pageData, createDependencies());
    state.searchResults = [
      {
        ...movieItem,
        id: 'movie:11',
        title: 'Zulu',
        year: 1964,
        rating: 7.7,
        requestPayload: { popularity: 12 },
      },
      {
        ...movieItem,
        id: 'movie:12',
        title: 'Alien',
        year: 1979,
        rating: 8.5,
        requestPayload: { popularity: 78 },
      },
      {
        ...movieItem,
        id: 'movie:13',
        title: 'Blade Runner',
        year: 1982,
        rating: 8.1,
        requestPayload: { popularity: 50 },
      },
    ];

    state.sortField = 'title';
    state.sortDirection = 'asc';
    expect(state.visibleSearchResults.map((item) => item.title)).toEqual([
      'Alien',
      'Blade Runner',
      'Zulu',
    ]);

    state.sortField = 'rating';
    state.sortDirection = 'desc';
    expect(state.visibleSearchResults.map((item) => item.title)).toEqual([
      'Alien',
      'Blade Runner',
      'Zulu',
    ]);
  });

  it('separates attention-needed downloads from pending checks', () => {
    const state = new AppState(
      {
        ...pageData,
        recentPlex: [],
      },
      createDependencies(),
    );
    state.dashboard = {
      ...dashboardResponse,
      items: [
        {
          ...movieItem,
          id: 'movie:1',
          title: 'Verified Item',
          auditStatus: 'verified',
          inArr: true,
          canAdd: false,
        },
        {
          ...movieItem,
          id: 'movie:2',
          title: 'Needs Audio',
          auditStatus: 'missing-language',
          inArr: true,
          canAdd: false,
        },
        {
          ...movieItem,
          id: 'movie:3',
          title: 'Still Downloading',
          auditStatus: 'pending',
          inArr: true,
          canAdd: false,
        },
      ],
    };

    expect(state.auditAttentionItems.map((item) => item.title)).toEqual(['Needs Audio']);
    expect(state.auditPendingItems.map((item) => item.title)).toEqual(['Still Downloading']);
    expect(state.auditVerifiedItems.map((item) => item.title)).toEqual(['Verified Item']);
  });

  it('deletes Arr items after confirmation and refreshes search/dashboard state', async () => {
    const dependencies = createDependencies({
      api: {
        deleteArrItem: vi.fn().mockResolvedValue({
          itemId: movieItem.id,
          message: 'The Matrix was deleted.',
        }),
      },
    });
    const state = new AppState(pageData, dependencies);
    state.query = 'Matrix';
    state.kind = 'movie';
    state.availability = 'all';

    await state.deleteMediaItem({
      ...movieItem,
      arrItemId: 603,
      canAdd: false,
      canDeleteFromArr: true,
      inArr: true,
      status: 'Already in Arr',
    });

    expect(dependencies.confirm).toHaveBeenCalledTimes(1);
    expect(dependencies.api.deleteArrItem).toHaveBeenCalledTimes(1);
    expect(dependencies.api.refreshDashboard).toHaveBeenCalledTimes(1);
    expect(dependencies.api.fetchQueue).toHaveBeenCalledTimes(1);
    expect(dependencies.api.fetchSearchResults).toHaveBeenCalledWith('Matrix', 'movie', 'all');
    expect(state.latestActionMessage).toBe('The Matrix was deleted.');
    expect(state.deletingItemId).toBeNull();
  });

  it('deletes stale queue items using the queue id when no Arr item id is present', async () => {
    const dependencies = createDependencies({
      api: {
        deleteArrItem: vi.fn().mockResolvedValue({
          itemId: 'radarr:queue:1',
          message: 'Stale queue entry removed.',
        }),
      },
    });
    const state = new AppState(pageData, dependencies);

    await state.deleteQueueEntry(
      buildExternalEntry({
        id: 'radarr:queue:1',
        arrItemId: null,
        canCancel: false,
        kind: 'movie',
        title: 'The Matrix',
        year: 1999,
        poster: null,
        sourceService: 'radarr',
        status: 'Completed',
        statusDetail:
          'Not an upgrade for existing movie file. Existing quality: Bluray-2160p.',
        trackedDownloadStatus: 'warning',
        trackedDownloadState: 'importpending',
        progress: 100,
        timeLeft: '00:00:00',
        estimatedCompletionTime: null,
        size: 1_000,
        sizeLeft: 0,
        queueId: 1,
        detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
        episodeIds: null,
        seasonNumbers: null,
      }),
    );

    expect(dependencies.api.deleteArrItem).toHaveBeenCalledWith({
      deleteMode: 'queue-entry',
      downloadId: null,
      id: 'radarr:queue:1',
      kind: 'movie',
      queueId: 1,
      sourceService: 'radarr',
      title: 'The Matrix',
    });
  });

  it('deletes stale queue items using the download id when Arr did not expose a queue id', async () => {
    const dependencies = createDependencies({
      api: {
        deleteArrItem: vi.fn().mockResolvedValue({
          itemId: 'radarr:download:download-shared',
          message: 'Stale queue entry removed.',
        }),
      },
    });
    const state = new AppState(pageData, dependencies);

    await state.deleteQueueEntry(
      buildExternalEntry({
        id: 'radarr:download:download-shared',
        downloadId: 'download-shared',
        arrItemId: null,
        canCancel: false,
        kind: 'movie',
        title: 'The Matrix',
        year: 1999,
        poster: null,
        sourceService: 'radarr',
        status: 'Completed',
        statusDetail: 'Import failed, destination path already exists.',
        trackedDownloadStatus: 'warning',
        trackedDownloadState: 'importpending',
        progress: 100,
        timeLeft: '00:00:00',
        estimatedCompletionTime: null,
        size: 1_000,
        sizeLeft: 0,
        queueId: null,
        detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
        episodeIds: null,
        seasonNumbers: null,
      }),
    );

    expect(dependencies.api.deleteArrItem).toHaveBeenCalledWith({
      deleteMode: 'queue-entry',
      downloadId: 'download-shared',
      id: 'radarr:download:download-shared',
      kind: 'movie',
      queueId: null,
      sourceService: 'radarr',
      title: 'The Matrix',
    });
  });

  it('deletes tracked stale queue items using the queue id even when an Arr item id is present', async () => {
    const dependencies = createDependencies({
      api: {
        deleteArrItem: vi.fn().mockResolvedValue({
          itemId: 'radarr:queue:1996958567',
          message: 'Stale queue entry removed.',
        }),
      },
    });
    const state = new AppState(pageData, dependencies);

    await state.deleteQueueEntry(
      buildExternalEntry({
        id: 'radarr:queue:1996958567',
        arrItemId: 727,
        canCancel: false,
        kind: 'movie',
        title: 'Dangerous Animals',
        year: 2025,
        poster: null,
        sourceService: 'radarr',
        status: 'Completed',
        statusDetail:
          'Not an upgrade for existing movie file. Existing quality: Bluray-2160p.',
        trackedDownloadStatus: 'warning',
        trackedDownloadState: 'importpending',
        progress: 100,
        timeLeft: '00:00:00',
        estimatedCompletionTime: null,
        size: 7_845_710_150,
        sizeLeft: 0,
        queueId: 1996958567,
        detail: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
        episodeIds: null,
        seasonNumbers: null,
      }),
    );

    expect(dependencies.api.deleteArrItem).toHaveBeenCalledWith({
      deleteMode: 'queue-entry',
      downloadId: null,
      id: 'radarr:queue:1996958567',
      kind: 'movie',
      queueId: 1996958567,
      sourceService: 'radarr',
      title: 'Dangerous Animals',
    });
  });

  it('ignores delete requests for external queue entries that are not removable', async () => {
    const dependencies = createDependencies();
    const state = new AppState(pageData, dependencies);
    const activeEntry = buildExternalEntry({
      id: 'radarr:queue:7',
      arrItemId: 603,
      canCancel: true,
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 75,
      timeLeft: '10m',
      estimatedCompletionTime: null,
      size: 1_000_000_000,
      sizeLeft: 250_000_000,
      queueId: 7,
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      episodeIds: null,
      seasonNumbers: null,
    });
    activeEntry.canRemove = false;

    await state.deleteQueueEntry(activeEntry);

    expect(dependencies.api.deleteArrItem).not.toHaveBeenCalled();
  });

  it('ignores delete requests for managed queue entries that are not removable', async () => {
    const dependencies = createDependencies();
    const state = new AppState(pageData, dependencies);
    const managedEntry = buildManagedEntry(acquisitionJob);
    managedEntry.canRemove = false;

    await state.deleteQueueEntry(managedEntry);

    expect(dependencies.api.deleteArrItem).not.toHaveBeenCalled();
  });

  it('keeps stale external queue-entry delete failures inline on the queue card', async () => {
    const dependencies = createDependencies({
      api: {
        deleteArrItem: vi
          .fn()
          .mockRejectedValue(
            new Error('This queue entry is still active. Cancel the download instead.'),
          ),
      },
    });
    const state = new AppState(pageData, dependencies);
    const staleEntry = buildExternalEntry({
      id: 'radarr:queue:1996958567',
      arrItemId: 727,
      canCancel: false,
      kind: 'movie',
      title: 'Dangerous Animals',
      year: 2025,
      poster: null,
      sourceService: 'radarr',
      status: 'Completed',
      statusDetail:
        'Not an upgrade for existing movie file. Existing quality: Bluray-2160p.',
      trackedDownloadStatus: 'warning',
      trackedDownloadState: 'importpending',
      progress: 100,
      timeLeft: '00:00:00',
      estimatedCompletionTime: null,
      size: 7_845_710_150,
      sizeLeft: 0,
      queueId: 1996958567,
      detail: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
      episodeIds: null,
      seasonNumbers: null,
    });

    await state.deleteQueueEntry(staleEntry);

    expect(state.queueEntryError(staleEntry.id)).toBe(
      'This queue entry is still active. Cancel the download instead.',
    );
    expect(state.deleteError).toBeNull();
  });

  it('keeps managed queue removal failures inline on the queue card', async () => {
    const dependencies = createDependencies({
      api: {
        deleteArrItem: vi.fn().mockRejectedValue(new Error('Unable to delete the selected Arr item.')),
      },
    });
    const state = new AppState(pageData, dependencies);
    const managedEntry = buildManagedEntry(acquisitionJob);

    await state.deleteQueueEntry(managedEntry);

    expect(state.queueEntryError(managedEntry.id)).toBe(
      'Unable to delete the selected Arr item.',
    );
    expect(state.deleteError).toBeNull();
  });

  it('clears a pending debounced search when Enter submits immediately', async () => {
    const fetchSearchResults = vi.fn().mockResolvedValue([movieItem]);
    const timerHandles = new Map<number, TimerHandler>();
    let nextHandle = 1;
    const dependencies = createDependencies({
      api: {
        fetchSearchResults,
      },
      timers: {
        setTimeout: vi.fn().mockImplementation((handler: TimerHandler) => {
          const handle = nextHandle;
          nextHandle += 1;
          timerHandles.set(handle, handler);
          return handle as unknown as ReturnType<typeof globalThis.setTimeout>;
        }) as unknown as typeof globalThis.setTimeout,
        clearTimeout: vi
          .fn()
          .mockImplementation((handle: ReturnType<typeof globalThis.setTimeout>) => {
            timerHandles.delete(handle as unknown as number);
          }) as unknown as typeof globalThis.clearTimeout,
      },
    });
    const state = new AppState(pageData, dependencies);

    state.mount();
    state.query = 'Rambo';
    state.kind = 'movie';
    state.availability = 'all';

    state.handleSearchInputChanged();
    await state.runSearchNow();

    expect(fetchSearchResults).toHaveBeenCalledTimes(1);
    expect(fetchSearchResults).toHaveBeenCalledWith('Rambo', 'movie', 'all');
    expect(timerHandles.size).toBe(0);
  });
});
