import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AcquisitionEventRepository } from '$lib/server/acquisition-event-repository';
import { AcquisitionJobRepository } from '$lib/server/acquisition-job-repository';
import { AcquisitionLifecycle } from '$lib/server/acquisition-lifecycle';
import { AcquisitionRunner } from '$lib/server/acquisition-runner';
import type { ReleaseSelectionResult } from '$lib/server/acquisition-selection';

const databases: DatabaseSync[] = [];

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  return database;
}

function createSelectionResult(guid: string, title: string): ReleaseSelectionResult {
  return {
    manualResults: [],
    mappedReleases: 1,
    releasesFound: 1,
    selectedGuid: guid,
    selectedRelease: {
      guid,
      indexer: 'Indexer',
      indexerId: 5,
      languages: ['English'],
      protocol: 'torrent',
      reason: 'matched proven releaser',
      score: 500,
      size: 1_000,
      title,
    },
    selection: {
      decision: {
        accepted: 1,
        considered: 1,
        reason: 'matched proven releaser',
        selected: {
          guid,
          indexer: 'Indexer',
          indexerId: 5,
          languages: ['English'],
          protocol: 'torrent',
          reason: 'matched proven releaser',
          score: 500,
          size: 1_000,
          title,
        },
      },
      payload: {},
    } as ReleaseSelectionResult['selection'],
  };
}

function createRejectedSelectionResult(
  reason = 'No acceptable release passed the local scoring rules',
): ReleaseSelectionResult {
  return {
    manualResults: [],
    mappedReleases: 1,
    releasesFound: 1,
    selectedGuid: null,
    selectedRelease: null,
    selection: {
      decision: {
        accepted: 0,
        considered: 1,
        reason,
        selected: null,
      },
      payload: null,
    } as ReleaseSelectionResult['selection'],
  };
}

