import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { AcquisitionEventRepository } from '$lib/server/acquisition-event-repository';
import { AcquisitionJobRepository } from '$lib/server/acquisition-job-repository';

const databases: DatabaseSync[] = [];

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }
});

describe('AcquisitionJobRepository', () => {
  it('creates, loads, and updates jobs with attempts and failed guid dedupe', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const job = jobs.createJob({
      arrItemId: 101,
      itemId: 'movie:101',
      kind: 'movie',
      maxRetries: 4,
      preferredReleaser: 'flux',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'The Matrix',
    });

    jobs.upsertAttempt(job.id, {
      attempt: 1,
      reasonCode: 'validated',
      releaseTitle: 'The.Matrix.1999.1080p.WEB-DL-Flux',
      releaser: 'flux',
      startedAt: '2026-04-02T10:00:00.000Z',
      status: 'grabbing',
    });
    jobs.addFailedGuid(job.id, 'guid-1');
    jobs.addFailedGuid(job.id, 'guid-1');
    jobs.updateJob(job.id, {
      status: 'searching',
    });
    jobs.updateJob(job.id, {
      status: 'grabbing',
    });
    jobs.updateJob(job.id, {
      autoRetrying: true,
      progress: 55,
      queueStatus: 'Waiting for download',
      reasonCode: 'missing-subs',
      status: 'validating',
    });

    const loaded = jobs.getJob(job.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.status).toBe('validating');
    expect(loaded?.autoRetrying).toBe(true);
    expect(loaded?.progress).toBe(55);
    expect(loaded?.reasonCode).toBe('missing-subs');
    expect(loaded?.attempts).toHaveLength(1);
    expect(loaded?.attempts[0]?.reasonCode).toBe('validated');
    expect(loaded?.attempts[0]?.releaseTitle).toContain('Flux');
    expect(loaded?.attempts[0]?.submittedGuid).toBeNull();
    expect(loaded?.failedGuids).toEqual(['guid-1']);
  });

  it('claims release submission only once per attempt', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const job = jobs.createJob({
      arrItemId: 102,
      itemId: 'movie:102',
      kind: 'movie',
      maxRetries: 4,
      preferredReleaser: 'flux',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Submission Claim',
    });

    jobs.upsertAttempt(job.id, {
      attempt: 1,
      releaseTitle: 'Submission.Claim.2026.1080p.WEB-DL-FLUX',
      releaser: 'flux',
      startedAt: '2026-04-02T10:00:00.000Z',
      status: 'grabbing',
    });

    expect(jobs.claimAttemptReleaseSubmission(job.id, 1, 'guid-1', 7)).toBe('claimed');
    expect(jobs.claimAttemptReleaseSubmission(job.id, 1, 'guid-1', 7)).toBe('already-claimed');
    expect(() => jobs.claimAttemptReleaseSubmission(job.id, 1, 'guid-2', 7)).toThrow(
      /already claimed release submission/,
    );

    const loaded = jobs.getJob(job.id);
    expect(loaded?.attempts[0]?.submittedGuid).toBe('guid-1');
    expect(loaded?.attempts[0]?.submittedIndexerId).toBe(7);
    expect(loaded?.attempts[0]?.submissionClaimedAt).toBeTruthy();
  });

  it('claims search only once per attempt while a search is already active', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const job = jobs.createJob({
      arrItemId: 103,
      itemId: 'movie:103',
      kind: 'movie',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Search Claim',
    });

    expect(jobs.claimAttemptSearch(job.id, 1)).toBe('claimed');
    expect(jobs.claimAttemptSearch(job.id, 1)).toBe('already-claimed');

    const loaded = jobs.getJob(job.id);
    expect(loaded?.attempts[0]?.status).toBe('searching');
    expect(loaded?.attempts[0]?.startedAt).toBeTruthy();
    expect(loaded?.attempts[0]?.finishedAt).toBeNull();
  });

  it('returns the most recent completed releaser for a matching title', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const job = jobs.createJob({
      arrItemId: 202,
      itemId: 'movie:202',
      kind: 'movie',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Alien',
    });

    jobs.updateJob(job.id, { status: 'searching' });
    jobs.updateJob(job.id, { status: 'grabbing' });
    jobs.updateJob(job.id, { status: 'validating' });
    jobs.updateJob(job.id, {
      completedAt: '2026-04-02T10:10:00.000Z',
      selectedReleaser: 'framestor',
      status: 'completed',
    });

    expect(jobs.findPreferredReleaser('movie', 'Alien')).toBe('framestor');
  });

  it('deletes all jobs for an Arr item and cascades related rows', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const job = jobs.createJob({
      arrItemId: 404,
      itemId: 'movie:404',
      kind: 'movie',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Missing Title',
    });

    jobs.upsertAttempt(job.id, {
      attempt: 1,
      status: 'failed',
    });
    jobs.addFailedGuid(job.id, 'guid-404');

    jobs.deleteJobsByArrItem(404, 'movie', 'radarr');

    expect(jobs.getJob(job.id)).toBeNull();
    expect(jobs.listJobs()).toEqual([]);
  });

  it('treats attempt and failed-guid writes as no-ops when the parent job is gone', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const job = jobs.createJob({
      arrItemId: 405,
      itemId: 'movie:405',
      kind: 'movie',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'radarr',
      title: 'Deleted Title',
    });

    jobs.deleteJobsByArrItem(405, 'movie', 'radarr');

    expect(() =>
      jobs.upsertAttempt(job.id, {
        attempt: 1,
        status: 'failed',
      }),
    ).not.toThrow();
    expect(() => jobs.addFailedGuid(job.id, 'guid-405')).not.toThrow();
    expect(jobs.getJob(job.id)).toBeNull();
  });

  it('scopes active job lookups by source service', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const radarrJob = jobs.createJob({
      arrItemId: 606,
      itemId: 'movie:606',
      kind: 'movie',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      sourceService: 'radarr',
      title: 'Collision Title',
    });
    const sonarrJob = jobs.createJob({
      arrItemId: 606,
      itemId: 'series:606',
      kind: 'movie',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      sourceService: 'sonarr',
      title: 'Collision Title',
    });

    expect(jobs.findActiveJob(606, 'movie', 'radarr')?.id).toBe(radarrJob.id);
    expect(jobs.findActiveJob(606, 'movie', 'sonarr')?.id).toBe(sonarrJob.id);
    expect(jobs.listActiveJobsByArrItem(606, 'movie', 'radarr')).toHaveLength(1);
    expect(jobs.listActiveJobsByArrItem(606, 'movie', 'sonarr')).toHaveLength(1);
  });

  it('reuses the active job for a matching Arr identity and preserves target scope', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const first = jobs.createOrReuseActiveJob({
      arrItemId: 909,
      itemId: 'series:909',
      kind: 'series',
      maxRetries: 4,
      preferredReleaser: 'flux',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'sonarr',
      targetEpisodeIds: [101, 102],
      targetSeasonNumbers: [1],
      title: 'Andor',
    });
    const second = jobs.createOrReuseActiveJob({
      arrItemId: 909,
      itemId: 'series:909',
      kind: 'series',
      maxRetries: 4,
      preferredReleaser: 'framestor',
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'sonarr',
      targetEpisodeIds: [201],
      targetSeasonNumbers: [2],
      title: 'Andor',
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.targetSeasonNumbers).toEqual([1]);
    expect(second.job.targetEpisodeIds).toEqual([101, 102]);
    expect(jobs.listActiveJobsByArrItem(909, 'series', 'sonarr')).toHaveLength(1);
  });

  it('allows a fresh active job after the previous one becomes terminal', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const first = jobs.createOrReuseActiveJob({
      arrItemId: 910,
      itemId: 'series:910',
      kind: 'series',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      sourceService: 'sonarr',
      targetEpisodeIds: [301, 302],
      targetSeasonNumbers: [3],
      title: 'Fresh Start',
    });

    jobs.updateJob(first.job.id, {
      completedAt: '2026-04-13T12:30:00.000Z',
      reasonCode: 'cancelled',
      status: 'cancelled',
      validationSummary: 'Cancelled by user',
    });

    const second = jobs.createOrReuseActiveJob({
      arrItemId: 910,
      itemId: 'series:910',
      kind: 'series',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      sourceService: 'sonarr',
      targetEpisodeIds: [401],
      targetSeasonNumbers: [4],
      title: 'Fresh Start',
    });

    expect(second.created).toBe(true);
    expect(second.job.id).not.toBe(first.job.id);
    expect(second.job.targetSeasonNumbers).toEqual([4]);
    expect(second.job.targetEpisodeIds).toEqual([401]);
    expect(jobs.listActiveJobsByArrItem(910, 'series', 'sonarr')).toHaveLength(1);
  });

  it('rejects illegal acquisition status transitions', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const job = jobs.createJob({
      arrItemId: 707,
      itemId: 'movie:707',
      kind: 'movie',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      sourceService: 'radarr',
      title: 'Transition Title',
    });

    jobs.updateJob(job.id, {
      status: 'searching',
    });

    expect(() =>
      jobs.updateJob(job.id, {
        status: 'completed',
      }),
    ).toThrow(/Invalid acquisition job status transition/);
  });

  it('rejects attempt regressions', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const job = jobs.createJob({
      arrItemId: 708,
      itemId: 'movie:708',
      kind: 'movie',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      sourceService: 'radarr',
      title: 'Attempt Regression',
    });

    jobs.updateJob(job.id, { status: 'searching' });
    jobs.updateJob(job.id, { status: 'grabbing' });
    jobs.updateJob(job.id, {
      attempt: 2,
      status: 'retrying',
    });

    expect(() =>
      jobs.updateJob(job.id, {
        attempt: 1,
      }),
    ).toThrow(/Invalid acquisition attempt regression/);
  });

  it('drops and recreates legacy acquisition tables instead of preserving require_subtitles', () => {
    const database = createDatabase();
    database.exec(`
      CREATE TABLE acquisition_jobs (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        arr_item_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        source_service TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        max_retries INTEGER NOT NULL,
        current_release TEXT,
        selected_releaser TEXT,
        preferred_releaser TEXT,
        failure_reason TEXT,
        validation_summary TEXT,
        progress REAL,
        queue_status TEXT,
        preferred_language TEXT NOT NULL,
        require_subtitles INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);
    database
      .prepare(
        `INSERT INTO acquisition_jobs (
          id, item_id, arr_item_id, kind, title, source_service, status, attempt,
          max_retries, preferred_language, require_subtitles, started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy-job',
        'movie:1',
        1,
        'movie',
        'Legacy Item',
        'radarr',
        'queued',
        1,
        4,
        'English',
        1,
        '2026-04-13T12:00:00.000Z',
        '2026-04-13T12:00:00.000Z',
      );

    const jobs = new AcquisitionJobRepository(database);
    const columns = database
      .prepare('PRAGMA table_info(acquisition_jobs)')
      .all() as Array<{ name: string }>;
    const job = jobs.createJob({
      arrItemId: 505,
      itemId: 'movie:505',
      kind: 'movie',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'Any',
      },
      sourceService: 'radarr',
      title: 'Legacy Title',
    });
    const loaded = jobs.getJob(job.id);

    expect(columns.some((column) => column.name === 'require_subtitles')).toBe(false);
    expect(jobs.getJob('legacy-job')).toBeNull();
    expect(loaded?.preferences.subtitleLanguage).toBe('Any');
  });
});

describe('AcquisitionEventRepository', () => {
  it('persists and reads job events newest-first', () => {
    const database = createDatabase();
    const jobs = new AcquisitionJobRepository(database);
    const events = new AcquisitionEventRepository(database);
    const job = jobs.createJob({
      arrItemId: 303,
      itemId: 'series:303',
      kind: 'series',
      maxRetries: 4,
      preferredReleaser: null,
      preferences: {
        preferredLanguage: 'English',
        subtitleLanguage: 'English',
      },
      sourceService: 'sonarr',
      title: 'Andor',
    });

    events.append(job.id, 'job.created', 'info', 'Created job', {
      attempt: 1,
    });
    events.append(job.id, 'search.started', 'info', 'Search started', {
      attempt: 1,
    });

    const loaded = events.listByJob(job.id);

    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.kind).toBe('search.started');
    expect(loaded[1]?.kind).toBe('job.created');
    expect(loaded[0]?.context.attempt).toBe(1);
  });
});
