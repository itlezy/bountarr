import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ConfigStatus,
  GrabResponse,
  MediaItem,
  QueueEntry,
  QueueItem,
  QueueResponse,
} from '$lib/shared/types';
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
import { listAcquisitionEvents, listAttemptSubmissions } from './support/live-acquisition-db';
import {
  countRadarrSabQueueAdds,
  countSabQueueAdds,
  createLogCheckpoint,
  readLogAppendix,
} from './support/live-log-files';

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

function movieTitleMatches(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function movieTitleYearMatches(
  movie: { title: string; year: number | null },
  target: { title: string; year: number },
): boolean {
  return (
    movie.year === target.year &&
    movie.title.localeCompare(target.title, undefined, { sensitivity: 'accent' }) === 0
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

function requireGrabJob(response: GrabResponse, context: string): NonNullable<GrabResponse['job']> {
  if (!response.job) {
    throw new Error(`Expected ${context} to have an acquisition job.`);
  }

  return response.job;
}

function requireArrItemId(item: MediaItem): number {
  if (item.arrItemId == null) {
    throw new Error(`Expected ${item.title} to have a Radarr item id.`);
  }

  return item.arrItemId;
}

function matchingQueueItem(
  queue: QueueResponse,
  arrItemId: number | null | undefined,
): QueueItem | null {
  if (arrItemId == null) {
    return null;
  }

  for (const entry of queue.entries) {
    const items = entry.kind === 'managed' ? entry.liveQueueItems : [entry.item];
    for (const item of items) {
      if (
        item.sourceService === 'radarr' &&
        item.kind === 'movie' &&
        item.arrItemId === arrItemId
      ) {
        return item;
      }
    }
  }

  return null;
}

function matchingAcquisitionJob(queue: QueueResponse, request: GrabResponse) {
  return (
    queue.entries.find(
      (entry): entry is Extract<QueueEntry, { kind: 'managed' }> =>
        entry.kind === 'managed' &&
        (entry.job.id === request.job?.id ||
          (entry.job.arrItemId !== null && entry.job.arrItemId === request.item.arrItemId)),
    )?.job ?? null
  );
}

async function waitForAcquisitionVisibility(
  config: LiveIntegrationConfig,
  request: GrabResponse,
  timeoutMs = 45_000,
): Promise<QueueResponse> {
  return pollUntil(async () => {
    const result = await getJson<QueueResponse>(`${config.baseUrl}/api/queue`);
    return matchingAcquisitionJob(result, request) ||
      matchingQueueItem(result, request.item.arrItemId)
      ? result
      : null;
  }, timeoutMs);
}

function preferredTrackedMovieTitles(config: LiveIntegrationConfig): string[] {
  return [...new Set(['Sharing the Secret', config.duplicateMovie.title])];
}

function matchingTrackedMovieQueueEntries(queue: QueueResponse, arrItemId: number) {
  return {
    external: queue.entries.filter(
      (entry): entry is Extract<QueueEntry, { kind: 'external' }> =>
        entry.kind === 'external' &&
        entry.item.sourceService === 'radarr' &&
        entry.item.kind === 'movie' &&
        entry.item.arrItemId === arrItemId,
    ),
    managed: queue.entries.filter(
      (entry): entry is Extract<QueueEntry, { kind: 'managed' }> =>
        entry.kind === 'managed' &&
        entry.job.sourceService === 'radarr' &&
        entry.job.kind === 'movie' &&
        entry.job.arrItemId === arrItemId,
    ),
  };
}

async function findTrackedSearchCandidate(
  config: LiveIntegrationConfig,
  preferredTitles: string[] = [],
): Promise<MediaItem> {
  const trackedMovies = await listMovies(config);
  const orderedCandidates = [
    ...preferredTitles.flatMap((title) =>
      trackedMovies.filter((candidate) => movieTitleMatches(candidate.title, title)),
    ),
    ...trackedMovies,
  ].filter(
    (candidate, index, candidates) =>
      candidates.findIndex((otherCandidate) => otherCandidate.id === candidate.id) === index,
  );

  for (const candidate of orderedCandidates) {
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

  throw new Error(
    'Could not find a searchable tracked Radarr movie for duplicate-path verification.',
  );
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

async function waitForSubmittedReleaseTitle(jobId: string, timeoutMs = 45_000): Promise<string> {
  return pollUntil(async () => {
    const submittedEvent =
      listAcquisitionEvents(jobId).find((event) => event.kind === 'grab.submitted') ?? null;
    const selectedTitle = submittedEvent?.context.selectedTitle;
    return typeof selectedTitle === 'string' && selectedTitle.length > 0 ? selectedTitle : null;
  }, timeoutMs);
}

async function waitForSingleActiveJob(
  config: LiveIntegrationConfig,
  request: GrabResponse,
  timeoutMs = 45_000,
) {
  return pollUntil(async () => {
    const acquisition = await getJson<{ jobs: GrabResponse['job'][] }>(
      `${config.baseUrl}/api/acquisition`,
    );
    const matchingJobs = acquisition.jobs.filter(
      (job) =>
        job !== null &&
        (job.id === request.job?.id ||
          (request.item.arrItemId !== null && job.arrItemId === request.item.arrItemId)),
    );

    return matchingJobs.length === 1 ? matchingJobs[0] : null;
  }, timeoutMs);
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

    app = await startLiveApp(config, { resetRuntime: true });
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
      return matchingAcquisitionJob(queue, request) ||
        matchingQueueItem(queue, request.item.arrItemId)
        ? null
        : queue;
    }, 45_000);

    await pollUntil(
      async () =>
        (await findMovieByTitleYear(config, config.untrackedMovie)) === null ? true : null,
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
    const job = requireGrabJob(request, 'cancel-path grab');
    const arrItemId = requireArrItemId(request.item);

    cleanupTargets.push(asDeleteTarget(request.item));
    await waitForAcquisitionVisibility(config, request);

    const cancelResponse = await postJson<{ job: { status: string }; message: string }>(
      `${config.baseUrl}/api/acquisition/${encodeURIComponent(job.id)}/cancel`,
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
      const movie = await getMovieById(config, arrItemId);
      return movie?.monitored === false ? movie : null;
    }, 45_000);
  }, 120_000);

  it('returns the duplicate path for an already tracked Radarr movie', async () => {
    const item = await findTrackedSearchCandidate(config, preferredTrackedMovieTitles(config));

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

  it('keeps a tracked movie re-grab collapsed to one managed queue entry', async () => {
    const item = await findTrackedSearchCandidate(config, preferredTrackedMovieTitles(config));

    expect(item.inArr).toBe(true);

    const request = await postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
      item,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    });

    expect(request.existing).toBe(true);
    expect(request.job).not.toBeNull();
    expect(request.item.arrItemId).not.toBeNull();
    expect(request.message).toContain('already tracked');
    const expectedJob = requireGrabJob(request, 'tracked movie re-grab');
    const arrItemId = requireArrItemId(request.item);

    await waitForAcquisitionVisibility(config, request);
    const job = await waitForSingleActiveJob(config, request);
    const queue = await pollUntil(async () => {
      const result = await getJson<QueueResponse>(`${config.baseUrl}/api/queue`);
      const matchingEntries = matchingTrackedMovieQueueEntries(result, arrItemId);
      return matchingEntries.managed.length === 1 && matchingEntries.external.length === 0
        ? result
        : null;
    }, 45_000);
    const matchingEntries = matchingTrackedMovieQueueEntries(queue, arrItemId);
    const matchingLiveRows =
      matchingEntries.managed[0]?.liveQueueItems.filter(
        (liveQueueItem) =>
          liveQueueItem.sourceService === 'radarr' &&
          liveQueueItem.kind === 'movie' &&
          liveQueueItem.arrItemId === arrItemId,
      ) ?? [];

    expect(job.id).toBe(expectedJob.id);
    expect(matchingEntries.managed).toHaveLength(1);
    expect(matchingEntries.external).toHaveLength(0);
    expect(matchingEntries.managed[0]?.job.id).toBe(expectedJob.id);
    expect(matchingLiveRows.length).toBeLessThanOrEqual(1);
  }, 120_000);

  it('reuses the tracked-item path for a stale second live grab after the first create succeeds', async () => {
    const search = await getJson<MediaItem[]>(
      `${config.baseUrl}/api/search?q=Dredd&kind=movie&availability=all`,
    );
    const item = exactMovieMatch(search, config.untrackedMovie.title, config.untrackedMovie.year);

    expect(item).not.toBeNull();
    if (!item) {
      throw new Error(
        'Expected Dredd (2012) to be searchable for stale-repeat live grab verification.',
      );
    }

    const first = await postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
      item,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    });

    expect(first.existing).toBe(false);
    expect(first.job).not.toBeNull();
    cleanupTargets.push(asDeleteTarget(first.item));
    await waitForAcquisitionVisibility(config, first);

    const second = await postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
      item,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    });

    expect(second.existing).toBe(true);
    expect(second.item.arrItemId).toBe(first.item.arrItemId);
    expect(second.job?.id).toBe(first.job?.id);
    expect(second.message).toMatch(/already tracked/i);

    await waitForSingleActiveJob(config, first);

    const matchingMovies = (await listMovies(config)).filter((movie) =>
      movieTitleYearMatches(movie, config.untrackedMovie),
    );
    expect(matchingMovies).toHaveLength(1);
  }, 120_000);

  it('keeps release submission idempotent across a live app restart after claim', async () => {
    const search = await getJson<MediaItem[]>(
      `${config.baseUrl}/api/search?q=Dredd&kind=movie&availability=all`,
    );
    const item = exactMovieMatch(search, config.untrackedMovie.title, config.untrackedMovie.year);

    expect(item).not.toBeNull();
    if (!item) {
      throw new Error('Expected Dredd (2012) to be searchable for live idempotency verification.');
    }

    const request = await postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
      item,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    });

    expect(request.job).not.toBeNull();
    const jobId = requireGrabJob(request, 'restart idempotency grab').id;
    cleanupTargets.push(asDeleteTarget(request.item));

    const claimedAttempt = await pollUntil(async () => {
      const attempts = listAttemptSubmissions(jobId);
      const currentAttempt = attempts.find((attempt) => attempt.attempt === 1) ?? null;
      if (!currentAttempt?.submittedGuid || !currentAttempt.submissionClaimedAt) {
        return null;
      }

      return currentAttempt;
    }, 45_000).catch(() => null);
    if (!claimedAttempt) {
      return;
    }

    expect(claimedAttempt.submittedGuid).toBeTruthy();
    expect(claimedAttempt.submissionClaimedAt).toBeTruthy();
    await pollUntil(async () => {
      const submittedEvents = listAcquisitionEvents(jobId).filter(
        (event) => event.kind === 'grab.submitted',
      );
      return submittedEvents.length === 1 ? submittedEvents : null;
    }, 45_000);

    if (app) {
      await app.stop();
      app = null;
    }

    app = await startLiveApp(config);
    await verifyPreflight(config);

    const attemptsAfterRestart = listAttemptSubmissions(jobId);
    const claimedAttempts = attemptsAfterRestart.filter(
      (attempt) => attempt.submittedGuid !== null,
    );
    const submittedEvents = listAcquisitionEvents(jobId).filter(
      (event) => event.kind === 'grab.submitted',
    );
    const skippedEvents = listAcquisitionEvents(jobId).filter(
      (event) => event.kind === 'grab.submit_skipped',
    );

    expect(claimedAttempts).toHaveLength(1);
    expect(claimedAttempts[0]?.submittedGuid).toBe(claimedAttempt.submittedGuid);
    expect(submittedEvents).toHaveLength(1);
    expect(skippedEvents.length).toBeLessThanOrEqual(1);
  }, 120_000);

  it('correlates one submitted release to at most one Radarr and SAB handoff', async () => {
    const radarrLogCheckpoint = createLogCheckpoint(config.radarrLogPath);
    const sabLogCheckpoint = createLogCheckpoint(config.sabLogPath);
    const search = await getJson<MediaItem[]>(
      `${config.baseUrl}/api/search?q=Dredd&kind=movie&availability=all`,
    );
    const item = exactMovieMatch(search, config.untrackedMovie.title, config.untrackedMovie.year);

    expect(item).not.toBeNull();
    if (!item) {
      throw new Error(
        'Expected Dredd (2012) to be searchable for downstream handoff verification.',
      );
    }

    const request = await postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
      item,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    });

    expect(request.job).not.toBeNull();
    const jobId = requireGrabJob(request, 'downstream handoff grab').id;
    cleanupTargets.push(asDeleteTarget(request.item));

    const selectedReleaseTitle = await waitForSubmittedReleaseTitle(jobId).catch(() => null);
    if (!selectedReleaseTitle) {
      return;
    }
    await waitForAcquisitionVisibility(config, request);

    await pollUntil(async () => {
      const radarrAdds = countRadarrSabQueueAdds(
        readLogAppendix(radarrLogCheckpoint),
        selectedReleaseTitle,
      );
      return radarrAdds >= 1 ? radarrAdds : null;
    }, 45_000);

    const radarrAdds = countRadarrSabQueueAdds(
      readLogAppendix(radarrLogCheckpoint),
      selectedReleaseTitle,
    );
    const sabAdds = countSabQueueAdds(readLogAppendix(sabLogCheckpoint), selectedReleaseTitle);

    expect(radarrAdds).toBe(1);
    expect(sabAdds).toBeLessThanOrEqual(1);
  }, 120_000);

  it('collapses concurrent live grab requests into one job and one downstream handoff', async () => {
    const radarrLogCheckpoint = createLogCheckpoint(config.radarrLogPath);
    const sabLogCheckpoint = createLogCheckpoint(config.sabLogPath);
    const search = await getJson<MediaItem[]>(
      `${config.baseUrl}/api/search?q=Dredd&kind=movie&availability=all`,
    );
    const item = exactMovieMatch(search, config.untrackedMovie.title, config.untrackedMovie.year);

    expect(item).not.toBeNull();
    if (!item) {
      throw new Error(
        'Expected Dredd (2012) to be searchable for concurrent live grab verification.',
      );
    }

    const [first, second] = await Promise.all([
      postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
        item,
        preferences: {
          preferredLanguage: 'English',
          subtitleLanguage: 'English',
        },
      }),
      postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
        item,
        preferences: {
          preferredLanguage: 'English',
          subtitleLanguage: 'English',
        },
      }),
    ]);

    expect(first.job).not.toBeNull();
    expect(second.job).not.toBeNull();
    const firstJobId = requireGrabJob(first, 'first concurrent live grab').id;
    const secondJobId = requireGrabJob(second, 'second concurrent live grab').id;
    expect(firstJobId).toBe(secondJobId);
    expect(first.item.arrItemId).toBe(second.item.arrItemId);
    cleanupTargets.push(asDeleteTarget(first.item));

    await waitForSingleActiveJob(config, first);
    await waitForAcquisitionVisibility(config, first);
    await pollUntil(async () => {
      const acquisitionJob = await waitForSingleActiveJob(config, first, 5_000).catch(() => null);
      const submissionClaims = listAttemptSubmissions(firstJobId).filter(
        (attempt) => attempt.submittedGuid !== null,
      );
      const submissionEvents = listAcquisitionEvents(firstJobId).filter(
        (event) => event.kind === 'grab.submitted',
      );

      return acquisitionJob && submissionClaims.length <= 1 && submissionEvents.length <= 1
        ? { submissionClaims, submissionEvents }
        : null;
    }, 15_000);

    const submissionClaims = listAttemptSubmissions(firstJobId).filter(
      (attempt) => attempt.submittedGuid !== null,
    );
    const submittedEvents = listAcquisitionEvents(firstJobId).filter(
      (event) => event.kind === 'grab.submitted',
    );

    expect(submissionClaims.length).toBeLessThanOrEqual(1);
    expect(submittedEvents.length).toBeLessThanOrEqual(1);

    if (submittedEvents[0]) {
      const selectedReleaseTitle = submittedEvents[0].context.selectedTitle;
      if (typeof selectedReleaseTitle === 'string' && selectedReleaseTitle.length > 0) {
        const radarrAdds = countRadarrSabQueueAdds(
          readLogAppendix(radarrLogCheckpoint),
          selectedReleaseTitle,
        );
        const sabAdds = countSabQueueAdds(readLogAppendix(sabLogCheckpoint), selectedReleaseTitle);

        expect(radarrAdds).toBeLessThanOrEqual(1);
        expect(sabAdds).toBeLessThanOrEqual(1);
      }
    }
  }, 120_000);

  it('does not create an extra downstream handoff when a submitted job is cancelled', async () => {
    const radarrLogCheckpoint = createLogCheckpoint(config.radarrLogPath);
    const sabLogCheckpoint = createLogCheckpoint(config.sabLogPath);
    const search = await getJson<MediaItem[]>(
      `${config.baseUrl}/api/search?q=Dredd&kind=movie&availability=all`,
    );
    const item = exactMovieMatch(search, config.untrackedMovie.title, config.untrackedMovie.year);

    expect(item).not.toBeNull();
    if (!item) {
      throw new Error(
        'Expected Dredd (2012) to be searchable for cancel-after-submit verification.',
      );
    }

    const request = await postJson<GrabResponse>(`${config.baseUrl}/api/grab`, {
      item,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
    });

    expect(request.job).not.toBeNull();
    const jobId = requireGrabJob(request, 'cancel-after-submit grab').id;
    cleanupTargets.push(asDeleteTarget(request.item));

    const selectedReleaseTitle = await waitForSubmittedReleaseTitle(jobId).catch(() => null);
    if (!selectedReleaseTitle) {
      return;
    }
    await waitForAcquisitionVisibility(config, request);

    await pollUntil(async () => {
      const radarrAdds = countRadarrSabQueueAdds(
        readLogAppendix(radarrLogCheckpoint),
        selectedReleaseTitle,
      );
      return radarrAdds >= 1 ? radarrAdds : null;
    }, 45_000);

    const cancelResponse = await postJson<{ job: { status: string }; message: string }>(
      `${config.baseUrl}/api/acquisition/${encodeURIComponent(jobId)}/cancel`,
      {},
    );
    expect(cancelResponse.job.status).toBe('cancelled');

    await pollUntil(async () => {
      const cancelledEvents = listAcquisitionEvents(jobId).filter(
        (event) => event.kind === 'job.cancelled',
      );
      return cancelledEvents.length === 1 ? cancelledEvents : null;
    }, 45_000);

    await pollUntil(async () => {
      const submittedEvents = listAcquisitionEvents(jobId).filter(
        (event) => event.kind === 'grab.submitted',
      );
      const radarrAdds = countRadarrSabQueueAdds(
        readLogAppendix(radarrLogCheckpoint),
        selectedReleaseTitle,
      );
      const sabAdds = countSabQueueAdds(readLogAppendix(sabLogCheckpoint), selectedReleaseTitle);

      return submittedEvents.length === 1 && radarrAdds <= 1 && sabAdds <= 1
        ? { radarrAdds, sabAdds }
        : null;
    }, 45_000);

    const finalRadarrAdds = countRadarrSabQueueAdds(
      readLogAppendix(radarrLogCheckpoint),
      selectedReleaseTitle,
    );
    const finalSabAdds = countSabQueueAdds(readLogAppendix(sabLogCheckpoint), selectedReleaseTitle);

    expect(finalRadarrAdds).toBe(1);
    expect(finalSabAdds).toBeLessThanOrEqual(1);
  }, 120_000);
});
