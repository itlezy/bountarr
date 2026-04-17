import { afterEach, describe, expect, it, vi } from 'vitest';
import * as arrClient from '$lib/server/arr-client';
import { findManualReleaseSelection, getManualReleaseResults } from '$lib/server/acquisition-selection';
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('acquisition selection', () => {
  it('marks Arr-rejected releases as not selectable in manual results', async () => {
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
      canSelect: false,
      rejectedByArr: true,
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

    await expect(findManualReleaseSelection(job, 'guid-rejected', 12)).rejects.toThrow(
      'Rejected by Arr custom format rules',
    );
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
      scopeStatus: 'mismatch',
      selectionBlockedReason: 'Release scope targets different seasons.',
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

    await expect(findManualReleaseSelection(seriesJob, 'guid-wrong-season', 12)).rejects.toThrow(
      'Release scope targets different seasons.',
    );
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
    const partialTarget = results.releases.find((release) => release.guid === 'guid-partial-target');

    expect(partialTarget).toMatchObject({
      canSelect: false,
      scopeStatus: 'partial',
      selectionBlockedReason: 'Release scope overlaps the targeted episodes but does not match exactly.',
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

    await expect(findManualReleaseSelection(seriesJob, 'guid-partial-target', 13)).rejects.toThrow(
      'Release scope overlaps the targeted episodes but does not match exactly.',
    );
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
      scopeStatus: 'unknown',
      selectionBlockedReason: 'The release does not expose season or episode scope.',
      status: 'locally-rejected',
    });
    await expect(findManualReleaseSelection(seriesJob, 'guid-unknown-scope', 14)).rejects.toThrow(
      'The release does not expose season or episode scope.',
    );
  });
});
