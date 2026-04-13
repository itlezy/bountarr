import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AcquisitionEventRepository } from '$lib/server/acquisition-event-repository';
import { manualSelectionQueuedStatus } from '$lib/server/acquisition-domain';
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
      probeAttempt: vi.fn(),
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
      probeAttempt: vi.fn(),
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
      probeAttempt: vi.fn(),
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
      probeAttempt: vi.fn(),
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
        harness.jobs.deleteJobsByArrItem(job.arrItemId, job.kind, job.sourceService);
        throw new Error('selection exploded after reset');
      }),
      probeAttempt: vi.fn(),
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

  it('reconciles validating jobs on startup before blindly resuming them', async () => {
    const harness = createHarness();
    const job = harness.jobs.createJob({
      arrItemId: 777,
      itemId: 'movie:777',
      kind: 'movie',
      maxRetries: 2,
      preferredReleaser: 'flux',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Startup Title',
    });

    harness.jobs.updateJob(job.id, { status: 'searching' });
    harness.jobs.updateJob(job.id, {
      currentRelease: 'Startup.Title.2026.1080p.WEB-DL-FLUX',
      selectedReleaser: 'flux',
      status: 'grabbing',
    });
    harness.jobs.updateJob(job.id, {
      queueStatus: 'Downloading',
      status: 'validating',
    });
    harness.jobs.upsertAttempt(job.id, {
      attempt: 1,
      releaseTitle: 'Startup.Title.2026.1080p.WEB-DL-FLUX',
      releaser: 'flux',
      startedAt: '2026-04-13T10:00:00.000Z',
      status: 'grabbing',
    });

    const findReleaseSelection = vi.fn();
    const runner = new AcquisitionRunner(harness.jobs, harness.lifecycle, {
      findReleaseSelection,
      probeAttempt: vi.fn().mockResolvedValue({
        outcome: 'success',
        preferredReleaser: 'flux',
        progress: 100,
        queueStatus: 'Imported',
        reasonCode: 'validated',
        summary: 'Imported and validated',
      }),
      submitSelectedRelease: vi.fn(),
      waitForAttemptOutcome: vi.fn(),
    });

    runner.ensureWorkers();

    await vi.waitFor(() => {
      expect(harness.jobs.getJob(job.id)?.status).toBe('completed');
    });

    expect(findReleaseSelection).not.toHaveBeenCalled();
    runner.dispose();
  });

  it('fails queued manual selections that were lost before restart recovery', async () => {
    const harness = createHarness();
    const job = harness.jobs.createJob({
      arrItemId: 888,
      itemId: 'series:888',
      kind: 'series',
      maxRetries: 2,
      preferredReleaser: 'flux',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'sonarr',
      title: 'Lost Manual Pick',
    });

    harness.jobs.updateJob(job.id, {
      queueStatus: manualSelectionQueuedStatus,
      status: 'queued',
      validationSummary: 'User selected Lost.Manual.Pick.S01.1080p.WEB-DL-FLUX',
    });

    const runner = new AcquisitionRunner(harness.jobs, harness.lifecycle, {
      findReleaseSelection: vi.fn(),
      probeAttempt: vi.fn(),
      submitSelectedRelease: vi.fn(),
      waitForAttemptOutcome: vi.fn(),
    });

    runner.ensureWorkers();

    await vi.waitFor(() => {
      expect(harness.jobs.getJob(job.id)?.status).toBe('failed');
    });

    const failed = harness.jobs.getJob(job.id);
    expect(failed?.reasonCode).toBe('manual-selection-lost');
    expect(failed?.queueStatus).toBe('Manual selection lost');
    runner.dispose();
  });

  it('dedupes reconciliation scheduling across repeated worker startup calls', async () => {
    const harness = createHarness();
    const job = harness.jobs.createJob({
      arrItemId: 889,
      itemId: 'movie:889',
      kind: 'movie',
      maxRetries: 2,
      preferredReleaser: 'flux',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Deduped Reconciliation',
    });

    harness.jobs.updateJob(job.id, { status: 'searching' });
    harness.jobs.updateJob(job.id, {
      currentRelease: 'Deduped.Reconciliation.2026.1080p.WEB-DL-FLUX',
      selectedReleaser: 'flux',
      status: 'grabbing',
    });
    harness.jobs.updateJob(job.id, {
      queueStatus: 'Downloading',
      status: 'validating',
    });
    harness.jobs.upsertAttempt(job.id, {
      attempt: 1,
      releaseTitle: 'Deduped.Reconciliation.2026.1080p.WEB-DL-FLUX',
      releaser: 'flux',
      startedAt: '2026-04-13T10:00:00.000Z',
      status: 'grabbing',
    });

    type ProbeSuccess = {
      outcome: 'success';
      preferredReleaser: 'flux';
      progress: 100;
      queueStatus: 'Imported';
      reasonCode: 'validated';
      summary: 'Imported and validated';
    };
    let completeProbe!: (value: ProbeSuccess) => void;
    const probeAttempt = vi.fn().mockImplementation(
      () =>
        new Promise<ProbeSuccess>((resolve) => {
          completeProbe = resolve;
        }),
    );

    const runner = new AcquisitionRunner(harness.jobs, harness.lifecycle, {
      findReleaseSelection: vi.fn(),
      probeAttempt,
      submitSelectedRelease: vi.fn(),
      waitForAttemptOutcome: vi.fn(),
    });

    runner.ensureWorkers();
    runner.ensureWorkers();

    await vi.waitFor(() => {
      expect(probeAttempt).toHaveBeenCalledTimes(1);
    });

    completeProbe({
      outcome: 'success',
      preferredReleaser: 'flux',
      progress: 100,
      queueStatus: 'Imported',
      reasonCode: 'validated',
      summary: 'Imported and validated',
    });

    await vi.waitFor(() => {
      expect(harness.jobs.getJob(job.id)?.status).toBe('completed');
    });

    runner.dispose();
  });

  it('uses the latest persisted progress when a wait cycle times out', async () => {
    const harness = createHarness();
    const job = harness.jobs.createJob({
      arrItemId: 890,
      itemId: 'movie:890',
      kind: 'movie',
      maxRetries: 1,
      preferredReleaser: 'flux',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Timeout Title',
    });

    const runner = new AcquisitionRunner(harness.jobs, harness.lifecycle, {
      findReleaseSelection: vi
        .fn()
        .mockResolvedValue(createSelectionResult('guid-timeout', 'Timeout.Title.2026.1080p.WEB-DL-FLUX')),
      probeAttempt: vi.fn(),
      submitSelectedRelease: vi.fn().mockResolvedValue(undefined),
      waitForAttemptOutcome: vi.fn().mockImplementation(async (_job, _startedAt, onProgress) => {
        onProgress?.({
          progress: 67,
          queueStatus: 'Downloading',
        });

        return {
          outcome: 'timeout',
          preferredReleaser: null,
          progress: null,
          queueStatus: null,
          reasonCode: 'import-timeout',
          summary: 'Timed out waiting for import',
        };
      }),
    });

    runner.enqueue(job.id);

    await vi.waitFor(() => {
      expect(harness.jobs.getJob(job.id)?.status).toBe('failed');
    });

    const failed = harness.jobs.getJob(job.id);
    expect(failed?.progress).toBe(67);
    expect(failed?.queueStatus).toBe('Downloading');
  });

  it('prefers a manual selection that arrives while auto-search results are being processed', async () => {
    const harness = createHarness();
    const job = harness.jobs.createJob({
      arrItemId: 891,
      itemId: 'movie:891',
      kind: 'movie',
      maxRetries: 2,
      preferredReleaser: 'flux',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Race Condition Title',
    });

    const automaticSelection = createSelectionResult(
      'guid-auto',
      'Race.Condition.Title.2026.1080p.WEB-DL-AUTO',
    );
    const manualSelection = createSelectionResult(
      'guid-manual',
      'Race.Condition.Title.2026.1080p.WEB-DL-MANUAL',
    );
    let runner!: AcquisitionRunner;
    const submitSelectedRelease = vi.fn().mockResolvedValue(undefined);

    runner = new AcquisitionRunner(harness.jobs, harness.lifecycle, {
      findReleaseSelection: vi.fn().mockImplementation(async () => {
        const queuedForManual = harness.jobs.updateJob(job.id, {
          queueStatus: manualSelectionQueuedStatus,
          status: 'queued',
        });
        runner.enqueueSelectedRelease(queuedForManual.id, manualSelection);
        return automaticSelection;
      }),
      probeAttempt: vi.fn(),
      submitSelectedRelease,
      waitForAttemptOutcome: vi.fn().mockResolvedValue({
        outcome: 'success',
        preferredReleaser: 'manual',
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

    expect(submitSelectedRelease).toHaveBeenCalledTimes(1);
    expect(submitSelectedRelease).toHaveBeenCalledWith(
      expect.objectContaining({ id: job.id }),
      manualSelection.selection,
    );
    expect(harness.jobs.getJob(job.id)?.currentRelease).toBe(
      'Race.Condition.Title.2026.1080p.WEB-DL-MANUAL',
    );
  });

  it('does not post the same release twice when an attempt re-enters after submission was already claimed', async () => {
    const harness = createHarness();
    const job = harness.jobs.createJob({
      arrItemId: 892,
      itemId: 'movie:892',
      kind: 'movie',
      maxRetries: 2,
      preferredReleaser: 'flux',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Duplicate Submit Guard',
    });

    harness.jobs.upsertAttempt(job.id, {
      attempt: 1,
      releaseTitle: 'Duplicate.Submit.Guard.2026.1080p.WEB-DL-FLUX',
      releaser: 'flux',
      startedAt: '2026-04-13T10:00:00.000Z',
      status: 'grabbing',
      submittedGuid: 'guid-1',
      submittedIndexerId: 5,
      submissionClaimedAt: '2026-04-13T10:01:00.000Z',
    });

    const submitSelectedRelease = vi.fn().mockResolvedValue(undefined);
    const runner = new AcquisitionRunner(harness.jobs, harness.lifecycle, {
      findReleaseSelection: vi
        .fn()
        .mockResolvedValue(
          createSelectionResult('guid-1', 'Duplicate.Submit.Guard.2026.1080p.WEB-DL-FLUX'),
        ),
      probeAttempt: vi.fn(),
      submitSelectedRelease,
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

    expect(submitSelectedRelease).not.toHaveBeenCalled();
    expect(
      harness.events.listByJob(job.id).some((event) => event.kind === 'grab.submit_skipped'),
    ).toBe(true);
  });
});
