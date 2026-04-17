import type {
  AcquisitionJob,
  AcquisitionResponse,
  ConfigStatus,
  DashboardResponse,
  GrabResponse,
  HealthResponse,
  ManagedQueueLiveSummary,
  MediaItem,
  QueueEntry,
  QueueItem,
  QueueResponse,
  RuntimeHealth,
} from '$lib/shared/types';

export const runtimeHealthFixture: RuntimeHealth = {
  checkedAt: '2026-04-02T12:00:00.000Z',
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
      driveLetter: 'F:',
      mountPoint: 'F:\\',
      label: 'Media',
      fileSystem: 'NTFS',
      freeSpaceBytes: 2_611_200_000_000,
      totalSpaceBytes: 5_589_000_000_000,
    },
    {
      driveLetter: null,
      mountPoint: 'C:\\M\\Archive\\',
      label: 'Archive',
      fileSystem: 'NTFS',
      freeSpaceBytes: 4_487_500_000_000,
      totalSpaceBytes: 18_627_000_000_000,
    },
    {
      driveLetter: null,
      mountPoint: 'C:\\M\\Full\\',
      label: 'Full',
      fileSystem: 'NTFS',
      freeSpaceBytes: 0,
      totalSpaceBytes: 16_000_898_547_712,
    },
  ],
};

export const mediaItemFixture: MediaItem = {
  id: 'movie:603',
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

export const configStatusFixture: ConfigStatus = {
  radarrConfigured: true,
  sonarrConfigured: true,
  plexConfigured: true,
  configured: true,
  radarrQualityProfiles: [{ id: 1, isDefault: true, name: 'HD-1080p' }],
  sonarrQualityProfiles: [{ id: 2, isDefault: true, name: 'Series-HD' }],
  defaultRadarrQualityProfileId: 1,
  defaultSonarrQualityProfileId: 2,
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
  runtime: runtimeHealthFixture,
};

export const healthResponseFixture: HealthResponse = {
  checkedAt: runtimeHealthFixture.checkedAt,
  status: 'ok',
  configured: true,
  services: {
    radarr: true,
    sonarr: true,
    plex: true,
  },
  runtime: runtimeHealthFixture,
};

export const dashboardResponseFixture: DashboardResponse = {
  updatedAt: runtimeHealthFixture.checkedAt,
  items: [
    {
      ...mediaItemFixture,
      auditStatus: 'missing-language',
      inArr: true,
      canAdd: false,
      isExisting: true,
      isRequested: true,
      status: 'Downloaded',
    },
  ],
  summary: {
    total: 1,
    verified: 0,
    pending: 0,
    attention: 1,
  },
};

export const queueResponseFixture: QueueResponse = {
  updatedAt: runtimeHealthFixture.checkedAt,
  entries: [],
  total: 0,
};

const queueItemFixture: QueueItem = {
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
  estimatedCompletionTime: '2026-04-02T12:10:00.000Z',
  size: 1_000_000_000,
  sizeLeft: 250_000_000,
  queueId: 1,
  detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
  episodeIds: null,
  seasonNumbers: null,
};

const acquisitionJobFixture: AcquisitionJob = {
  id: 'job-1',
  itemId: mediaItemFixture.id,
  arrItemId: 603,
  kind: 'movie',
  title: 'The Matrix',
  sourceService: 'radarr',
  status: 'validating',
  attempt: 1,
  maxRetries: 3,
  currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
  selectedReleaser: 'flux',
  preferredReleaser: 'flux',
  reasonCode: null,
  failureReason: null,
  validationSummary: null,
  autoRetrying: false,
  progress: 75,
  queueStatus: 'Downloading',
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'English',
  },
  targetSeasonNumbers: null,
  targetEpisodeIds: null,
  startedAt: '2026-04-02T12:00:00.000Z',
  updatedAt: '2026-04-02T12:05:00.000Z',
  completedAt: null,
  attempts: [
    {
      attempt: 1,
      status: 'validating',
      reasonCode: null,
      releaseTitle: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      releaser: 'flux',
      reason: null,
      startedAt: '2026-04-02T12:00:00.000Z',
      finishedAt: null,
    },
  ],
};

function buildManagedLiveSummary(items: QueueItem[]): ManagedQueueLiveSummary | null {
  if (items.length === 0) {
    return null;
  }

  const withSize = items.filter((item) => item.size !== null && item.sizeLeft !== null);
  return {
    rowCount: items.length,
    progress:
      items.reduce((sum, item) => sum + (item.progress ?? 0), 0) /
      Math.max(1, items.filter((item) => item.progress !== null).length),
    status: items.length === 1 ? items[0]?.status ?? null : `${items.length} live downloads active`,
    timeLeft: items.find((item) => item.timeLeft)?.timeLeft ?? null,
    estimatedCompletionTime:
      items.find((item) => item.estimatedCompletionTime)?.estimatedCompletionTime ?? null,
    size: withSize.length > 0 ? withSize.reduce((sum, item) => sum + (item.size ?? 0), 0) : null,
    sizeLeft:
      withSize.length > 0 ? withSize.reduce((sum, item) => sum + (item.sizeLeft ?? 0), 0) : null,
    byteMetricsPartial: withSize.length !== items.length,
  };
}

const queueEntriesFixture: QueueEntry[] = [
  {
    kind: 'managed',
    id: acquisitionJobFixture.id,
    job: acquisitionJobFixture,
    liveQueueItems: [queueItemFixture],
    liveSummary: buildManagedLiveSummary([queueItemFixture]),
    canCancel: true,
    canRemove: true,
  },
];

queueResponseFixture.entries = queueEntriesFixture;
queueResponseFixture.total = queueEntriesFixture.length;

export const grabResponseFixture: GrabResponse = {
  existing: true,
  item: {
    ...mediaItemFixture,
    canAdd: false,
    inArr: true,
    isExisting: true,
    isRequested: true,
    status: 'Already in Arr',
  },
  message: 'The Matrix is already tracked in Radarr',
  releaseDecision: null,
  job: acquisitionJobFixture,
};

export const acquisitionResponseFixture: AcquisitionResponse = {
  updatedAt: runtimeHealthFixture.checkedAt,
  jobs: [acquisitionJobFixture],
};