function createHarness() {
  const database = createDatabase();
  const jobs = new AcquisitionJobRepository(database);
  const events = new AcquisitionEventRepository(database);
  const lifecycle = new AcquisitionLifecycle(jobs, events);

  return {
    events,
    jobs,
    lifecycle,
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe('AcquisitionRunner', () => {
  it('completes a queued job and records a durable event timeline', async () => {
    const harness = createHarness();
    const job = harness.jobs.createJob({
      arrItemId: 111,
      itemId: 'movie:111',
      kind: 'movie',
      maxRetries: 2,
      preferredReleaser: 'flux',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'The Matrix',
    });

    const runner = new AcquisitionRunner(harness.jobs, harness.lifecycle, {
      findReleaseSelection: vi
        .fn()
        .mockResolvedValue(createSelectionResult('guid-1', 'The.Matrix.1999.1080p.WEB-DL-FLUX')),
      submitSelectedRelease: vi.fn().mockResolvedValue(undefined),
      waitForAttemptOutcome: vi.fn().mockResolvedValue({
        outcome: 'success',
        preferredReleaser: 'flux',
        progress: 100,
        queueStatus: 'Imported',
        reasonCode: 'validated',
        summary: 'Imported and validated',
      }),
    });

    runner.enqueue(job.id);

    await vi.waitFor(() => {
      expect(harness.jobs.getJob(job.id)?.status).toBe('completed');
    });

    const completed = harness.jobs.getJob(job.id);
    const eventKinds = harness.events
      .listByJob(job.id)
      .map((event) => event.kind)
      .reverse();

    expect(completed?.preferredReleaser).toBe('flux');
    expect(completed?.attempts[0]?.status).toBe('completed');
    expect(eventKinds).toEqual([
      'search.started',
      'search.completed',
      'selection.chosen',
      'grab.submitted',
      'job.completed',
    ]);
  });

  it('retries after a failed validation and succeeds on the next attempt', async () => {
    const harness = createHarness();
    const job = harness.jobs.createJob({
      arrItemId: 222,
      itemId: 'movie:222',
      kind: 'movie',
      maxRetries: 3,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Alien',
    });

    const findReleaseSelection = vi
      .fn()
      .mockResolvedValueOnce(createSelectionResult('guid-1', 'Alien.1979.1080p.WEB-DL-GROUPA'))
      .mockResolvedValueOnce(createSelectionResult('guid-2', 'Alien.1979.1080p.WEB-DL-GROUPB'));
    const waitForAttemptOutcome = vi
      .fn()
      .mockResolvedValueOnce({
        outcome: 'failure',
        preferredReleaser: null,
        progress: 100,
        queueStatus: 'Imported',
        reasonCode: 'missing-subs',
        summary: 'Imported release failed validation',
      })
      .mockResolvedValueOnce({
        outcome: 'success',
        preferredReleaser: 'groupb',
        progress: 100,
        queueStatus: 'Imported',
        reasonCode: 'validated',
        summary: 'Imported and validated',
      });

    const runner = new AcquisitionRunner(harness.jobs, harness.lifecycle, {
      findReleaseSelection,
      submitSelectedRelease: vi.fn().mockResolvedValue(undefined),
      waitForAttemptOutcome,
    });

    runner.enqueue(job.id);

    await vi.waitFor(() => {
      expect(harness.jobs.getJob(job.id)?.status).toBe('completed');
    });

    const completed = harness.jobs.getJob(job.id);

    expect(findReleaseSelection).toHaveBeenCalledTimes(2);
    expect(waitForAttemptOutcome).toHaveBeenCalledTimes(2);
    expect(completed?.attempt).toBe(2);
    expect(completed?.failedGuids).toContain('guid-1');
    expect(completed?.reasonCode).toBe('validated');
    expect(completed?.attempts).toHaveLength(2);
    expect(completed?.attempts[0]?.reasonCode).toBe('missing-subs');
    expect(completed?.attempts[0]?.status).toBe('retrying');
    expect(completed?.attempts[1]?.reasonCode).toBe('validated');
    expect(completed?.attempts[1]?.status).toBe('completed');
  });

  it('suppresses duplicate enqueue calls for the same running job', async () => {
    const harness = createHarness();
    const job = harness.jobs.createJob({
      arrItemId: 333,
      itemId: 'series:333',
      kind: 'series',
      maxRetries: 1,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'sonarr',
      title: 'Andor',
    });

    let releaseSelectionCalls = 0;
    const runner = new AcquisitionRunner(harness.jobs, harness.lifecycle, {
      findReleaseSelection: vi.fn().mockImplementation(async () => {
        releaseSelectionCalls += 1;
        return createSelectionResult('guid-1', 'Andor.S01E01.1080p.WEB-DL-GROUP');
      }),
      submitSelectedRelease: vi.fn().mockResolvedValue(undefined),
      waitForAttemptOutcome: vi.fn().mockResolvedValue({
        outcome: 'success',
        preferredReleaser: 'group',
        progress: 100,
        queueStatus: 'Imported',
        reasonCode: 'validated',
        summary: 'Imported and validated',
      }),
    });

    runner.enqueue(job.id);
    runner.enqueue(job.id);

    await vi.waitFor(() => {
      expect(harness.jobs.getJob(job.id)?.status).toBe('completed');
    });

    expect(releaseSelectionCalls).toBe(1);
  });

  it('stops immediately when no acceptable release remains', async () => {
    const harness = createHarness();
    const job = harness.jobs.createJob({
      arrItemId: 444,
      itemId: 'movie:444',
      kind: 'movie',
      maxRetries: 2,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Unavailable Title',
    });

    const runner = new AcquisitionRunner(harness.jobs, harness.lifecycle, {
      findReleaseSelection: vi.fn().mockResolvedValue(createRejectedSelectionResult()),
      submitSelectedRelease: vi.fn().mockResolvedValue(undefined),
      waitForAttemptOutcome: vi.fn(),
    });

    runner.enqueue(job.id);

    await vi.waitFor(() => {
      expect(harness.jobs.getJob(job.id)?.status).toBe('failed');
    });

    const failed = harness.jobs.getJob(job.id);

    expect(failed?.reasonCode).toBe('no-acceptable-release');
    expect(failed?.autoRetrying).toBe(false);
    expect(failed?.failureReason).toBe('No acceptable release passed the local scoring rules');
  });

  it('stops cleanly when the job disappears during processing', async () => {
    const harness = createHarness();
    const job = harness.jobs.createJob({
      arrItemId: 555,
      itemId: 'movie:555',
      kind: 'movie',
      maxRetries: 2,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Vanishing Title',
    });

    const runner = new AcquisitionRunner(harness.jobs, harness.lifecycle, {
      findReleaseSelection: vi.fn().mockImplementation(async () => {
        harness.jobs.deleteJobsByArrItem(job.arrItemId, job.kind);
        throw new Error('selection exploded after reset');
      }),
      submitSelectedRelease: vi.fn().mockResolvedValue(undefined),
      waitForAttemptOutcome: vi.fn(),
    });

    runner.enqueue(job.id);

    await vi.waitFor(() => {
      expect(runner.running.size).toBe(0);
    });

    expect(harness.jobs.getJob(job.id)).toBeNull();
    expect(harness.events.listByJob(job.id)).toEqual([]);
  });
});
