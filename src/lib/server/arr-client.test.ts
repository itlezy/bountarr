import { afterEach, describe, expect, it, vi } from 'vitest';

type PrivateEnv = Record<string, string | undefined>;

async function loadArrClient(envOverrides: PrivateEnv = {}) {
  vi.resetModules();
  vi.doMock('$env/dynamic/private', () => ({
    env: {
      RADARR_API_KEY: 'radarr-key',
      RADARR_URL: 'http://radarr.local/',
      SONARR_API_KEY: 'sonarr-key',
      SONARR_URL: 'http://sonarr.local',
      ...envOverrides,
    },
  }));
  vi.doMock('$lib/server/logger', () => ({
    createAreaLogger: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
    getErrorMessage: (error: unknown, fallback: string) =>
      error instanceof Error ? error.message : fallback,
  }));

  return import('$lib/server/arr-client');
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe('arr-client', () => {
  it('throws a typed config error when a service is not configured', async () => {
    const { arrFetch, ArrFetchError } = await loadArrClient({
      RADARR_API_KEY: '',
    });

    await expect(arrFetch('radarr', '/api/v3/movie')).rejects.toMatchObject({
      kind: 'config',
      message: 'radarr is not configured',
      path: '/api/v3/movie',
      service: 'radarr',
    });
    await expect(arrFetch('radarr', '/api/v3/movie')).rejects.toBeInstanceOf(ArrFetchError);
  });

  it('attaches auth headers and query params to successful Arr requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { arrFetch } = await loadArrClient();

    const result = await arrFetch<{ ok: boolean }>(
      'radarr',
      '/api/v3/movie',
      {
        body: JSON.stringify({ title: 'The Matrix' }),
        method: 'POST',
      },
      { page: 2, term: 'matrix' },
    );

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('http://radarr.local/api/v3/movie?page=2&term=matrix');
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-Api-Key')).toBe('radarr-key');
  });

  it('throws a typed network error when fetch cannot reach Arr', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    const { arrFetch } = await loadArrClient();

    await expect(arrFetch('sonarr', '/api/v3/series')).rejects.toMatchObject({
      kind: 'network',
      message: 'sonarr request failed: connect ECONNREFUSED',
      path: '/api/v3/series',
      service: 'sonarr',
    });
  });

  it('throws a typed response error for non-2xx Arr responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('No such movie', {
          status: 404,
          statusText: 'Not Found',
        }),
      ),
    );
    const { arrFetch } = await loadArrClient();

    await expect(arrFetch('radarr', '/api/v3/movie/999')).rejects.toMatchObject({
      body: 'No such movie',
      kind: 'response',
      message: 'radarr 404: No such movie',
      path: '/api/v3/movie/999',
      service: 'radarr',
      status: 404,
      statusText: 'Not Found',
    });
  });

  it('throws a typed invalid-json error for malformed Arr success bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not json', {
          status: 200,
        }),
      ),
    );
    const { arrFetch } = await loadArrClient();

    await expect(arrFetch('radarr', '/api/v3/movie')).rejects.toMatchObject({
      body: 'not json',
      kind: 'invalid-json',
      path: '/api/v3/movie',
      service: 'radarr',
    });
  });
});
