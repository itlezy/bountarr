import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquisitionResponseFixture,
  configStatusFixture,
  dashboardResponseFixture,
  grabResponseFixture,
  healthResponseFixture,
  mediaItemFixture,
  queueResponseFixture,
  runtimeHealthFixture,
} from '$lib/server/api-test-fixtures';
import { AcquisitionGrabError } from '$lib/server/acquisition-domain';
import { createGetEvent, createPostEvent, loadRouteModule, readJson } from '$lib/server/api-test';

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('API routes', () => {
  it('returns health status from runtime state', async () => {
    const route = await loadRouteModule<{ GET: () => Promise<Response> }>(
      '../../routes/api/health/+server',
      {
        '$lib/server/runtime': () => ({
          getConfiguredServiceFlags: () => ({
            configured: true,
            plexConfigured: true,
            radarrConfigured: true,
            sonarrConfigured: true,
          }),
          getRuntimeHealth: () => runtimeHealthFixture,
        }),
      },
    );

    const response = await route.GET();
    const payload = await readJson<typeof healthResponseFixture>(response);

    expect(response.status).toBe(200);
    expect(payload).toEqual(healthResponseFixture);
  });

  it('returns config status from the config service', async () => {
    const getConfigStatus = vi.fn().mockResolvedValue(configStatusFixture);
    const route = await loadRouteModule<{ GET: () => Promise<Response> }>(
      '../../routes/api/config/status/+server',
      {
        '$lib/server/config-service': () => ({
          getConfigStatus,
        }),
      },
    );

    const response = await route.GET();
    const payload = await readJson<typeof configStatusFixture>(response);

    expect(getConfigStatus).toHaveBeenCalledTimes(1);
    expect(payload).toEqual(configStatusFixture);
  });

  it('returns early for short search queries', async () => {
    const lookupItems = vi.fn();
    const route = await loadRouteModule<{
      GET: (event: { url: URL }) => Promise<Response>;
    }>('../../routes/api/search/+server', {
      '$lib/server/lookup-service': () => ({
        lookupItems,
      }),
    });

    const response = await route.GET(createGetEvent('http://local.test/api/search?q=a&kind=all'));
    const payload = await readJson<unknown[]>(response);

    expect(lookupItems).not.toHaveBeenCalled();
    expect(payload).toEqual([]);
  });

  it('passes normalized search query params into lookupItems', async () => {
    const lookupItems = vi.fn().mockResolvedValue([mediaItemFixture]);
    const route = await loadRouteModule<{
      GET: (event: { url: URL }) => Promise<Response>;
    }>('../../routes/api/search/+server', {
      '$lib/server/lookup-service': () => ({
        lookupItems,
      }),
    });

    const response = await route.GET(
      createGetEvent(
        'http://local.test/api/search?q=matrix&kind=movie&availability=available-only',
      ),
    );
    const payload = await readJson<(typeof mediaItemFixture)[]>(response);

    expect(lookupItems).toHaveBeenCalledWith('matrix', 'movie', undefined, {
      availability: 'available-only',
    });
    expect(payload).toEqual([mediaItemFixture]);
  });

  it('defaults missing availability search params to only not available', async () => {
    const lookupItems = vi.fn().mockResolvedValue([mediaItemFixture]);
    const route = await loadRouteModule<{
      GET: (event: { url: URL }) => Promise<Response>;
    }>('../../routes/api/search/+server', {
      '$lib/server/lookup-service': () => ({
        lookupItems,
      }),
    });

    await route.GET(createGetEvent('http://local.test/api/search?q=matrix&kind=movie'));

    expect(lookupItems).toHaveBeenCalledWith('matrix', 'movie', undefined, {
      availability: 'not-available-only',
    });
  });

  it('sanitizes dashboard query preferences before loading dashboard data', async () => {
    const getDashboard = vi.fn().mockResolvedValue(dashboardResponseFixture);
    const route = await loadRouteModule<{
      GET: (event: { url: URL }) => Promise<Response>;
    }>('../../routes/api/dashboard/+server', {
      '$lib/server/queue-dashboard-service': () => ({
        getDashboard,
      }),
    });

    const response = await route.GET(
      createGetEvent(
        'http://local.test/api/dashboard?preferredLanguage=English&subtitleLanguage=Spanish',
      ),
    );
    const payload = await readJson<typeof dashboardResponseFixture>(response);

    expect(getDashboard).toHaveBeenCalledWith({
      cardsView: 'rounded',
      preferredLanguage: 'English',
      subtitleLanguage: 'Spanish',
      theme: 'system',
    });
    expect(payload.summary.attention).toBe(1);
  });

  it('returns unified queue entries for managed and external downloads', async () => {
    const getQueue = vi.fn().mockResolvedValue(queueResponseFixture);
    const route = await loadRouteModule<{ GET: () => Promise<Response> }>(
      '../../routes/api/queue/+server',
      {
        '$lib/server/queue-dashboard-service': () => ({
          getQueue,
        }),
      },
    );

    const response = await route.GET();
    const payload = await readJson<typeof queueResponseFixture>(response);

    expect(getQueue).toHaveBeenCalledTimes(1);
    expect(payload.total).toBe(1);
    expect(payload.entries[0]).toMatchObject({
      kind: 'managed',
      job: {
        status: 'validating',
      },
      liveQueueItems: [
        {
          status: 'Downloading',
        },
      ],
      liveSummary: {
        rowCount: 1,
        status: 'Downloading',
      },
    });
  });

  it('returns acquisition jobs from the acquisition service', async () => {
    const getAcquisitionJobs = vi.fn().mockResolvedValue(acquisitionResponseFixture);
    const route = await loadRouteModule<{ GET: () => Promise<Response> }>(
      '../../routes/api/acquisition/+server',
      {
        '$lib/server/acquisition-service': () => ({
          getAcquisitionJobs,
        }),
      },
    );

    const response = await route.GET();
    const payload = await readJson<typeof acquisitionResponseFixture>(response);

    expect(getAcquisitionJobs).toHaveBeenCalledTimes(1);
    expect(payload.jobs).toHaveLength(1);
    expect(payload.jobs[0]?.title).toBe('The Matrix');
  });

  it('rejects grab calls without a media item', async () => {
    const route = await loadRouteModule<{
      POST: (event: { request: Request }) => Promise<Response>;
    }>('../../routes/api/grab/+server', {
      '$lib/server/acquisition-service': () => ({
        grabItem: vi.fn(),
      }),
    });

    await expect(
      route.POST(
        createPostEvent('http://local.test/api/grab', {
          preferences: {
            preferredLanguage: 'English',
            subtitleLanguage: 'English',
          },
        }),
      ),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('returns duplicate grab responses unchanged when the item already exists', async () => {
    const grabItem = vi.fn().mockResolvedValue(grabResponseFixture);
    const route = await loadRouteModule<{
      POST: (event: { request: Request }) => Promise<Response>;
    }>('../../routes/api/grab/+server', {
      '$lib/server/acquisition-service': () => ({
        grabItem,
      }),
    });

    const response = await route.POST(
      createPostEvent('http://local.test/api/grab', {
        item: mediaItemFixture,
        qualityProfileId: 7,
        preferences: {
          preferredLanguage: 'English',
          subtitleLanguage: 'Spanish',
        },
      }),
    );
    const payload = await readJson<typeof grabResponseFixture>(response);

    expect(grabItem).toHaveBeenCalledWith(
      mediaItemFixture,
      {
        cardsView: 'rounded',
        preferredLanguage: 'English',
        subtitleLanguage: 'Spanish',
        theme: 'system',
      },
      {
        qualityProfileId: 7,
      },
    );
    expect(payload.existing).toBe(true);
    expect(payload.message).toContain('already tracked');
  });

  it('returns resolved Arr-backed grab candidates for Plex-only items', async () => {
    const resolveGrabCandidateFromPlexItem = vi.fn().mockResolvedValue(mediaItemFixture);
    const route = await loadRouteModule<{
      POST: (event: { request: Request }) => Promise<Response>;
    }>('../../routes/api/grab/resolve/+server', {
      '$lib/server/lookup-service': () => ({
        resolveGrabCandidateFromPlexItem,
      }),
    });

    const response = await route.POST(
      createPostEvent('http://local.test/api/grab/resolve', {
        item: {
          ...mediaItemFixture,
          sourceService: 'plex',
          origin: 'plex',
          inPlex: true,
          canAdd: false,
        },
        preferences: {
          preferredLanguage: 'English',
          subtitleLanguage: 'English',
        },
      }),
    );
    const payload = await readJson<typeof mediaItemFixture>(response);

    expect(resolveGrabCandidateFromPlexItem).toHaveBeenCalledTimes(1);
    expect(payload).toEqual(mediaItemFixture);
  });

  it('accepts browser UI exception reports and returns ok', async () => {
    const route = await loadRouteModule<{
      POST: (event: {
        getClientAddress: () => string;
        request: Request;
        url: URL;
      }) => Promise<Response>;
    }>('../../routes/api/client-errors/+server', {});

    const response = await route.POST({
      ...createPostEvent('http://local.test/api/client-errors', {
        kind: 'window-error',
        message: 'Boom',
        stack: 'stack trace',
        source: 'SearchView.svelte',
        line: 14,
        column: 6,
      }),
      getClientAddress: () => '127.0.0.1',
      url: new URL('http://local.test/api/client-errors'),
    });
    const payload = await readJson<{ ok: boolean }>(response);

    expect(response.status).toBe(200);
    expect(payload).toEqual({ ok: true });
  });

  it('rejects browser UI exception reports without a message', async () => {
    const route = await loadRouteModule<{
      POST: (event: {
        getClientAddress: () => string;
        request: Request;
        url: URL;
      }) => Promise<Response>;
    }>('../../routes/api/client-errors/+server', {});

    await expect(
      route.POST({
        ...createPostEvent('http://local.test/api/client-errors', {
          kind: 'window-error',
        }),
        getClientAddress: () => '127.0.0.1',
        url: new URL('http://local.test/api/client-errors'),
      }),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects media delete calls without a deletable Arr item', async () => {
    const route = await loadRouteModule<{
      POST: (event: { request: Request }) => Promise<Response>;
    }>('../../routes/api/media/delete/+server', {
      '$lib/server/acquisition-service': () => ({
        deleteArrItem: vi.fn(),
      }),
    });

    await expect(
      route.POST(
        createPostEvent('http://local.test/api/media/delete', {
          id: 'movie:603',
          kind: 'movie',
          sourceService: 'radarr',
          title: 'The Matrix',
        }),
      ),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('passes Arr item identity into the media delete route', async () => {
    const deleteArrItem = vi.fn().mockResolvedValue({
      itemId: 'movie:603',
      message: 'Deleted',
    });
    const route = await loadRouteModule<{
      POST: (event: { request: Request }) => Promise<Response>;
    }>('../../routes/api/media/delete/+server', {
      '$lib/server/acquisition-service': () => ({
        deleteArrItem,
      }),
    });

    const response = await route.POST(
      createPostEvent('http://local.test/api/media/delete', {
        arrItemId: 603,
        id: 'movie:603',
        kind: 'movie',
        sourceService: 'radarr',
        title: 'The Matrix',
      }),
    );
    const payload = await readJson<{ itemId: string; message: string }>(response);

    expect(deleteArrItem).toHaveBeenCalledWith({
      arrItemId: 603,
      id: 'movie:603',
      kind: 'movie',
      queueId: null,
      sourceService: 'radarr',
      title: 'The Matrix',
    });
    expect(payload.message).toBe('Deleted');
  });

  it('accepts queue-only stale delete requests for media delete', async () => {
    const deleteArrItem = vi.fn().mockResolvedValue({
      itemId: 'radarr:queue:1',
      message: 'Deleted',
    });
    const route = await loadRouteModule<{
      POST: (event: { request: Request }) => Promise<Response>;
    }>('../../routes/api/media/delete/+server', {
      '$lib/server/acquisition-service': () => ({
        deleteArrItem,
      }),
    });

    const response = await route.POST(
      createPostEvent('http://local.test/api/media/delete', {
        arrItemId: null,
        id: 'radarr:queue:1',
        kind: 'movie',
        queueId: 1,
        sourceService: 'radarr',
        title: 'The Matrix',
      }),
    );
    const payload = await readJson<{ itemId: string; message: string }>(response);

    expect(deleteArrItem).toHaveBeenCalledWith({
      arrItemId: null,
      id: 'radarr:queue:1',
      kind: 'movie',
      queueId: 1,
      sourceService: 'radarr',
      title: 'The Matrix',
    });
    expect(payload.itemId).toBe('radarr:queue:1');
  });

  it('returns plain-text grab errors when the acquisition service fails', async () => {
    const grabItem = vi.fn().mockRejectedValue(new Error('Arr is unavailable'));
    const route = await loadRouteModule<{
      POST: (event: { request: Request }) => Promise<Response>;
    }>('../../routes/api/grab/+server', {
      '$lib/server/acquisition-service': () => ({
        grabItem,
      }),
    });

    const response = await route.POST(
      createPostEvent('http://local.test/api/grab', {
        item: mediaItemFixture,
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Arr is unavailable');
  });

  it('preserves typed grab statuses for predictable grab failures', async () => {
    const grabItem = vi
      .fn()
      .mockRejectedValue(new AcquisitionGrabError(409, 'The Matrix is already tracked in Arr'));
    const route = await loadRouteModule<{
      POST: (event: { request: Request }) => Promise<Response>;
    }>('../../routes/api/grab/+server', {
      '$lib/server/acquisition-service': () => ({
        grabItem,
      }),
    });

    const response = await route.POST(
      createPostEvent('http://local.test/api/grab', {
        item: mediaItemFixture,
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toBe('The Matrix is already tracked in Arr');
  });
});
