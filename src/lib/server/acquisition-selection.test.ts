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
});
