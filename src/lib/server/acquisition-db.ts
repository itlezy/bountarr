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
    live_queue_id INTEGER,
    live_download_id TEXT,
    quality_profile_id INTEGER,
    queued_manual_selection_json TEXT,
    target_season_numbers_json TEXT,
    target_episode_ids_json TEXT,
    preferred_language TEXT NOT NULL,
    subtitle_language TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS acquisition_jobs_status_idx
    ON acquisition_jobs (status, updated_at DESC);

  CREATE INDEX IF NOT EXISTS acquisition_jobs_lookup_idx
    ON acquisition_jobs (arr_item_id, kind, source_service, status);

  CREATE UNIQUE INDEX IF NOT EXISTS acquisition_jobs_active_identity_idx
    ON acquisition_jobs (arr_item_id, kind, source_service)
    WHERE status NOT IN ('completed', 'failed', 'cancelled');

  CREATE TABLE IF NOT EXISTS acquisition_attempts (
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
    'submitted_guid',
    'submitted_indexer_id',
    'submission_claimed_at',
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
    'live_queue_id',
    'live_download_id',
    'quality_profile_id',
    'queued_manual_selection_json',
    'target_season_numbers_json',
    'target_episode_ids_json',
    'preferred_language',
    'subtitle_language',
    'started_at',
    'updated_at',
    'completed_at',
  ],
} as const;

const expectedAcquisitionIndexes = {
  acquisition_jobs_active_identity_idx: {
    table: 'acquisition_jobs',
    columns: [
      { name: 'arr_item_id', desc: false },
      { name: 'kind', desc: false },
      { name: 'source_service', desc: false },
    ],
    unique: true,
    whereClause: "status NOT IN ('completed', 'failed', 'cancelled')",
  },
  acquisition_events_job_idx: {
    table: 'acquisition_events',
    columns: [{ name: 'job_id', desc: false }, { name: 'created_at', desc: true }],
    unique: false,
    whereClause: null,
  },
  acquisition_jobs_lookup_idx: {
    table: 'acquisition_jobs',
    columns: [
      { name: 'arr_item_id', desc: false },
      { name: 'kind', desc: false },
      { name: 'source_service', desc: false },
      { name: 'status', desc: false },
    ],
    unique: false,
    whereClause: null,
  },
  acquisition_jobs_status_idx: {
    table: 'acquisition_jobs',
    columns: [{ name: 'status', desc: false }, { name: 'updated_at', desc: true }],
    unique: false,
    whereClause: null,
  },
} as const;

type ExplicitIndexDefinition = {
  table: string;
  columns: Array<{ name: string; desc: boolean }>;
  unique: boolean;
  whereClause: string | null;
};

function tableExists(database: DatabaseSync, tableName: string): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;

  return row?.name === tableName;
}

function normalizeSqlFragment(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

function tableColumns(database: DatabaseSync, tableName: string): string[] {
  return (
    database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: unknown }>
  ).flatMap((row) => (typeof row.name === 'string' ? [row.name] : []));
}

function explicitIndexes(
  database: DatabaseSync,
): Record<string, ExplicitIndexDefinition> {
  const definitions: Record<string, ExplicitIndexDefinition> = {};

  for (const tableName of Object.keys(expectedAcquisitionTableColumns)) {
    const indexes = database.prepare(`PRAGMA index_list(${tableName})`).all() as Array<{
      name?: unknown;
      origin?: unknown;
      partial?: unknown;
      unique?: unknown;
    }>;

    for (const index of indexes) {
      if (typeof index.name !== 'string' || index.origin !== 'c') {
        continue;
      }

      const columns = (
        database.prepare(`PRAGMA index_xinfo(${index.name})`).all() as Array<{
          cid?: unknown;
          desc?: unknown;
          key?: unknown;
          name?: unknown;
        }>
      )
        .filter((column) => column.key === 1 && typeof column.cid === 'number' && column.cid >= 0)
        .flatMap((column) =>
          typeof column.name === 'string'
            ? [
                {
                  desc: column.desc === 1,
                  name: column.name,
                },
              ]
            : [],
        );

      definitions[index.name] = {
        columns,
        table: tableName,
        unique: index.unique === 1,
        whereClause:
          index.partial === 1
            ? normalizeSqlFragment(
                (
                  database
                    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
                    .get(index.name) as { sql?: unknown } | undefined
                )?.sql
                  ?.toString()
                  .match(/\bWHERE\b(.+)$/iu)?.[1] ?? null,
              )
            : null,
      };
    }
  }

  return definitions;
}

function expectedJournalMode(database: DatabaseSync): string {
  const databasePath = (
    database.prepare('PRAGMA database_list').get() as { file?: unknown } | undefined
  )?.file;
  return typeof databasePath === 'string' && databasePath.length > 0 ? 'wal' : 'memory';
}

function currentJournalMode(database: DatabaseSync): string {
  const row = database.prepare('PRAGMA journal_mode').get() as
    | { journal_mode?: unknown }
    | undefined;
  return typeof row?.journal_mode === 'string' ? row.journal_mode.toLowerCase() : '';
}

function hasRequiredPersistentPragmas(database: DatabaseSync): boolean {
  return currentJournalMode(database) === expectedJournalMode(database);
}

function applyRequiredPragmas(database: DatabaseSync): void {
  database.exec(`PRAGMA journal_mode = ${expectedJournalMode(database)}`);
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

function hasCurrentAcquisitionIndexes(database: DatabaseSync): boolean {
  const actualIndexes = explicitIndexes(database);
  const expectedNames = Object.keys(expectedAcquisitionIndexes).sort() as Array<
    keyof typeof expectedAcquisitionIndexes
  >;
  const actualNames = Object.keys(actualIndexes).sort();

  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    return false;
  }

  return expectedNames.every((indexName) => {
    const expectedIndex = expectedAcquisitionIndexes[indexName];
    const actualIndex = actualIndexes[indexName];
    return (
      actualIndex.table === expectedIndex.table &&
      actualIndex.unique === expectedIndex.unique &&
      actualIndex.whereClause === expectedIndex.whereClause &&
      actualIndex.columns.length === expectedIndex.columns.length &&
      actualIndex.columns.every(
        (column, index) =>
          column.name === expectedIndex.columns[index]?.name &&
          column.desc === expectedIndex.columns[index]?.desc,
      )
    );
  });
}

function hasCurrentAcquisitionSchema(database: DatabaseSync): boolean {
  return (
    Object.entries(expectedAcquisitionTableColumns).every(([tableName, expectedColumns]) => {
      if (!tableExists(database, tableName)) {
        return false;
      }

      const actualColumns = tableColumns(database, tableName);
      return (
        actualColumns.length === expectedColumns.length &&
        actualColumns.every((columnName, index) => columnName === expectedColumns[index])
      );
    }) &&
    hasCurrentAcquisitionIndexes(database) &&
    hasRequiredPersistentPragmas(database)
  );
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
    // Acquisition tracking is disposable state in this repo. Any table, index, or persistent
    // pragma drift is treated as corruption and rebuilt from the current schema instead of
    // carrying compatibility code.
    applyRequiredPragmas(database);
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
