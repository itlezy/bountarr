import { afterEach, describe, expect, it, vi } from 'vitest';
import * as arrClient from '$lib/server/arr-client';
import {
  findReleaseSelection,
  findManualReleaseSelection,
  getManualReleaseResults,
  persistManualSelection,
  submitSelectedRelease,
} from '$lib/server/acquisition-selection';
import { manualSelectionQueuedStatus } from '$lib/server/acquisition-domain';
import type { PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import type { PersistedAcquisitionReleaseCandidate } from '$lib/server/acquisition-domain';

const job: PersistedAcquisitionJob = {
  id: 'job-1',
  itemId: 'movie:603',
  arrItemId: 603,
  kind: 'movie',
  title: 'Fixture History',
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
  title: 'Fixture Series',
  sourceService: 'sonarr',
  targetSeasonNumbers: [1],
  targetEpisodeIds: [101, 102],
};

function failedReleaseCandidate(
  overrides: Partial<PersistedAcquisitionReleaseCandidate>,
): PersistedAcquisitionReleaseCandidate {
  return {
    acceptedByLocalRules: true,
    arrRejected: false,
    attempt: 1,
    autoSelectable: true,
    detectedAudioLanguages: ['English'],
    detectedSubtitleLanguages: [],
    failedAt: '2026-04-13T12:05:00.000Z',
    failureReason: 'Imported file is missing the selected subtitle language.',
    firstSeenAt: '2026-04-13T12:00:00.000Z',
    guid: 'guid-failed',
    identityReason: 'Structured movie title matched Fixture History',
    identityStatus: 'exact-match',
    indexer: 'Indexer',
    indexerId: 11,
    languages: ['English'],
    lastSeenAt: '2026-04-13T12:00:00.000Z',
    payload: {},
    protocol: 'torrent',
    reason: 'previous failed release',
    rejectionReasons: [],
    scopeReason: null,
    scopeStatus: 'not-applicable',
    score: 500,
    selectionMode: 'direct',
    size: 1_000,
    status: 'failed',
    title: 'Fixture.History.1998.1080p.WEB-DL-FAILED',
    ...overrides,
  };
}

function mappedMovieRelease(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    guid: 'guid-fallback',
    indexerId: 11,
    indexer: 'Indexer',
    title: 'Fixture.History.1998.1080p.WEB-DL-FALLBACK',
    movieTitles: 'Fixture History',
    mappedMovieId: 603,
    languages: [{ name: 'English' }],
    qualityWeight: 70,
    releaseWeight: 70,
    customFormatScore: 0,
    size: 1_000,
    protocol: 'torrent',
    downloadAllowed: true,
    ...overrides,
  };
}

function mockMovieProfileFallbackSearch(releasesByProfileId: Record<number, unknown[]>) {
  let currentQualityProfileId = 4;
  return vi.spyOn(arrClient, 'arrFetch').mockImplementation(async (_service, path, options) => {
    if (path === '/api/v3/release') {
      return releasesByProfileId[currentQualityProfileId] ?? [];
    }

    if (path === '/api/v3/qualityprofile') {
      return [
        { id: 1, name: 'Any' },
        { id: 4, name: 'HD-1080p' },
        { id: 8, name: 'AnyAnyLang' },
      ];
    }

    if (path === '/api/v3/movie/603') {
      if ((options as { method?: string } | undefined)?.method === 'PUT') {
        const body = JSON.parse(String((options as { body: string }).body)) as {
          qualityProfileId: number;
        };
        currentQualityProfileId = body.qualityProfileId;
      }

      return {
        id: 603,
        title: 'Fixture History',
        qualityProfileId: currentQualityProfileId,
      };
    }

    throw new Error(`Unexpected Arr request for ${path}`);
  });
}

