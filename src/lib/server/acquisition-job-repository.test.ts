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
    expect(loaded?.failedGuids).toEqual(['guid-1']);
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

    jobs.deleteJobsByArrItem(404, 'movie');

    expect(jobs.getJob(job.id)).toBeNull();
    expect(jobs.listJobs()).toEqual([]);
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
