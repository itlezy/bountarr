import type { DatabaseSync } from 'node:sqlite';
import { ensureAcquisitionSchema, getAcquisitionDatabase } from '$lib/server/acquisition-db';

type EventRow = {
  id: number;
  job_id: string;
  kind: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  context_json: string;
  created_at: string;
};

export type AcquisitionEventRecord = {
  id: number;
  jobId: string;
  kind: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  context: Record<string, unknown>;
  createdAt: string;
};

function parseEventContext(rawValue: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class AcquisitionEventRepository {
  readonly database: DatabaseSync;

  constructor(database: DatabaseSync = getAcquisitionDatabase().database) {
    this.database = database;
    ensureAcquisitionSchema(this.database);
  }

  append(
    jobId: string,
    kind: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> = {},
  ): AcquisitionEventRecord {
    const createdAt = new Date().toISOString();
    const result = this.database
      .prepare(
        `INSERT INTO acquisition_events (
          job_id, kind, level, message, context_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(jobId, kind, level, message, JSON.stringify(context), createdAt);

    return {
      id: Number(result.lastInsertRowid),
      jobId,
      kind,
      level,
      message,
      context,
      createdAt,
    };
  }

  listByJob(jobId: string, limit = 50): AcquisitionEventRecord[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM acquisition_events
         WHERE job_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(jobId, limit) as EventRow[];

    return rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      kind: row.kind,
      level: row.level,
      message: row.message,
      context: parseEventContext(row.context_json),
      createdAt: row.created_at,
    }));
  }
}

let eventRepositorySingleton: AcquisitionEventRepository | null = null;

export function getAcquisitionEventRepository(): AcquisitionEventRepository {
  if (!eventRepositorySingleton) {
    eventRepositorySingleton = new AcquisitionEventRepository();
  }

  return eventRepositorySingleton;
}

export function resetAcquisitionEventRepositoryForTests(): void {
  eventRepositorySingleton = null;
}
