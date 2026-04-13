import type {
  AcquisitionJob,
  AcquisitionJobActionResponse,
  GrabResponse,
  ManualReleaseListResponse,
  ManualReleaseResult,
  MediaItem,
  QueueItem,
  QueueResponse,
} from '$lib/shared/types';

export const configStatusFixture = {
  radarrConfigured: true,
  sonarrConfigured: true,
  plexConfigured: false,
  configured: true,
  radarrQualityProfiles: [{ id: 1, isDefault: true, name: 'HD-1080p' }],
  sonarrQualityProfiles: [{ id: 2, isDefault: true, name: 'Series-HD' }],
  defaultRadarrQualityProfileId: 1,
  defaultSonarrQualityProfileId: 2,
  radarrStats: {
    qualityProfileCount: 1,
    rootFolderCount: 1,
    queueCount: 0,
    defaultQualityProfileName: 'HD-1080p',
    primaryRootFolderPath: 'C:\\Media\\Movies',
  },
  sonarrStats: {
    qualityProfileCount: 1,
    rootFolderCount: 1,
    queueCount: 0,
    defaultQualityProfileName: 'Series-HD',
    primaryRootFolderPath: 'C:\\Media\\Shows',
  },
  plexStats: {
    libraryCount: 0,
    movieLibraryCount: 0,
    showLibraryCount: 0,
    libraryTitles: [],
  },
  runtime: {
    checkedAt: '2026-04-13T12:00:00.000Z',
    healthy: true,
    issues: [],
    warnings: [],
    logFilePath: 'C:\\prj\\p2p\\bountarr\\data\\logs\\backend.log',
    logLevel: 'info',
    dataPath: 'C:\\prj\\p2p\\bountarr\\data',
    storagePath: 'C:\\prj\\p2p\\bountarr\\data',
    freeSpaceBytes: 512_000_000_000,
    totalSpaceBytes: 1_024_000_000_000,
    databasePath: 'C:\\prj\\p2p\\bountarr\\data\\acquisition.db',
    databaseSizeBytes: 2_097_152,
    databaseJobCount: 0,
    databaseAttemptCount: 0,
    databaseEventCount: 0,
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
  },
};

export const emptyDashboardResponse = {
  updatedAt: '2026-04-13T12:00:00.000Z',
  items: [],
  summary: {
    total: 0,
    verified: 0,
    pending: 0,
    attention: 0,
  },
};

export const emptyQueueResponse = {
  updatedAt: '2026-04-13T12:00:00.000Z',
  items: [],
  acquisitionJobs: [],
  total: 0,
};

export const acquisitionJobFixture: AcquisitionJob = {
  id: 'job-series-andor',
  itemId: 'series:83867',
  arrItemId: 83867,
  kind: 'series',
  title: 'Andor',
  sourceService: 'sonarr',
  status: 'searching',
  attempt: 2,
  maxRetries: 4,
  currentRelease: null,
  selectedReleaser: null,
  preferredReleaser: 'flux',
  reasonCode: null,
  failureReason: null,
  validationSummary: 'Waiting for a manual release choice.',
  autoRetrying: false,
  progress: 42,
  queueStatus: 'Queued',
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'English',
  },
  startedAt: '2026-04-13T11:58:00.000Z',
  updatedAt: '2026-04-13T12:00:00.000Z',
  completedAt: null,
  attempts: [
    {
      attempt: 1,
      status: 'queued',
      reasonCode: null,
      releaseTitle: null,
      releaser: null,
      reason: null,
      startedAt: '2026-04-13T11:58:00.000Z',
      finishedAt: '2026-04-13T11:58:05.000Z',
    },
    {
      attempt: 2,
      status: 'searching',
      reasonCode: null,
      releaseTitle: null,
      releaser: null,
      reason: 'Manual search requested',
      startedAt: '2026-04-13T11:59:00.000Z',
      finishedAt: null,
    },
  ],
};

export const queueItemFixture: QueueItem = {
  id: 'radarr:queue:1',
  arrItemId: 603,
  canCancel: true,
  kind: 'movie',
  title: 'The Matrix',
  year: 1999,
  poster: 'https://img.example/matrix.jpg',
  sourceService: 'radarr',
  status: 'Downloading',
  progress: 75,
  timeLeft: '10m',
  estimatedCompletionTime: '2026-04-13T12:10:00.000Z',
  size: 1_000_000_000,
  sizeLeft: 250_000_000,
  queueId: 1,
  detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
};

export function buildQueueResponse(
  acquisitionJobs: AcquisitionJob[] = [acquisitionJobFixture],
  items: QueueItem[] = [queueItemFixture],
): QueueResponse {
  return {
    updatedAt: '2026-04-13T12:00:00.000Z',
    items,
    acquisitionJobs,
    total: acquisitionJobs.length + items.length,
  };
}

export const queueWithActivityResponse = buildQueueResponse();

export const manualReleaseFixture: ManualReleaseResult = {
  title: 'Andor.S01.1080p.WEB-DL-FLUX',
  guid: 'guid-andor-1',
  indexer: 'Indexer One',
  indexerId: 11,
  protocol: 'torrent',
  size: 4_000_000_000,
  languages: ['English'],
  score: 160,
  reason: 'Matched the preferred releaser.',
  canSelect: true,
  downloadAllowed: true,
  rejectedByArr: false,
  rejectionReasons: [],
  status: 'accepted',
};

