import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAcquisitionJob,
  cancelQueueEntry,
  deleteArrItem,
  fetchQueue,
  resolveGrabCandidate,
  fetchSearchResults,
  submitGrab,
} from '$lib/client/api';
import type { MediaItem } from '$lib/shared/types';

const movieItem: MediaItem = {
  id: 'movie:1',
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
  id: 'series:80',
  kind: 'series',
  title: 'Andor',
  year: 2022,
  rating: 8.5,
  poster: null,
  overview: 'Sci-fi',
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
  requestPayload: { tvdbId: 393189 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('client api', () => {
  it('builds the search query from the current filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([movieItem]), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSearchResults(' matrix ', 'movie', 'not-available-only');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/search?q=matrix&kind=movie&availability=not-available-only',
      undefined,
    );
    expect(result).toEqual([movieItem]);
  });

  it('posts grab payloads with preferences and quality profile overrides', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          existing: false,
          item: {
            ...movieItem,
            inArr: true,
            canAdd: false,
            status: 'Already in Arr',
          },
          message: 'Added',
          releaseDecision: null,
          job: null,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await submitGrab(
      movieItem,
      {
        preferredLanguage: 'English',
        subtitleLanguage: 'Spanish',
      },
      42,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/grab');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      item: movieItem,
      qualityProfileId: 42,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'Spanish',
      },
    });
  });

  it('posts selected seasons for series grabs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await submitGrab(
      seriesItem,
      {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      11,
      [1, 2],
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      item: seriesItem,
      qualityProfileId: 11,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      seasonNumbers: [1, 2],
    });
  });

  it('posts grab-resolution payloads for Plex-only items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(movieItem), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await resolveGrabCandidate(
      {
        ...movieItem,
        sourceService: 'plex',
        origin: 'plex',
        inPlex: true,
        canAdd: false,
      },
      {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/grab/resolve');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      item: {
        ...movieItem,
        sourceService: 'plex',
        origin: 'plex',
        inPlex: true,
        canAdd: false,
      },
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    });
  });

  it('surfaces backend error text for queue failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Queue is unavailable', {
          status: 503,
        }),
      ),
    );

    await expect(fetchQueue()).rejects.toThrow('Queue is unavailable');
  });

  it('posts unified cancel payloads for managed queue entries', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          itemId: 'job-1',
          message: 'Cancelled',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await cancelQueueEntry({
      kind: 'managed',
      id: 'job-1',
      job: {
        id: 'job-1',
        itemId: 'movie:1',
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
        progress: 50,
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
        attempts: [],
      },
      liveQueueItems: [
        {
          id: 'radarr:queue:1',
          arrItemId: 603,
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
        episodeIds: null,
        seasonNumbers: null,
      },
    ],
      liveSummary: {
        rowCount: 1,
        progress: 50,
        status: 'Downloading',
        timeLeft: '5m',
        estimatedCompletionTime: null,
        size: 1_000,
        sizeLeft: 500,
        byteMetricsPartial: false,
      },
      canCancel: true,
      canRemove: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/queue/cancel');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'managed',
      jobId: 'job-1',
      arrItemId: 603,
      currentRelease: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
      sourceService: 'radarr',
      targetEpisodeIds: null,
      targetSeasonNumbers: null,
      title: 'The Matrix',
    });
  });

  it('posts acquisition-cancel requests to the job cancel route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          job: {
            id: 'job-1',
            status: 'cancelled',
          },
          message: 'Cancelled',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await cancelAcquisitionJob('job-1');

    expect(fetchMock).toHaveBeenCalledWith('/api/acquisition/job-1/cancel', {
      method: 'POST',
    });
  });

  it('posts Arr delete payloads with Arr identity metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          itemId: 'movie:1',
          message: 'Deleted',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await deleteArrItem({
      deleteMode: 'library',
      arrItemId: 603,
      id: movieItem.id,
      kind: 'movie',
      sourceService: 'radarr',
      title: movieItem.title,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/media/delete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      deleteMode: 'library',
      arrItemId: 603,
      id: 'movie:1',
      kind: 'movie',
      sourceService: 'radarr',
      title: 'The Matrix',
    });
  });

  it('posts queue-entry deletes without Arr title identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          itemId: 'radarr:queue:7',
          message: 'Cleared',
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await deleteArrItem({
      deleteMode: 'queue-entry',
      id: 'radarr:queue:7',
      kind: 'movie',
      queueId: 7,
      sourceService: 'radarr',
      title: 'The Matrix',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/media/delete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      deleteMode: 'queue-entry',
      id: 'radarr:queue:7',
      kind: 'movie',
      queueId: 7,
      sourceService: 'radarr',
      title: 'The Matrix',
    });
  });
});
