import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { liveRuntimePaths } from './live-runtime-paths';

export type LiveAttemptSubmissionRecord = {
  attempt: number;
  status: string;
  submittedGuid: string | null;
  submittedIndexerId: number | null;
  submissionClaimedAt: string | null;
};

export type LiveAcquisitionEventRecord = {
  kind: string;
  context: Record<string, unknown>;
  message: string;
  createdAt: string;
};

function parseContext(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function acquisitionDatabasePath(location: string): string {
  if (location.toLowerCase().endsWith('.db')) {
    return location;
  }

  return liveRuntimePaths(path.resolve(location), 'integration').databasePath;
}

function openDatabase(location = process.cwd()): DatabaseSync {
  return new DatabaseSync(acquisitionDatabasePath(location), {
    open: true,
    readOnly: true,
  });
}

export function listAttemptSubmissions(
  jobId: string,
  location = process.cwd(),
): LiveAttemptSubmissionRecord[] {
  const database = openDatabase(location);

  try {
    const rows = database
      .prepare(
        `SELECT attempt, status, submitted_guid, submitted_indexer_id, submission_claimed_at
         FROM acquisition_attempts
         WHERE job_id = ?
         ORDER BY attempt ASC`,
      )
      .all(jobId) as Array<{
      attempt: number;
      status: string;
      submitted_guid: string | null;
      submitted_indexer_id: number | null;
      submission_claimed_at: string | null;
    }>;

    return rows.map((row) => ({
      attempt: row.attempt,
      status: row.status,
      submittedGuid: row.submitted_guid,
      submittedIndexerId: row.submitted_indexer_id,
      submissionClaimedAt: row.submission_claimed_at,
    }));
  } finally {
    database.close();
  }
}

export function listAcquisitionEvents(
  jobId: string,
  location = process.cwd(),
): LiveAcquisitionEventRecord[] {
  const database = openDatabase(location);

  try {
    const rows = database
      .prepare(
        `SELECT kind, message, context_json, created_at
         FROM acquisition_events
         WHERE job_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(jobId) as Array<{
      kind: string;
      message: string;
      context_json: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      kind: row.kind,
      context: parseContext(row.context_json),
      message: row.message,
      createdAt: row.created_at,
    }));
  } finally {
    database.close();
  }
}