export const manualReleaseRejectedFixture: ManualReleaseResult = {
  title: 'Andor.S01.2160p.BluRay-BADGROUP',
  guid: 'guid-andor-2',
  indexer: 'Indexer Two',
  indexerId: 12,
  protocol: 'torrent',
  size: 18_000_000_000,
  languages: ['English', 'Spanish'],
  score: 90,
  reason: 'Rejected locally because it does not match the selected releaser.',
  canSelect: false,
  downloadAllowed: false,
  rejectedByArr: true,
  rejectionReasons: ['Custom format score too low'],
  status: 'arr-rejected',
};

export const manualReleaseListFixture: ManualReleaseListResponse = {
  jobId: acquisitionJobFixture.id,
  releases: [manualReleaseFixture, manualReleaseRejectedFixture],
  selectedGuid: null,
  summary: 'Two manual-search releases are available.',
  updatedAt: '2026-04-13T12:00:00.000Z',
};

export const emptyManualReleaseListFixture: ManualReleaseListResponse = {
  jobId: acquisitionJobFixture.id,
  releases: [],
  selectedGuid: null,
  summary: 'No manual-search releases were returned by Arr.',
  updatedAt: '2026-04-13T12:00:00.000Z',
};

export const movieSearchItem: MediaItem = {
  id: 'movie:603',
  arrItemId: null,
  kind: 'movie',
  title: 'The Matrix',
  year: 1999,
  rating: 8.7,
  poster: 'https://img.example/matrix.jpg',
  overview: 'A computer hacker learns about the true nature of reality.',
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
  requestPayload: {
    id: 603,
    tmdbId: 603,
    title: 'The Matrix',
    year: 1999,
  },
};

export const seriesSearchItem: MediaItem = {
  id: 'series:83867',
  arrItemId: null,
  kind: 'series',
  title: 'Andor',
  year: 2022,
  rating: 8.4,
  poster: 'https://img.example/andor.jpg',
  overview: 'Cassian Andor begins the path toward rebellion.',
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
    id: 83867,
    tvdbId: 361753,
    title: 'Andor',
    year: 2022,
    seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
  },
};

export function searchResultsForQuery(query: string): unknown[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.includes('matrix')) {
    return [movieSearchItem];
  }

  if (normalized.includes('andor')) {
    return [seriesSearchItem];
  }

  if (normalized.length >= 2) {
    return [movieSearchItem, seriesSearchItem];
  }

  return [];
}

type GrabItem = typeof movieSearchItem | typeof seriesSearchItem;

export function buildGrabResponse(
  item: GrabItem,
  seasonNumbers?: number[],
): GrabResponse {
  const requestedItem = {
    ...item,
    arrItemId: item.kind === 'movie' ? 603 : 83867,
    canAdd: false,
    inArr: true,
    isExisting: true,
    isRequested: true,
    status: item.kind === 'movie' ? 'Queued in Radarr' : 'Queued in Sonarr',
  };

  return {
    existing: false,
    item: requestedItem,
    message: `${item.title} was added to ${item.kind === 'movie' ? 'Radarr' : 'Sonarr'}.`,
    releaseDecision: null,
    job: {
      id: `job-${item.id}`,
      itemId: item.id,
      arrItemId: requestedItem.arrItemId,
      kind: item.kind,
      title: item.title,
      sourceService: item.kind === 'movie' ? 'radarr' : 'sonarr',
      status: 'queued',
      attempt: 1,
      maxRetries: 3,
      currentRelease: null,
      selectedReleaser: null,
      preferredReleaser: null,
      reasonCode: null,
      failureReason: null,
      validationSummary: seasonNumbers?.length
        ? `Monitoring seasons ${seasonNumbers.join(', ')}`
        : null,
      autoRetrying: false,
      progress: null,
      queueStatus: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      startedAt: '2026-04-13T12:00:00.000Z',
      updatedAt: '2026-04-13T12:00:00.000Z',
      completedAt: null,
      attempts: [
        {
          attempt: 1,
          status: 'queued',
          reasonCode: null,
          releaseTitle: null,
          releaser: null,
          reason: null,
          startedAt: '2026-04-13T12:00:00.000Z',
          finishedAt: null,
        },
      ],
    },
  };
}

export function buildSelectedManualReleaseList(
  guid = manualReleaseFixture.guid,
): ManualReleaseListResponse {
  return {
    ...manualReleaseListFixture,
    selectedGuid: guid,
    releases: manualReleaseListFixture.releases.map((release) =>
      release.guid === guid
        ? {
            ...release,
            canSelect: false,
            status: 'selected',
          }
        : release,
    ),
    summary: 'One manual-search release was selected.',
  };
}

export function buildSelectedJob(): AcquisitionJob {
  return {
    ...acquisitionJobFixture,
    status: 'grabbing',
    currentRelease: manualReleaseFixture.title,
    selectedReleaser: 'flux',
    validationSummary: 'Manual release selected and sent to the downloader.',
    progress: 58,
    queueStatus: 'Sending to downloader',
    attempts: [
      ...acquisitionJobFixture.attempts,
      {
        attempt: 2,
        status: 'grabbing',
        reasonCode: null,
        releaseTitle: manualReleaseFixture.title,
        releaser: 'flux',
        reason: 'Manual release selected',
        startedAt: '2026-04-13T12:00:00.000Z',
        finishedAt: null,
      },
    ],
  };
}

export function buildManualReleaseSelectionResponse(): AcquisitionJobActionResponse {
  return {
    job: buildSelectedJob(),
    message: 'Manual release selected. Sending Andor to the downloader.',
  };
}
