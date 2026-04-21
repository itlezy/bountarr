import { afterEach, describe, expect, it, vi } from 'vitest';
import * as arrClient from '$lib/server/arr-client';
import {
  findManualReleaseSelection,
  getManualReleaseResults,
  persistManualSelection,
} from '$lib/server/acquisition-selection';
import { manualSelectionQueuedStatus } from '$lib/server/acquisition-domain';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';

const job: PersistedAcquisitionJob = {
  id: 'job-1',
  itemId: 'movie:603',
  arrItemId: 603,
  kind: 'movie',
  title: 'American History X',
  sourceService: 'radarr',
  status: 'searching',
  attempt: 1,
  maxRetries: 3,
  currentRelease: null,
  selectedReleaser: null,
  preferredReleaser: 'ntb',
  reasonCode: null,
  failureReason: null,
  validationSummary: null,
  autoRetrying: false,
  progress: null,
  queueStatus: 'Searching releases',
  preferences: {
    preferredLanguage: 'English',
    subtitleLanguage: 'English',
  },
  queuedManualSelection: null,
  targetSeasonNumbers: null,
  targetEpisodeIds: null,
  startedAt: '2026-04-13T12:00:00.000Z',
  updatedAt: '2026-04-13T12:00:00.000Z',
  completedAt: null,
  attempts: [],
  failedGuids: [],
};

const seriesJob: PersistedAcquisitionJob = {
  ...job,
  id: 'job-2',
  itemId: 'series:83867',
  arrItemId: 83867,
  kind: 'series',
  title: 'Andor',
  sourceService: 'sonarr',
  targetSeasonNumbers: [1],
  targetEpisodeIds: [101, 102],
};

const queuedManualSelectionInput = {
  manualResults: [
    {
      canSelect: false,
      selectionMode: null,
      blockReason: 'already-selected',
      guid: 'guid-selected',
      identityStatus: 'exact-match',
      indexer: 'Indexer',
      indexerId: 11,
      languages: ['English'],
      protocol: 'torrent',
      reason: 'User selected American.History.X.1998.1080p.WEB-DL-NTb',
      scopeStatus: 'not-applicable',
      explanation: {
        summary: 'User selected American.History.X.1998.1080p.WEB-DL-NTb',
        matchReasons: ['Release title matched American History X'],
        warningReasons: [],
        arrReasons: [],
      },
      score: 500,
      size: 1_000,
      status: 'selected',
      title: 'American.History.X.1998.1080p.WEB-DL-NTb',
    },
  ],
  manualSelectionMode: 'direct',
  mappedReleases: 7,
  releasesFound: 9,
  selectedGuid: 'guid-selected',
  selectedRelease: {
    guid: 'guid-selected',
    indexer: 'Indexer',
    indexerId: 11,
    languages: ['English'],
    protocol: 'torrent',
    reason: 'User selected American.History.X.1998.1080p.WEB-DL-NTb',
    score: 500,
    size: 1_000,
    title: 'American.History.X.1998.1080p.WEB-DL-NTb',
  },
  selection: {
    decision: {
      accepted: 3,
      considered: 7,
      reason: 'User selected American.History.X.1998.1080p.WEB-DL-NTb',
      selected: {
        guid: 'guid-selected',
        indexer: 'Indexer',
        indexerId: 11,
        languages: ['English'],
        protocol: 'torrent',
        reason: 'User selected American.History.X.1998.1080p.WEB-DL-NTb',
        score: 500,
        size: 1_000,
        title: 'American.History.X.1998.1080p.WEB-DL-NTb',
      },
    },
    payload: {
      guid: 'guid-selected',
      indexerId: 11,
    },
  },
} satisfies Parameters<typeof persistManualSelection>[0];

