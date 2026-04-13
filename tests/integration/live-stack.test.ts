import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigStatus, GrabResponse, MediaItem, QueueItem, QueueResponse } from '$lib/shared/types';
import {
  assertLiveIntegrationEnabled,
  loadLiveIntegrationConfig,
  type LiveIntegrationConfig,
} from './support/live-config';
import { getJson, pollUntil, postJson } from './support/live-http';
import { resetBountarrStateFiles, startLiveApp, type RunningLiveApp } from './support/live-app';
import {
  ensureMovieMissing,
  findMovieByTitleYear,
  getMovieById,
  listMovies,
} from './support/live-radarr';

type DeleteTarget = {
  arrItemId: number;
  id: string;
  kind: 'movie';
  queueId: number | null;
  sourceService: 'radarr';
  title: string;
};

function exactMovieMatch(items: MediaItem[], title: string, year: number): MediaItem | null {
  return (
    items.find(
      (item) =>
        item.kind === 'movie' &&
        item.title.localeCompare(title, undefined, { sensitivity: 'accent' }) === 0 &&
        item.year === year,
    ) ?? null
  );
}

function asDeleteTarget(item: MediaItem): DeleteTarget {
  if (item.arrItemId == null) {
    throw new Error(`Expected ${item.title} to have a Radarr item id for cleanup.`);
  }

  return {
    arrItemId: item.arrItemId,
    id: item.id,
    kind: 'movie',
    queueId: null,
    sourceService: 'radarr',
    title: item.title,
  };
}

function matchingQueueItem(
  queue: QueueResponse,
  arrItemId: number | null | undefined,
): QueueItem | null {
  if (arrItemId == null) {
    return null;
  }

  return (
    queue.items.find(
      (item) => item.sourceService === 'radarr' && item.kind === 'movie' && item.arrItemId === arrItemId,
    ) ?? null
  );
}

function matchingAcquisitionJob(
  queue: QueueResponse,
  request: GrabResponse,
) {
  return (
    queue.acquisitionJobs.find(
      (job) =>
        job.id === request.job?.id ||
        (job.arrItemId !== null && job.arrItemId === request.item.arrItemId),
    ) ?? null
  );
}

async function waitForAcquisitionVisibility(
  config: LiveIntegrationConfig,
  request: GrabResponse,
  timeoutMs = 45_000,
): Promise<QueueResponse> {
  return pollUntil(async () => {
    const result = await getJson<QueueResponse>(`${config.baseUrl}/api/queue`);
    return matchingAcquisitionJob(result, request) || matchingQueueItem(result, request.item.arrItemId)
      ? result
      : null;
  }, timeoutMs);
}

async function findTrackedSearchCandidate(config: LiveIntegrationConfig): Promise<MediaItem> {
  const trackedMovies = await listMovies(config);

  for (const candidate of trackedMovies) {
    if (candidate.year === null) {
      continue;
    }

    const search = await getJson<MediaItem[]>(
      `${config.baseUrl}/api/search?q=${encodeURIComponent(candidate.title)}&kind=movie&availability=all`,
    );
    const match = exactMovieMatch(search, candidate.title, candidate.year);
    if (match?.inArr) {
      return match;
    }
  }

  throw new Error('Could not find a searchable tracked Radarr movie for duplicate-path verification.');
}

async function verifyPreflight(config: LiveIntegrationConfig): Promise<void> {
  const health = await getJson<{ status: string }>(`${config.baseUrl}/api/health`);
  expect(health.status).toBe('ok');

  const status = await getJson<ConfigStatus>(`${config.baseUrl}/api/config/status`);
  expect(status.configured).toBe(true);
  expect(status.radarrConfigured).toBe(true);

  if (status.plexConfigured) {
    const recent = await getJson<unknown[]>(`${config.baseUrl}/api/plex/recent`);
    expect(Array.isArray(recent)).toBe(true);
  }
}