function movieQualityProfileUpdateIds(
  arrFetch: ReturnType<typeof mockMovieProfileFallbackSearch>,
): number[] {
  return arrFetch.mock.calls.flatMap(([, path, options]) => {
    if (
      path !== '/api/v3/movie/603' ||
      (options as { method?: string } | undefined)?.method !== 'PUT'
    ) {
      return [];
    }

    const body = JSON.parse(String((options as { body: string }).body)) as {
      qualityProfileId: number;
    };
    return [body.qualityProfileId];
  });
}

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
      reason: 'User selected Fixture.History.1998.1080p.WEB-DL-NTb',
      scopeStatus: 'not-applicable',
      explanation: {
        summary: 'User selected Fixture.History.1998.1080p.WEB-DL-NTb',
        matchReasons: ['Release title matched Fixture History'],
        warningReasons: [],
        arrReasons: [],
      },
      score: 500,
      size: 1_000,
      status: 'selected',
      title: 'Fixture.History.1998.1080p.WEB-DL-NTb',
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
    reason: 'User selected Fixture.History.1998.1080p.WEB-DL-NTb',
    score: 500,
    size: 1_000,
    title: 'Fixture.History.1998.1080p.WEB-DL-NTb',
  },
  selection: {
    decision: {
      accepted: 3,
      considered: 7,
      reason: 'User selected Fixture.History.1998.1080p.WEB-DL-NTb',
      selected: {
        guid: 'guid-selected',
        indexer: 'Indexer',
        indexerId: 11,
        languages: ['English'],
        protocol: 'torrent',
        reason: 'User selected Fixture.History.1998.1080p.WEB-DL-NTb',
        score: 500,
        size: 1_000,
        title: 'Fixture.History.1998.1080p.WEB-DL-NTb',
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
    validationSummary: 'User selected Fixture.History.1998.1080p.WEB-DL-NTb',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('acquisition selection', () => {
  it('relaxes a movie search to the Any quality profile when the initial profile has no mapped releases', async () => {
    const arrFetch = mockMovieProfileFallbackSearch({
      1: [mappedMovieRelease({ guid: 'guid-any' })],
    });

    const result = await findReleaseSelection({
      ...job,
      qualityProfileId: 4,
    });

    expect(result.selectedGuid).toBe('guid-any');
    expect(result.mappedReleases).toBe(1);
    expect(movieQualityProfileUpdateIds(arrFetch)).toEqual([1]);
  });

  it('continues relaxing a movie search to AnyAnyLang when Any has no mapped releases', async () => {
    const arrFetch = mockMovieProfileFallbackSearch({
      8: [mappedMovieRelease({ guid: 'guid-any-any-lang' })],
    });

    const result = await findReleaseSelection({
      ...job,
      qualityProfileId: 4,
    });

    expect(result.selectedGuid).toBe('guid-any-any-lang');
    expect(result.mappedReleases).toBe(1);
    expect(movieQualityProfileUpdateIds(arrFetch)).toEqual([1, 8]);
  });

  it('restores the original movie quality profile when relaxed searches still find no releases', async () => {
    const arrFetch = mockMovieProfileFallbackSearch({});

    const result = await findReleaseSelection({
      ...job,
      qualityProfileId: 4,
    });

    expect(result.selectedGuid).toBeNull();
    expect(result.mappedReleases).toBe(0);
    expect(movieQualityProfileUpdateIds(arrFetch)).toEqual([1, 8, 4]);
  });

  it('keeps Radarr unknown-movie releases visible when their titles match the movie search', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-unknown-movie',
        indexerId: 11,
        indexer: 'Indexer',
        title: 'Fixture.History.1998.480p.WEB-DL-GROUP',
        movieTitles: 'Fixture History',
        mappedMovieId: null,
        languages: [{ name: 'English' }],
        qualityWeight: 10,
        releaseWeight: 10,
        customFormatScore: 0,
        size: 700_000_000,
        protocol: 'usenet',
        downloadAllowed: false,
        rejected: true,
        rejections: ['Unknown Movie. Unable to match to correct movie using release title.'],
      },
    ]);

    const result = await findReleaseSelection(job);

    expect(result.mappedReleases).toBe(1);
    expect(result.selectedGuid).toBeNull();
    expect(result.manualResults).toEqual([
      expect.objectContaining({
        blockReason: null,
        canSelect: true,
        guid: 'guid-unknown-movie',
        selectionMode: 'override-arr-rejection',
        status: 'arr-rejected',
      }),
    ]);
  });

  it('keeps title-mismatched unknown-movie releases visible but not selectable', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-wrong-movie',
        indexerId: 11,
        indexer: 'Indexer',
        title: 'Different.Movie.1998.480p.WEB-DL-GROUP',
        movieTitles: 'Different Movie',
        mappedMovieId: null,
        languages: [{ name: 'English' }],
        qualityWeight: 10,
        releaseWeight: 10,
        customFormatScore: 0,
        size: 700_000_000,
        protocol: 'usenet',
        downloadAllowed: false,
        rejected: true,
        rejections: ['Unknown Movie. Unable to match to correct movie using release title.'],
      },
    ]);

    const result = await findReleaseSelection(job);

    expect(result.mappedReleases).toBe(1);
    expect(result.manualResults).toEqual([
      expect.objectContaining({
        blockReason: 'title-mismatch',
        canSelect: false,
        guid: 'guid-wrong-movie',
        selectionMode: null,
        status: 'locally-rejected',
      }),
    ]);
  });

  it('keeps queued manual selections visible while still refetching live manual results', async () => {
    const arrFetch = vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-selected',
        indexerId: 11,
        indexer: 'Indexer',
        title: 'Fixture.History.1998.1080p.WEB-DL-NTb',
        movieTitles: 'Fixture History',
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
        title: 'Fixture.History.1998.1080p.BluRay-ALT',
        movieTitles: 'Fixture History',
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
    expect(results.summary).toBe('User selected Fixture.History.1998.1080p.WEB-DL-NTb');
    expect(results.releases).toHaveLength(2);
    expect(results.releases[0]).toMatchObject({
      canSelect: false,
      status: 'selected',
      title: 'Fixture.History.1998.1080p.WEB-DL-NTb',
    });
    expect(results.releases[1]).toMatchObject({
      canSelect: true,
      guid: 'guid-alt',
      status: 'accepted',
    });
  });

  it('passes validation failure context into automatic retry selection', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-no-sub-hint',
        indexerId: 11,
        indexer: 'Indexer',
        title: 'Fixture.History.1998.1080p.WEB-DL.ENG-FAST',
        movieTitles: 'Fixture History',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        qualityWeight: 160,
        releaseWeight: 70,
        customFormatScore: 0,
        size: 1_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
      {
        guid: 'guid-sub-hint',
        indexerId: 12,
        indexer: 'Indexer',
        title: 'Fixture.History.1998.1080p.WEB-DL.ENG.SUBS-SURE',
        movieTitles: 'Fixture History',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        qualityWeight: 70,
        releaseWeight: 70,
        customFormatScore: 0,
        size: 900,
        protocol: 'torrent',
        downloadAllowed: true,
      },
    ]);

    const result = await findReleaseSelection({
      ...job,
      attempt: 2,
      failedGuids: ['guid-previous'],
      reasonCode: 'missing-subs',
      status: 'retrying',
    });

    expect(result.selectedGuid).toBe('guid-sub-hint');
    expect(result.selection.decision.reason).toContain('retry prefers English subtitle title hint');
  });

  it('excludes the failed release even when retry scoring would otherwise prefer it', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-failed-best',
        indexerId: 11,
        indexer: 'Indexer',
        title: 'Fixture.History.1998.1080p.WEB-DL.ENG.SUBS-FLUX',
        movieTitles: 'Fixture History',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        subtitles: [{ language: { name: 'English' } }],
        qualityWeight: 180,
        releaseWeight: 70,
        customFormatScore: 0,
        size: 1_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
      {
        guid: 'guid-next-best',
        indexerId: 12,
        indexer: 'Indexer',
        title: 'Fixture.History.1998.1080p.WEB-DL.ENG.SUBS-SURE',
        movieTitles: 'Fixture History',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        qualityWeight: 70,
        releaseWeight: 70,
        customFormatScore: 0,
        size: 900,
        protocol: 'torrent',
        downloadAllowed: true,
      },
    ]);

    const result = await findReleaseSelection({
      ...job,
      attempt: 2,
      failedGuids: ['guid-failed-best'],
      reasonCode: 'missing-subs',
      status: 'retrying',
    });

    const failed = result.manualResults.find((release) => release.guid === 'guid-failed-best');

    expect(result.selectedGuid).toBe('guid-next-best');
    expect(failed?.status).toBe('previously-failed');
  });

  it('tracks failed release identity by guid and indexer instead of guid alone', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-shared',
        indexerId: 11,
        indexer: 'Indexer',
        title: 'Fixture.History.1998.1080p.WEB-DL.ENG.SUBS-FAILED',
        movieTitles: 'Fixture History',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        subtitles: [{ language: { name: 'English' } }],
        qualityWeight: 180,
        releaseWeight: 70,
        customFormatScore: 0,
        size: 1_000,
        protocol: 'torrent',
        downloadAllowed: true,
      },
      {
        guid: 'guid-shared',
        indexerId: 12,
        indexer: 'Other Indexer',
        title: 'Fixture.History.1998.1080p.WEB-DL.ENG.SUBS-ALTERNATE',
        movieTitles: 'Fixture History',
        mappedMovieId: 603,
        languages: [{ name: 'English' }],
        subtitles: [{ language: { name: 'English' } }],
        qualityWeight: 90,
        releaseWeight: 70,
        customFormatScore: 0,
        size: 900,
        protocol: 'torrent',
        downloadAllowed: true,
      },
    ]);

    const result = await findReleaseSelection({
      ...job,
      attempt: 2,
      reasonCode: 'missing-subs',
      status: 'retrying',
      releaseCandidates: [
        failedReleaseCandidate({
          guid: 'guid-shared',
          indexerId: 11,
        }),
      ],
    });

    const failed = result.manualResults.find(
      (release) => release.guid === 'guid-shared' && release.indexerId === 11,
    );

    expect(result.selectedRelease).toMatchObject({
      guid: 'guid-shared',
      indexerId: 12,
    });
    expect(failed?.status).toBe('previously-failed');
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
    expect(results.summary).toBe('User selected Fixture.History.1998.1080p.WEB-DL-NTb');
    expect(results.releases).toEqual([
      expect.objectContaining({
        canSelect: false,
        guid: 'guid-selected',
        status: 'selected',
        title: 'Fixture.History.1998.1080p.WEB-DL-NTb',
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
        title: 'Fixture.History.1998.1080p.BluRay-LEGi0N',
        movieTitles: 'Fixture History',
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
        title: 'Fixture.History.1998.2160p.BluRay-BLOCKED',
        movieTitles: 'Fixture History',
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
        title: 'Fixture.History.1998.2160p.BluRay-BLOCKED',
        movieTitles: 'Fixture History',
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
        title: 'Fixture.History.1998.2160p.BluRay-BLOCKED',
        movieTitles: 'Fixture History',
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
      'User overrode Arr rejection and selected Fixture.History.1998.2160p.BluRay-BLOCKED:',
    );
    expect(result.manualResults[0]).toMatchObject({
      canSelect: false,
      selectionMode: null,
      guid: 'guid-rejected',
      status: 'selected',
    });
  });

  it('submits existing-file Arr rejections with override payload fields', async () => {
    const arrFetch = vi.spyOn(arrClient, 'arrFetch').mockResolvedValue(undefined);

    await submitSelectedRelease(job, {
      decision: {
        accepted: 1,
        considered: 1,
        reason: 'Picked Fixture.History.1998.1080p.WEB-DL-ALT',
        selected: {
          guid: 'guid-existing-file',
          indexer: 'Indexer',
          indexerId: 12,
          languages: ['English'],
          protocol: 'torrent',
          reason:
            'Arr marked this release as not downloadable; Not an upgrade for existing movie file.',
          score: 500,
          size: 1_000,
          title: 'Fixture.History.1998.1080p.WEB-DL-ALT',
        },
      },
      payload: {
        downloadAllowed: false,
        guid: 'guid-existing-file',
        indexerId: 12,
        mappedMovieId: 603,
        quality: { quality: { id: 3, name: 'WEBDL-1080p' } },
        rejected: true,
        rejections: ['Not an upgrade for existing movie file.'],
      },
    });

    expect(arrFetch).toHaveBeenCalledWith('radarr', '/api/v3/release', {
      method: 'POST',
      body: JSON.stringify({
        downloadAllowed: false,
        guid: 'guid-existing-file',
        indexerId: 12,
        mappedMovieId: 603,
        quality: { quality: { id: 3, name: 'WEBDL-1080p' } },
        rejected: true,
        rejections: ['Not an upgrade for existing movie file.'],
        shouldOverride: true,
      }),
    });
  });

  it('submits manually selected Arr-rejected releases with override payload fields', async () => {
    const arrFetch = vi.spyOn(arrClient, 'arrFetch').mockResolvedValue(undefined);

    await submitSelectedRelease(job, {
      decision: {
        accepted: 0,
        considered: 1,
        reason: 'User overrode Arr rejection and selected Fixture.History.1998.480p.WEB-DL-GROUP',
        selected: {
          guid: 'guid-unknown-movie',
          indexer: 'Indexer',
          indexerId: 12,
          languages: ['English'],
          protocol: 'usenet',
          reason: 'Unknown Movie. Unable to match to correct movie using release title.',
          score: -10_000,
          size: 700_000_000,
          title: 'Fixture.History.1998.480p.WEB-DL-GROUP',
        },
      },
      payload: {
        downloadAllowed: false,
        guid: 'guid-unknown-movie',
        indexerId: 12,
        mappedMovieId: null,
        rejected: true,
        rejections: ['Unknown Movie. Unable to match to correct movie using release title.'],
      },
    });

    expect(arrFetch).toHaveBeenCalledWith('radarr', '/api/v3/release', {
      method: 'POST',
      body: JSON.stringify({
        downloadAllowed: false,
        guid: 'guid-unknown-movie',
        indexerId: 12,
        mappedMovieId: null,
        rejected: true,
        rejections: ['Unknown Movie. Unable to match to correct movie using release title.'],
        shouldOverride: true,
      }),
    });
  });

  it('marks scope-mismatched series releases as not selectable in manual results', async () => {
    vi.spyOn(arrClient, 'arrFetch').mockResolvedValue([
      {
        guid: 'guid-right-season',
        indexerId: 11,
        indexer: 'Indexer',
        title: 'Fixture Series.S01.1080p.WEB-DL-FLUX',
        seriesTitles: 'Fixture Series',
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
        title: 'Fixture Series.S02.1080p.WEB-DL-FLUX',
        seriesTitles: 'Fixture Series',
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
        title: 'Fixture Series.S02.1080p.WEB-DL-FLUX',
        seriesTitles: 'Fixture Series',
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
        title: 'Fixture Series.S02.1080p.WEB-DL-FLUX',
        seriesTitles: 'Fixture Series',
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
        title: 'Fixture Series.S01E01.1080p.WEB-DL-FLUX',
        seriesTitles: 'Fixture Series',
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
        title: 'Fixture Series.S01E01.1080p.WEB-DL-FLUX',
        seriesTitles: 'Fixture Series',
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
        title: 'Fixture Series.1080p.WEB-DL-FLUX',
        seriesTitles: 'Fixture Series',
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