function buildQueuedManualJob(
  overrides: Partial<PersistedAcquisitionJob> = {},
): PersistedAcquisitionJob {
  return {
    ...job,
    queueStatus: manualSelectionQueuedStatus,
    queuedManualSelection: persistManualSelection(queuedManualSelectionInput),
    status: 'queued',
    validationSummary: 'User selected American.History.X.1998.1080p.WEB-DL-NTb',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('acquisition selection', () => {
  it('keeps queued manual selections visible while still refetching live manual results', async () => {
    const arrFetch = vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-selected',
        indexerId: 11,
        indexer: 'Indexer',
        title: 'American.History.X.1998.1080p.WEB-DL-NTb',
        movieTitles: 'American History X',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        qualityWeight: 70,
        releaseWeight: 70,
        customFormatScore: 0,
        size: 1_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
      {
        guid: 'guid-alt',
        indexerId: 12,
        indexer: 'Indexer',
        title: 'American.History.X.1998.1080p.BluRay-ALT',
        movieTitles: 'American History X',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        qualityWeight: 60,
        releaseWeight: 60,
        customFormatScore: 0,
        size: 2_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
    ]);
    const queuedJob = buildQueuedManualJob();

    const results = await getManualReleaseResults(queuedJob);

    expect(arrFetch).toHaveBeenCalledTimes(1);
    expect(results.selectedGuid).toBe('guid-selected');
    expect(results.summary).toBe('User selected American.History.X.1998.1080p.WEB-DL-NTb');
    expect(results.releases).toHaveLength(2);
    expect(results.releases[0]).toMatchObject({
      canSelect: false,
      status: 'selected',
      title: 'American.History.X.1998.1080p.WEB-DL-NTb',
    });
    expect(results.releases[1]).toMatchObject({
      canSelect: true,
      guid: 'guid-alt',
      status: 'accepted',
    });
  });

  it('falls back to the persisted queued manual selection when the live Arr refresh fails', async () => {
    const arrFetch = vi.spyOn(arrClient, 'arrFetch').mockRejectedValue(
      new arrClient.ArrFetchError({
        kind: 'network',
        message: 'Radarr manual search is temporarily unavailable',
        path: '/api/v3/release',
        service: 'radarr',
      }),
    );
    const queuedJob = buildQueuedManualJob();

    const results = await getManualReleaseResults(queuedJob);

    expect(arrFetch).toHaveBeenCalledTimes(1);
    expect(results.selectedGuid).toBe('guid-selected');
    expect(results.summary).toBe('User selected American.History.X.1998.1080p.WEB-DL-NTb');
    expect(results.releases).toEqual([
      expect.objectContaining({
        canSelect: false,
        guid: 'guid-selected',
        status: 'selected',
        title: 'American.History.X.1998.1080p.WEB-DL-NTb',
      }),
    ]);
  });

  it('rethrows unexpected queued manual refresh failures instead of hiding them', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockRejectedValue(new Error('release scoring regression'));
    const queuedJob = buildQueuedManualJob();

    await expect(getManualReleaseResults(queuedJob)).rejects.toThrow('release scoring regression');
  });

  it('keeps Arr-rejected releases directly selectable in manual results', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-accepted',
        indexerId: 11,
        indexer: 'Indexer',
        title: 'American.History.X.1998.1080p.BluRay-LEGi0N',
        movieTitles: 'American History X',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        qualityWeight: 50,
        releaseWeight: 50,
        customFormatScore: 0,
        size: 4_000_000_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
      {
        guid: 'guid-rejected',
        indexerId: 12,
        indexer: 'Indexer',
        title: 'American.History.X.1998.2160p.BluRay-BLOCKED',
        movieTitles: 'American History X',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        qualityWeight: 70,
        releaseWeight: 70,
        customFormatScore: 0,
        size: 8_000_000_000,
        protocol: 'torrent',
        downloadAllowed: false,
        rejected: true,
        rejections: ['Rejected by Arr custom format rules'],
      },
    ]);

    const results = await getManualReleaseResults(job);
    const rejected = results.releases.find((release) => release.guid === 'guid-rejected');

    expect(rejected).toMatchObject({
      canSelect: true,
      selectionMode: 'override-arr-rejection',
      blockReason: null,
      status: 'arr-rejected',
    });
  });

  it('rejects manual selection for releases Arr already marked as not downloadable', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-rejected',
        indexerId: 12,
        indexer: 'Indexer',
        title: 'American.History.X.1998.2160p.BluRay-BLOCKED',
        movieTitles: 'American History X',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        qualityWeight: 70,
        releaseWeight: 70,
        customFormatScore: 0,
        size: 8_000_000_000,
        protocol: 'torrent',
        downloadAllowed: false,
        rejected: true,
        rejections: ['Rejected by Arr custom format rules'],
      },
    ]);

    await expect(findManualReleaseSelection(job, 'guid-rejected', 12, 'direct')).rejects.toThrow(
      'Rejected by Arr custom format rules',
    );
  });

  it('allows manual selection override for releases Arr marked as not downloadable', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-rejected',
        indexerId: 12,
        indexer: 'Indexer',
        title: 'American.History.X.1998.2160p.BluRay-BLOCKED',
        movieTitles: 'American History X',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        qualityWeight: 70,
        releaseWeight: 70,
        customFormatScore: 0,
        size: 8_000_000_000,
        protocol: 'torrent',
        downloadAllowed: false,
        rejected: true,
        rejections: ['Rejected by Arr custom format rules'],
      },
    ]);

    const result = await findManualReleaseSelection(
      job,
      'guid-rejected',
      12,
      'override-arr-rejection',
    );

    expect(result.selectedGuid).toBe('guid-rejected');
    expect(result.manualSelectionMode).toBe('override-arr-rejection');
    expect(result.selection.decision.reason).toContain(
      'User overrode Arr rejection and selected American.History.X.1998.2160p.BluRay-BLOCKED:',
    );
    expect(result.manualResults[0]).toMatchObject({
      canSelect: false,
      selectionMode: null,
      guid: 'guid-rejected',
      status: 'selected',
    });
  });

  it('marks scope-mismatched series releases as not selectable in manual results', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-right-season',
        indexerId: 11,
        indexer: 'Indexer',
        title: 'Andor.S01.1080p.WEB-DL-FLUX',
        seriesTitles: 'Andor',
        mappedSeriesId: 83867,
        languages: [{ name: 'English' }],
        qualityWeight: 70,
        releaseWeight: 70,
        customFormatScore: 0,
        size: 8_000_000_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
      {
        guid: 'guid-wrong-season',
        indexerId: 12,
        indexer: 'Indexer',
        title: 'Andor.S02.1080p.WEB-DL-FLUX',
        seriesTitles: 'Andor',
        mappedSeriesId: 83867,
        languages: [{ name: 'English' }],
        qualityWeight: 80,
        releaseWeight: 80,
        customFormatScore: 0,
        size: 8_500_000_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
    ]);

    const results = await getManualReleaseResults(seriesJob);
    const wrongSeason = results.releases.find((release) => release.guid === 'guid-wrong-season');

    expect(wrongSeason).toMatchObject({
      canSelect: false,
      blockReason: 'scope-mismatch',
      scopeStatus: 'mismatch',
      explanation: {
        warningReasons: ['Release scope targets different seasons.'],
      },
      status: 'locally-rejected',
    });
  });

  it('rejects manual selection for releases outside the targeted series scope', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-wrong-season',
        indexerId: 12,
        indexer: 'Indexer',
        title: 'Andor.S02.1080p.WEB-DL-FLUX',
        seriesTitles: 'Andor',
        mappedSeriesId: 83867,
        languages: [{ name: 'English' }],
        qualityWeight: 80,
        releaseWeight: 80,
        customFormatScore: 0,
        size: 8_500_000_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
    ]);

    await expect(
      findManualReleaseSelection(seriesJob, 'guid-wrong-season', 12, 'direct'),
    ).rejects.toThrow('Release scope targets different seasons.');
  });

  it('keeps rejecting out-of-scope series releases even when Arr override is requested', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-wrong-season',
        indexerId: 12,
        indexer: 'Indexer',
        title: 'Andor.S02.1080p.WEB-DL-FLUX',
        seriesTitles: 'Andor',
        mappedSeriesId: 83867,
        languages: [{ name: 'English' }],
        qualityWeight: 80,
        releaseWeight: 80,
        customFormatScore: 0,
        size: 8_500_000_000,
        protocol: 'torrent',
        downloadAllowed: false,
        rejected: true,
        rejections: ['Rejected by Arr custom format rules'],
      },
    ]);

    await expect(
      findManualReleaseSelection(seriesJob, 'guid-wrong-season', 12, 'override-arr-rejection'),
    ).rejects.toThrow('Release scope targets different seasons.');
  });

  it('marks partially overlapping series releases as not selectable in manual results', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-partial-target',
        indexerId: 13,
        indexer: 'Indexer',
        title: 'Andor.S01E01.1080p.WEB-DL-FLUX',
        seriesTitles: 'Andor',
        mappedSeriesId: 83867,
        episodeIds: [101],
        seasonNumbers: [1],
        languages: [{ name: 'English' }],
        qualityWeight: 85,
        releaseWeight: 85,
        customFormatScore: 0,
        size: 4_200_000_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
    ]);

    const results = await getManualReleaseResults(seriesJob);
    const partialTarget = results.releases.find(
      (release) => release.guid === 'guid-partial-target',
    );

    expect(partialTarget).toMatchObject({
      canSelect: false,
      blockReason: 'scope-mismatch',
      scopeStatus: 'partial',
      explanation: {
        warningReasons: [
          'Release appears to cover individual episodes within the targeted seasons.',
        ],
      },
      status: 'locally-rejected',
    });
  });

  it('rejects manual selection for partially overlapping series releases', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-partial-target',
        indexerId: 13,
        indexer: 'Indexer',
        title: 'Andor.S01E01.1080p.WEB-DL-FLUX',
        seriesTitles: 'Andor',
        mappedSeriesId: 83867,
        episodeIds: [101],
        seasonNumbers: [1],
        languages: [{ name: 'English' }],
        qualityWeight: 85,
        releaseWeight: 85,
        customFormatScore: 0,
        size: 4_200_000_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
    ]);

    await expect(
      findManualReleaseSelection(seriesJob, 'guid-partial-target', 13, 'direct'),
    ).rejects.toThrow('Release appears to cover individual episodes within the targeted seasons.');
  });

  it('rejects manual selection for series releases with unknown scope', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-unknown-scope',
        indexerId: 14,
        indexer: 'Indexer',
        title: 'Andor.1080p.WEB-DL-FLUX',
        seriesTitles: 'Andor',
        mappedSeriesId: 83867,
        languages: [{ name: 'English' }],
        qualityWeight: 90,
        releaseWeight: 90,
        customFormatScore: 0,
        size: 8_200_000_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
    ]);

    const results = await getManualReleaseResults(seriesJob);
    const unknownScope = results.releases.find((release) => release.guid === 'guid-unknown-scope');

    expect(unknownScope).toMatchObject({
      canSelect: false,
      blockReason: 'scope-mismatch',
      scopeStatus: 'unknown',
      explanation: {
        warningReasons: ['The release does not expose season or episode scope.'],
      },
      status: 'locally-rejected',
    });
    await expect(
      findManualReleaseSelection(seriesJob, 'guid-unknown-scope', 14, 'direct'),
    ).rejects.toThrow('The release does not expose season or episode scope.');
  });
});
