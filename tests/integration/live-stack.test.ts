import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigStatus, GrabResponse, MediaItem, QueueResponse } from '$lib/shared/types';
import {
  assertLiveIntegrationEnabled,
  loadLiveIntegrationConfig,
  type LiveIntegrationConfig,
} from './support/live-config';
import { getJson, pollUntil, postJson } from './support/live-http';
import { resetBountarrStateFiles, startLiveApp, type RunningLiveApp } from './support/live-app';
import { ensureMovieMissing, ensureMovieTracked } from './support/live-radarr';

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
  let cleanupTarget: DeleteTarget | null = null;
  let config: LiveIntegrationConfig;

  beforeEach(async () => {
    config = loadLiveIntegrationConfig();
    assertLiveIntegrationEnabled(config);

    await ensureMovieMissing(config, config.untrackedMovie);
    await ensureMovieTracked(config, config.duplicateMovie);
    resetBountarrStateFiles();

    app = await startLiveApp(config);
    await verifyPreflight(config);
    cleanupTarget = null;
  }, 120_000);

  afterEach(async () => {
    if (app && cleanupTarget) {
      try {
        await postJson(`${config.baseUrl}/api/media/delete`, cleanupTarget);
      } catch {
        // Fall through to direct Arr cleanup below.
      }
    }

    if (app) {
      await app.stop();
      app = null;
    }

    await ensureMovieMissing(config, config.untrackedMovie);
    resetBountarrStateFiles();
    cleanupTarget = null;
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

    cleanupTarget = asDeleteTarget(request.item);

    const queue = await pollUntil(async () => {
      const result = await getJson<QueueResponse>(`${config.baseUrl}/api/queue`);
      const jobVisible = result.acquisitionJobs.some(
        (job) =>
          job.id === request.job?.id ||
          (job.arrItemId !== null && job.arrItemId === request.item.arrItemId),
      );

      return jobVisible ? result : null;
    }, 30_000);

    const acquisitionJob = queue.acquisitionJobs.find(
      (job) =>
        job.id === request.job?.id ||
        (job.arrItemId !== null && job.arrItemId === request.item.arrItemId),
    );

    expect(acquisitionJob).toBeDefined();
    expect(acquisitionJob?.title).toBe(config.untrackedMovie.title);
    expect(acquisitionJob?.kind).toBe('movie');
  }, 120_000);

  it('returns the duplicate path for The Matrix (1999)', async () => {
    const search = await getJson<MediaItem[]>(
      `${config.baseUrl}/api/search?q=Matrix&kind=movie&availability=all`,
    );
    const item = exactMovieMatch(search, config.duplicateMovie.title, config.duplicateMovie.year);

    expect(item).not.toBeNull();
    expect(item?.inArr).toBe(true);
    expect(item?.canAdd).toBe(false);

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
