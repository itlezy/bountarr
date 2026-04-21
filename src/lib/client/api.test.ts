import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAcquisitionJob,
  cancelQueueEntry,
  deleteArrItem,
  fetchQueue,
  selectManualRelease,
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

  it('posts manual release selections without an Arr override by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          job: {
            id: 'job-1',
            status: 'queued',
          },
          message: 'Queued manual release.',
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

    await selectManualRelease('job-1', 'guid-1', 11, 'direct');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/acquisition/job-1/select');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      guid: 'guid-1',
      indexerId: 11,
      selectionMode: 'direct',
    });
  });

  it('posts manual release Arr override flags when requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          job: {
            id: 'job-1',
            status: 'queued',
          },
          message: 'Queued manual release override.',
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

    await selectManualRelease('job-1', 'guid-2', 12, 'override-arr-rejection');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/acquisition/job-1/select');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      guid: 'guid-2',
      indexerId: 12,
      selectionMode: 'override-arr-rejection',
    });
  });

  it('posts external queue cancels using the queue-entry id instead of the raw item id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          itemId: 'sonarr:queue:23',
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
      kind: 'external',
      id: 'sonarr:queue:23',
      item: {
        id: 'sonarr:download:download-shared',
        downloadId: 'download-shared',
        arrItemId: 83867,
        canCancel: true,
        kind: 'series',
        title: 'Andor',
        year: 2022,
        poster: null,
        sourceService: 'sonarr',
        status: 'Downloading',
        progress: 50,
        timeLeft: '5m',
        estimatedCompletionTime: null,
        size: 1_000,
        sizeLeft: 500,
        queueId: 23,
        detail: 'Andor.S02E01.1080p.WEB-DL-FLUX',
        episodeIds: [201],
        seasonNumbers: [2],
      },
      canCancel: true,
      canRemove: false,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/queue/cancel');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'external',
      id: 'sonarr:queue:23',
      arrItemId: 83867,
      queueId: 23,
      downloadId: 'download-shared',
      sourceService: 'sonarr',
      title: 'Andor',
    });
  });

  it('posts external queue cancels with download identity when no queue row id is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          itemId: 'radarr:download:download-shared',
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
      kind: 'external',
      id: 'radarr:download:download-shared',
      item: {
        id: 'radarr:download:download-shared',
        downloadId: 'download-shared',
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
        queueId: null,
        detail: 'The.Matrix.1999.1080p.WEB-DL-FLUX',
        episodeIds: null,
        seasonNumbers: null,
      },
      canCancel: true,
      canRemove: false,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/queue/cancel');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'external',
      id: 'radarr:download:download-shared',
      arrItemId: 603,
      queueId: null,
      downloadId: 'download-shared',
      sourceService: 'radarr',
      title: 'The Matrix',
    });
  });

  it('rejects external queue cancels when the queue entry is not cancelable anymore', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      cancelQueueEntry({
        kind: 'external',
        id: 'radarr:queue:1996958567',
        item: {
          id: 'radarr:queue:1996958567',
          arrItemId: 727,
          canCancel: true,
          kind: 'movie',
          title: 'Dangerous Animals',
          year: 2025,
          poster: null,
          sourceService: 'radarr',
          status: 'Completed',
          statusDetail: 'Not an upgrade for existing movie file. Existing quality: Bluray-2160p.',
          progress: 100,
          timeLeft: '00:00:00',
          estimatedCompletionTime: null,
          size: 7_845_710_150,
          sizeLeft: 0,
          queueId: 1996958567,
          detail: 'Dangerous.Animals.2025.1080p.WEB.H264-KBOX',
          episodeIds: null,
          seasonNumbers: null,
        },
        canCancel: false,
        canRemove: true,
      }),
    ).rejects.toThrow('This download cannot be cancelled.');

    expect(fetchMock).not.toHaveBeenCalled();
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
      downloadId: null,
      sourceService: 'radarr',
      title: 'The Matrix',
    });
  });

  it('posts queue-entry deletes with download identity when no queue row id is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          itemId: 'radarr:download:download-shared',
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
      downloadId: 'download-shared',
      id: 'radarr:download:download-shared',
      kind: 'movie',
      queueId: null,
      sourceService: 'radarr',
      title: 'The Matrix',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/media/delete');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      deleteMode: 'queue-entry',
      id: 'radarr:download:download-shared',
      kind: 'movie',
      queueId: null,
      downloadId: 'download-shared',
      sourceService: 'radarr',
      title: 'The Matrix',
    });
  });
});
