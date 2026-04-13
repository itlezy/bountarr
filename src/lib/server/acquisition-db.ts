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

const expectedAcquisitionTableColumns = {
  acquisition_attempts: [
    'job_id',
    'attempt',
    'status',
    'reason_code',
    'release_title',
    'releaser',
    'reason',
    'started_at',
    'finished_at',
  ],
  acquisition_events: ['id', 'job_id', 'kind', 'level', 'message', 'context_json', 'created_at'],
  acquisition_failed_guids: ['job_id', 'guid'],
  acquisition_jobs: [
    'id',
    'item_id',
    'arr_item_id',
    'kind',
    'title',
    'source_service',
    'status',
    'attempt',
    'max_retries',
    'current_release',
    'selected_releaser',
    'preferred_releaser',
    'reason_code',
    'failure_reason',
    'validation_summary',
    'auto_retrying',
    'progress',
    'queue_status',
    'preferred_language',
    'subtitle_language',
    'started_at',
    'updated_at',
    'completed_at',
  ],
} as const;

function tableExists(database: DatabaseSync, tableName: string): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;

  return row?.name === tableName;
}

function tableColumns(database: DatabaseSync, tableName: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: unknown }>
  ).flatMap((row) => (typeof row.name === 'string' ? [row.name] : []));
}

function resetAcquisitionTables(database: DatabaseSync): void {
  database.exec('DROP TABLE IF EXISTS acquisition_events');
  database.exec('DROP TABLE IF EXISTS acquisition_failed_guids');
  database.exec('DROP TABLE IF EXISTS acquisition_attempts');
  database.exec('DROP TABLE IF EXISTS acquisition_jobs');
}

function hasAnyAcquisitionTables(database: DatabaseSync): boolean {
  return Object.keys(expectedAcquisitionTableColumns).some((tableName) =>
    tableExists(database, tableName),
  );
}

function hasCurrentAcquisitionSchema(database: DatabaseSync): boolean {
  return Object.entries(expectedAcquisitionTableColumns).every(([tableName, expectedColumns]) => {
    if (!tableExists(database, tableName)) {
      return false;
    }

    const actualColumns = tableColumns(database, tableName);
    return (
      actualColumns.length === expectedColumns.length &&
      actualColumns.every((columnName, index) => columnName === expectedColumns[index])
    );
  });
}

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
  database.exec('PRAGMA foreign_keys = OFF');
  try {
    const shouldReset = hasAnyAcquisitionTables(database) && !hasCurrentAcquisitionSchema(database);
    if (shouldReset) {
      resetAcquisitionTables(database);
    }
    database.exec(acquisitionSchema);
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
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