describe.sequential('live stack integration', () => {
  let app: RunningLiveApp | null = null;
  let cleanupTargets: DeleteTarget[] = [];
  let config: LiveIntegrationConfig;

  beforeEach(async () => {
    config = loadLiveIntegrationConfig();
    assertLiveIntegrationEnabled(config);

    await ensureMovieMissing(config, config.untrackedMovie);
    resetBountarrStateFiles();

    app = await startLiveApp(config);
    await verifyPreflight(config);
    cleanupTargets = [];
  }, 120_000);

  afterEach(async () => {
    if (app && cleanupTargets.length > 0) {
      for (const cleanupTarget of cleanupTargets.splice(0)) {
        try {
          await postJson(`${config.baseUrl}/api/media/delete`, cleanupTarget);
        } catch {
          // Fall through to direct Arr cleanup below.
        }
      }
    }

    if (app) {
      await app.stop();
      app = null;
    }

    await ensureMovieMissing(config, config.untrackedMovie);
    resetBountarrStateFiles();
    cleanupTargets = [];
  }, 120_000);

  it('searches, adds, and exposes the acquisition lifecycle for Dredd (2012)', async () => {
    const search = await getJson<MediaItem[]>(
      `${config.baseUrl}/api/search?q=Dredd&kind=movie&availability=all`,
    );
    const item = exactMovieMatch(search, config.untrackedMovie.title, config.untrackedMovie.year);

    expect(item).not.toBeNull();
    expect(item?.inArr).toBe(false);
    expect(item?.canAdd).toBe(true);

    const request = await postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
      item,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    });

    expect(request.existing).toBe(false);
    expect(request.job).not.toBeNull();
    expect(request.item.arrItemId).not.toBeNull();

    cleanupTargets.push(asDeleteTarget(request.item));

    const queue = await waitForAcquisitionVisibility(config, request);
    const acquisitionJob = matchingAcquisitionJob(queue, request);
    const queueItem = matchingQueueItem(queue, request.item.arrItemId);

    expect(acquisitionJob).toBeDefined();
    expect(acquisitionJob?.title).toBe(config.untrackedMovie.title);
    expect(acquisitionJob?.kind).toBe('movie');
    if (queueItem) {
      expect(queueItem.status.length).toBeGreaterThan(0);
      if (queueItem.progress !== null) {
        expect(queueItem.progress).toBeGreaterThanOrEqual(0);
      }
    }
  }, 120_000);

  it('removes a newly grabbed movie cleanly from Radarr and the acquisition queue', async () => {
    const search = await getJson<MediaItem[]>(
      `${config.baseUrl}/api/search?q=Dredd&kind=movie&availability=all`,
    );
    const item = exactMovieMatch(search, config.untrackedMovie.title, config.untrackedMovie.year);

    expect(item).not.toBeNull();
    expect(item?.inArr).toBe(false);

    const request = await postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
      item,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    });

    expect(request.existing).toBe(false);
    expect(request.item.arrItemId).not.toBeNull();

    cleanupTargets.push(asDeleteTarget(request.item));
    await waitForAcquisitionVisibility(config, request);

    const deleteResponse = await postJson<{ itemId: string; message: string }>(
      `${config.baseUrl}/api/media/delete`,
      cleanupTargets[cleanupTargets.length - 1],
    );

    expect(deleteResponse.message).toContain('deleted from Radarr');
    cleanupTargets.pop();

    await pollUntil(async () => {
      const queue = await getJson<QueueResponse>(`${config.baseUrl}/api/queue`);
      return matchingAcquisitionJob(queue, request) || matchingQueueItem(queue, request.item.arrItemId)
        ? null
        : queue;
    }, 45_000);

    await pollUntil(
      async () =>
        ((await findMovieByTitleYear(config, config.untrackedMovie)) === null ? true : null),
      45_000,
    );
  }, 120_000);

  it('cancels an acquisition job and unmonitors the tracked Radarr item', async () => {
    const search = await getJson<MediaItem[]>(
      `${config.baseUrl}/api/search?q=Dredd&kind=movie&availability=all`,
    );
    const item = exactMovieMatch(search, config.untrackedMovie.title, config.untrackedMovie.year);

    expect(item).not.toBeNull();
    if (!item) {
      throw new Error('Expected Dredd (2012) to be searchable for cancel-path verification.');
    }

    const request = await postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
      item,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    });

    expect(request.job).not.toBeNull();
    expect(request.item.arrItemId).not.toBeNull();

    cleanupTargets.push(asDeleteTarget(request.item));
    await waitForAcquisitionVisibility(config, request);

    const cancelResponse = await postJson<{ job: { status: string }; message: string }>(
      `${config.baseUrl}/api/acquisition/${encodeURIComponent(request.job!.id)}/cancel`,
      {},
    );

    expect(cancelResponse.job.status).toBe('cancelled');
    expect(cancelResponse.message).toContain('cancelled and unmonitored');

    await pollUntil(async () => {
      const queue = await getJson<QueueResponse>(`${config.baseUrl}/api/queue`);
      const acquisitionJob = matchingAcquisitionJob(queue, request);
      return acquisitionJob?.status === 'cancelled' ? acquisitionJob : null;
    }, 45_000);

    await pollUntil(async () => {
      const movie = await getMovieById(config, request.item.arrItemId!);
      return movie?.monitored === false ? movie : null;
    }, 45_000);
  }, 120_000);

  it('returns the duplicate path for an already tracked Radarr movie', async () => {
    const item = await findTrackedSearchCandidate(config);

    expect(item.inArr).toBe(true);
    expect(item.canAdd).toBe(false);

    const request = await postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
      item,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    });

    expect(request.existing).toBe(true);
    expect(request.message).toContain('already tracked');
    expect(request.item.inArr).toBe(true);
  }, 120_000);
});
