import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureAcquisitionSchema } from '$lib/server/acquisition-db';

const databases: DatabaseSync[] = [];
const tempDirectories: string[] = [];

function createMemoryDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  return database;
}

function createFileDatabase(): DatabaseSync {
  const directory = mkdtempSync(path.join(tmpdir(), 'bountarr-acquisition-db-'));
  tempDirectories.push(directory);
  const database = new DatabaseSync(path.join(directory, 'acquisition.db'));
  databases.push(database);
  return database;
}

function jobCount(database: DatabaseSync): number {
  const row = database.prepare('SELECT COUNT(*) AS count FROM acquisition_jobs').get() as
    | { count?: unknown }
    | undefined;
  return typeof row?.count === 'number' ? row.count : 0;
}

function indexColumns(database: DatabaseSync, indexName: string): string[] {
  return (
    database.prepare(`PRAGMA index_xinfo(${indexName})`).all() as Array<{
      cid?: unknown;
      key?: unknown;
      name?: unknown;
    }>
  )
    .filter((column) => column.key === 1 && typeof column.cid === 'number' && column.cid >= 0)
    .flatMap((column) => (typeof column.name === 'string' ? [column.name] : []));
}

function indexMetadata(
  database: DatabaseSync,
  tableName: string,
  indexName: string,
): { partial: boolean; sql: string | null; unique: boolean } {
  const index =
    (
      database.prepare(`PRAGMA index_list(${tableName})`).all() as Array<{
        name?: unknown;
        partial?: unknown;
        unique?: unknown;
      }>
    ).find((candidate) => candidate.name === indexName) ?? null;
  const sql =
    (
      database
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(indexName) as { sql?: unknown } | undefined
    )?.sql ?? null;

  return {
    partial: index?.partial === 1,
    sql: typeof sql === 'string' ? sql : null,
    unique: index?.unique === 1,
  };
}

function journalMode(database: DatabaseSync): string {
  const row = database.prepare('PRAGMA journal_mode').get() as
    | { journal_mode?: unknown }
    | undefined;
  return typeof row?.journal_mode === 'string' ? row.journal_mode.toLowerCase() : '';
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close();
  }

  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('ensureAcquisitionSchema', () => {
  it('creates the current acquisition schema with target scope columns and an active identity guard', () => {
    const database = createMemoryDatabase();

    ensureAcquisitionSchema(database);

    const columns = (
      database.prepare('PRAGMA table_info(acquisition_jobs)').all() as Array<{ name?: unknown }>
    ).flatMap((column) => (typeof column.name === 'string' ? [column.name] : []));
    const activeIdentityIndex = indexMetadata(
      database,
      'acquisition_jobs',
      'acquisition_jobs_active_identity_idx',
    );

    expect(columns).toContain('target_season_numbers_json');
    expect(columns).toContain('target_episode_ids_json');
    expect(indexColumns(database, 'acquisition_jobs_active_identity_idx')).toEqual([
      'arr_item_id',
      'kind',
      'source_service',
    ]);
    expect(activeIdentityIndex.unique).toBe(true);
    expect(activeIdentityIndex.partial).toBe(true);
    expect(activeIdentityIndex.sql).toContain(
      "WHERE status NOT IN ('completed', 'failed', 'cancelled')",
    );
  });

  it('drops and recreates acquisition storage when table columns drift', () => {
    const database = createMemoryDatabase();
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
        reason_code TEXT,
        failure_reason TEXT,
        validation_summary TEXT,
        auto_retrying INTEGER NOT NULL DEFAULT 0,
        progress REAL,
        queue_status TEXT,
        preferred_language TEXT NOT NULL,
        require_subtitles INTEGER NOT NULL DEFAULT 0,
        subtitle_language TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      INSERT INTO acquisition_jobs (
        id, item_id, arr_item_id, kind, title, source_service, status, attempt, max_retries,
        preferred_language, require_subtitles, started_at, updated_at
      ) VALUES (
        'job-legacy', 'movie:1', 1, 'movie', 'Legacy', 'radarr', 'queued', 1, 3,
        'English', 1, '2026-04-13T12:00:00.000Z', '2026-04-13T12:00:00.000Z'
      );
    `);

    ensureAcquisitionSchema(database);

    expect(jobCount(database)).toBe(0);
    expect(
      (
        database.prepare('PRAGMA table_info(acquisition_jobs)').all() as Array<{ name?: unknown }>
      ).flatMap((column) => (typeof column.name === 'string' ? [column.name] : [])),
    ).not.toContain('require_subtitles');
  });

  it('drops and recreates acquisition storage when index definitions drift', () => {
    const database = createMemoryDatabase();
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
        reason_code TEXT,
        failure_reason TEXT,
        validation_summary TEXT,
        auto_retrying INTEGER NOT NULL DEFAULT 0,
        progress REAL,
        queue_status TEXT,
        preferred_language TEXT NOT NULL,
        subtitle_language TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX acquisition_jobs_status_idx
        ON acquisition_jobs (status, updated_at DESC);
      CREATE INDEX acquisition_jobs_lookup_idx
        ON acquisition_jobs (arr_item_id, kind, status);
      CREATE TABLE acquisition_attempts (
        job_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        reason_code TEXT,
        release_title TEXT,
        releaser TEXT,
        reason TEXT,
        submitted_guid TEXT,
        submitted_indexer_id INTEGER,
        submission_claimed_at TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        PRIMARY KEY (job_id, attempt),
        FOREIGN KEY (job_id) REFERENCES acquisition_jobs(id) ON DELETE CASCADE
      );
      CREATE TABLE acquisition_failed_guids (
        job_id TEXT NOT NULL,
        guid TEXT NOT NULL,
        PRIMARY KEY (job_id, guid),
        FOREIGN KEY (job_id) REFERENCES acquisition_jobs(id) ON DELETE CASCADE
      );
      CREATE TABLE acquisition_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        context_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES acquisition_jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX acquisition_events_job_idx
        ON acquisition_events (job_id, created_at DESC);
      INSERT INTO acquisition_jobs (
        id, item_id, arr_item_id, kind, title, source_service, status, attempt, max_retries,
        preferred_language, subtitle_language, started_at, updated_at
      ) VALUES (
        'job-index-drift', 'movie:1', 1, 'movie', 'Matrix', 'radarr', 'queued', 1, 3,
        'English', 'English', '2026-04-13T12:00:00.000Z', '2026-04-13T12:00:00.000Z'
      );
    `);

    ensureAcquisitionSchema(database);

    expect(jobCount(database)).toBe(0);
    expect(indexColumns(database, 'acquisition_jobs_lookup_idx')).toEqual([
      'arr_item_id',
      'kind',
      'source_service',
      'status',
    ]);
  });

  it('drops and recreates acquisition storage when the persistent pragma policy drifts', () => {
    const database = createFileDatabase();
    ensureAcquisitionSchema(database);
    database.exec(`
      INSERT INTO acquisition_jobs (
        id, item_id, arr_item_id, kind, title, source_service, status, attempt, max_retries,
        preferred_language, subtitle_language, started_at, updated_at
      ) VALUES (
        'job-pragma-drift', 'movie:1', 1, 'movie', 'Matrix', 'radarr', 'queued', 1, 3,
        'English', 'English', '2026-04-13T12:00:00.000Z', '2026-04-13T12:00:00.000Z'
      );
    `);
    database.exec('PRAGMA journal_mode = DELETE');

    ensureAcquisitionSchema(database);

    expect(journalMode(database)).toBe('wal');
    expect(jobCount(database)).toBe(0);
  });
});
