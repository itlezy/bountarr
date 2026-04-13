import { describe, expect, it, vi } from 'vitest';
import { AppState } from '$lib/client/app-state.svelte';
import type { AppStateDependencies } from '$lib/client/app-state.svelte';
import type { PageData } from '$lib/client/app-state.svelte';
import type {
  AcquisitionJob,
  DashboardResponse,
  MediaItem,
  ManualReleaseListResponse,
  QueueResponse,
  RequestResponse,
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
  items: [],
  acquisitionJobs: [],
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
      downloadAllowed: true,
      rejectedByArr: false,
      rejectionReasons: [],
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
      cancelAcquisitionJob: vi.fn(),
      cancelQueueItem: vi.fn(),
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
      fetchSearchResults: vi.fn().mockResolvedValue([movieItem]),
      fetchQueue: vi.fn().mockResolvedValue(queueResponse),
      selectManualRelease: vi.fn(),
      submitRequest: vi.fn(),
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

  it('clears selected seasons when the add confirmation resets', () => {
    const state = new AppState(pageData, createDependencies());

    state.openAddConfirm(seriesItem);
    state.toggleConfirmSeason(2);
    state.resetAddConfirm();

    expect(state.confirmAddItem).toBeNull();
    expect(state.confirmSeasonNumbers).toEqual([]);
  });

  it('updates the queue view and request feedback after a successful add', async () => {
    const requestResponse: RequestResponse = {
      existing: false,
      item: {
        ...movieItem,
        inArr: true,
        canAdd: false,
        status: 'Already in Arr',
      },
      message: 'The Matrix was added to Radarr. Acquisition started.',
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
        startedAt: '2026-04-02T10:05:00.000Z',
        updatedAt: '2026-04-02T10:05:00.000Z',
        completedAt: null,
        attempts: [],
      },
    };
    const dependencies = createDependencies({
      api: {
        submitRequest: vi.fn().mockResolvedValue(requestResponse),
      },
      timers: {
        setTimeout: vi.fn().mockReturnValue(99) as unknown as typeof globalThis.setTimeout,
        clearTimeout: vi.fn() as unknown as typeof globalThis.clearTimeout,
      },
    });
    const state = new AppState(pageData, dependencies);
    state.searchResults = [movieItem];
    state.openAddConfirm(movieItem);

    await state.submitRequest(movieItem, state.confirmQualityProfileId);

    expect(state.activeView).toBe('queue');
    expect(state.latestActionMessage).toBeNull();
    expect(state.addSuccessToastMessage).toBe(requestResponse.message);
    expect(state.requestFeedback[movieItem.id]).toContain('Getting started');
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
    const requestResponse: RequestResponse = {
      existing: false,
      item: {
        ...movieItem,
        inArr: true,
        canAdd: false,
        status: 'Already in Arr',
      },
      message: 'The Matrix was added to Radarr.',
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
        startedAt: '2026-04-02T10:05:00.000Z',
        updatedAt: '2026-04-02T10:05:00.000Z',
        completedAt: null,
        attempts: [],
      },
    };
    const dependencies = createDependencies({
      api: {
        submitRequest: vi.fn().mockResolvedValue(requestResponse),
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

    await state.submitRequest(movieItem, state.confirmQualityProfileId);

    expect(state.confirmAddItem).toBeNull();
    expect(state.requesting).toBeNull();
    expect(state.activeView).toBe('queue');
    expect(dependencies.api.fetchQueue).toHaveBeenCalledTimes(1);
    expect(dependencies.api.refreshDashboard).toHaveBeenCalledTimes(1);

    queueRefresh.resolve(queueResponse);
    dashboardRefresh.resolve(dashboardResponse);
    await Promise.all([queueRefresh.promise, dashboardRefresh.promise]);
  });

  it('ignores add-dialog reopen attempts for a short window after a successful request', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);
    const dependencies = createDependencies({
      api: {
        submitRequest: vi.fn().mockResolvedValue({
          existing: false,
          item: {
            ...movieItem,
            inArr: true,
            canAdd: false,
            status: 'Already in Arr',
          },
          message: 'The Matrix was added to Radarr.',
          releaseDecision: null,
          job: null,
        } satisfies RequestResponse),
      },
    });
    const state = new AppState(pageData, dependencies);

    state.openAddConfirm(movieItem);
    await state.submitRequest(movieItem, state.confirmQualityProfileId);

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
        submitRequest: vi.fn().mockResolvedValue({
          existing: false,
          item: {
            ...movieItem,
            inArr: true,
            canAdd: false,
            status: 'Already in Arr',
          },
          message: 'The Matrix was added to Radarr.',
          releaseDecision: null,
          job: null,
        } satisfies RequestResponse),
      },
      storage: {
        savePreferences: vi.fn().mockImplementation(() => {
          throw new Error('localStorage write failed');
        }),
      },
    });
    const state = new AppState(pageData, dependencies);

    state.openAddConfirm(movieItem);
    await state.submitRequest(movieItem, state.confirmQualityProfileId);

    expect(state.confirmAddItem).toBeNull();
    expect(state.requesting).toBeNull();
    expect(state.activeView).toBe('queue');
    expect(state.requestError).toBe('localStorage write failed');
  });

  it('auto clears the add success popup after three seconds', async () => {
    const requestResponse: RequestResponse = {
      existing: false,
      item: {
        ...movieItem,
        inArr: true,
        canAdd: false,
        status: 'Already in Arr',
      },
      message: 'The Matrix was added to Radarr. Acquisition started.',
      releaseDecision: null,
      job: null,
    };
    let toastTimer: (() => void) | null = null;
    const dependencies = createDependencies({
      api: {
        submitRequest: vi.fn().mockResolvedValue(requestResponse),
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

    await state.submitRequest(movieItem, 7);

    expect(state.addSuccessToastMessage).toBe(requestResponse.message);
    expect(toastTimer).not.toBeNull();
    const timer =
      toastTimer ??
      (() => {
        throw new Error('Expected add-success timer handler');
      });
    timer();

    expect(state.addSuccessToastMessage).toBeNull();
  });

  it('opens a Plex operator override as a requestable Arr-backed item', () => {
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

    state.openAddConfirm(plexMergedItem, { operatorOverride: true });

    expect(state.confirmOperatorOverride).toBe(true);
    expect(state.confirmAddItem).toMatchObject({
      canAdd: true,
      sourceService: 'radarr',
      origin: 'arr',
    });
  });

  it('passes selected seasons through the request submission flow for series', async () => {
    const dependencies = createDependencies({
      api: {
        submitRequest: vi.fn().mockResolvedValue({
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
        } satisfies RequestResponse),
      },
    });
    const state = new AppState(pageData, dependencies);

    state.openAddConfirm(seriesItem);
    state.toggleConfirmSeason(2);

    await state.submitRequest(
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

    expect(dependencies.api.submitRequest).toHaveBeenCalledWith(
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
      ...queueResponse,
      acquisitionJobs: [acquisitionJob],
      total: 1,
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

  it('reuses cached manual release results when reopening the same overlay', async () => {
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
      ...queueResponse,
      acquisitionJobs: [acquisitionJob],
      total: 1,
    };

    await state.openManualReleaseList(acquisitionJob.id);
    state.closeManualReleaseList();
    await state.openManualReleaseList(acquisitionJob.id);

    expect(fetchManualReleaseResults).toHaveBeenCalledTimes(1);
    expect(state.activeManualReleaseJobId).toBe(acquisitionJob.id);
  });

  it('matches acquisition jobs to live queue items for derived ETA details', () => {
    const state = new AppState(pageData, createDependencies());
    const matchingQueueItem = {
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
    } as const;

    state.queue = {
      ...queueResponse,
      acquisitionJobs: [acquisitionJob],
      items: [
        {
          ...matchingQueueItem,
          id: 'sonarr:queue:4',
          sourceService: 'sonarr',
        },
        matchingQueueItem,
      ],
      total: 3,
    };

    expect(state.queueItemForAcquisitionJob(acquisitionJob)).toEqual(matchingQueueItem);
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

  it('surfaces attention-needed audit items before verified ones', () => {
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
      ],
    };

    expect(state.auditAttentionItems.map((item) => item.title)).toEqual(['Needs Audio']);
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

    await state.deleteQueueArrItem({
      id: 'radarr:queue:1',
      arrItemId: null,
      canCancel: true,
      kind: 'movie',
      title: 'The Matrix',
      year: 1999,
      poster: null,
      sourceService: 'radarr',
      status: 'Downloading',
      progress: 50,
      timeLeft: '5m',
      estimatedCompletionTime: null,
      size: 1_000,
      sizeLeft: 500,
      queueId: 1,
      detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
    });

    expect(dependencies.api.deleteArrItem).toHaveBeenCalledWith({
      arrItemId: null,
      id: 'radarr:queue:1',
      kind: 'movie',
      queueId: 1,
      sourceService: 'radarr',
      title: 'The Matrix',
    });
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
