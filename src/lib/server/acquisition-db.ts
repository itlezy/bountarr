import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const acquisitionSchema = `
  CREATE TABLE IF NOT EXISTS acquisition_jobs (
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

  CREATE INDEX IF NOT EXISTS acquisition_jobs_status_idx
    ON acquisition_jobs (status, updated_at DESC);

  CREATE INDEX IF NOT EXISTS acquisition_jobs_lookup_idx
    ON acquisition_jobs (arr_item_id, kind, status);

  CREATE TABLE IF NOT EXISTS acquisition_attempts (
    job_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    status TEXT NOT NULL,
    reason_code TEXT,
    release_title TEXT,
    releaser TEXT,
    reason TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    PRIMARY KEY (job_id, attempt),
    FOREIGN KEY (job_id) REFERENCES acquisition_jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS acquisition_failed_guids (
    job_id TEXT NOT NULL,
    guid TEXT NOT NULL,
    PRIMARY KEY (job_id, guid),
    FOREIGN KEY (job_id) REFERENCES acquisition_jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS acquisition_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    context_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES acquisition_jobs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS acquisition_events_job_idx
    ON acquisition_events (job_id, created_at DESC);
`;

export function defaultAcquisitionDatabasePath(): string {
  const configuredPath = process.env.ACQUISITION_DB_PATH?.trim();
  return configuredPath && configuredPath.length > 0
    ? path.resolve(configuredPath)
    : path.resolve('data', 'acquisition.db');
}

function ensureDatabaseDirectory(databasePath: string): void {
  mkdirSync(path.dirname(databasePath), { recursive: true });
}

export function ensureAcquisitionSchema(database: DatabaseSync): void {
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(acquisitionSchema);
  try {
    database.exec('ALTER TABLE acquisition_jobs ADD COLUMN subtitle_language TEXT');
  } catch (error) {
    if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) {
      throw error;
    }
  }
  try {
    database.exec('ALTER TABLE acquisition_jobs ADD COLUMN reason_code TEXT');
  } catch (error) {
    if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) {
      throw error;
    }
  }
  try {
    database.exec(
      'ALTER TABLE acquisition_jobs ADD COLUMN auto_retrying INTEGER NOT NULL DEFAULT 0',
    );
  } catch (error) {
    if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) {
      throw error;
    }
  }
  try {
    database.exec('ALTER TABLE acquisition_attempts ADD COLUMN reason_code TEXT');
  } catch (error) {
    if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) {
      throw error;
    }
  }
  database.exec(
    "UPDATE acquisition_jobs SET subtitle_language = preferred_language WHERE subtitle_language IS NULL OR trim(subtitle_language) = ''",
  );
  database.exec('UPDATE acquisition_jobs SET auto_retrying = coalesce(auto_retrying, 0)');
}

export class AcquisitionDatabase {
  readonly database: DatabaseSync;
  readonly databasePath: string;
  readonly ownsDatabase: boolean;

  constructor(databaseOrPath: DatabaseSync | string = defaultAcquisitionDatabasePath()) {
    if (typeof databaseOrPath === 'string') {
      this.databasePath = databaseOrPath;
      ensureDatabaseDirectory(databaseOrPath);
      this.database = new DatabaseSync(databaseOrPath);
      this.ownsDatabase = true;
    } else {
      this.databasePath = ':memory:';
      this.database = databaseOrPath;
      this.ownsDatabase = false;
    }

    ensureAcquisitionSchema(this.database);
  }

  close(): void {
    if (this.ownsDatabase) {
      this.database.close();
    }
  }
}

let databaseSingleton: AcquisitionDatabase | null = null;

export function getAcquisitionDatabase(): AcquisitionDatabase {
  if (!databaseSingleton) {
    databaseSingleton = new AcquisitionDatabase();
  }

  return databaseSingleton;
}

export function resetAcquisitionDatabaseForTests(): void {
  databaseSingleton?.close();
  databaseSingleton = null;
}
