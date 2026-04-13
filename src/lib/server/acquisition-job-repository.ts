import type { DatabaseSync } from 'node:sqlite';
import { ensureAcquisitionSchema, getAcquisitionDatabase } from '$lib/server/acquisition-db';
import { queueCache } from '$lib/server/app-cache';
import type { ArrService, PersistedAcquisitionJob } from '$lib/server/acquisition-domain';
import { canTransitionJobStatus, sortJobs } from '$lib/server/acquisition-domain';
import type { AcquisitionReasonCode } from '$lib/shared/types';
import { sanitizePreferredLanguage } from '$lib/shared/languages';
import type { AcquisitionAttempt, MediaKind } from '$lib/shared/types';

type JobRow = {
  id: string;
  item_id: string;
  arr_item_id: number;
  kind: PersistedAcquisitionJob['kind'];
  title: string;
  source_service: PersistedAcquisitionJob['sourceService'];
  status: PersistedAcquisitionJob['status'];
  attempt: number;
  max_retries: number;
  current_release: string | null;
  selected_releaser: string | null;
  preferred_releaser: string | null;
  reason_code: AcquisitionReasonCode | null;
  failure_reason: string | null;
  validation_summary: string | null;
  auto_retrying: number | null;
  progress: number | null;
  queue_status: string | null;
  preferred_language: string;
  subtitle_language?: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

type AttemptRow = {
  job_id: string;
  attempt: number;
  status: AcquisitionAttempt['status'];
  reason_code: AcquisitionReasonCode | null;
  release_title: string | null;
  releaser: string | null;
  reason: string | null;
  started_at: string;
  finished_at: string | null;
};

type FailedGuidRow = {
  job_id: string;
  guid: string;
};

export type CreateAcquisitionJobInput = {
  arrItemId: number;
  itemId: string;
  kind: PersistedAcquisitionJob['kind'];
  maxRetries: number;
  preferredReleaser: string | null;
  preferences: PersistedAcquisitionJob['preferences'];
  sourceService: PersistedAcquisitionJob['sourceService'];
  title: string;
};

export type UpdateAcquisitionJobPatch = Partial<
  Omit<
    PersistedAcquisitionJob,
    | 'arrItemId'
    | 'attempts'
    | 'failedGuids'
    | 'id'
    | 'itemId'
    | 'kind'
    | 'maxRetries'
    | 'preferences'
    | 'sourceService'
    | 'title'
  >
> & {
  preferences?: Partial<PersistedAcquisitionJob['preferences']>;
};

export type UpsertAcquisitionAttemptInput = {
  attempt: number;
  finishedAt?: string | null;
  reasonCode?: AcquisitionReasonCode | null;
  reason?: string | null;
  releaseTitle?: string | null;
  releaser?: string | null;
  startedAt?: string;
  status: AcquisitionAttempt['status'];
};

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

export class AcquisitionJobRepository {
  readonly database: DatabaseSync;

  constructor(database: DatabaseSync = getAcquisitionDatabase().database) {
    this.database = database;
    ensureAcquisitionSchema(this.database);
  }

  private withTransaction<T>(callback: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private invalidateQueueCache(): void {
    queueCache.delete('queue');
  }

  private hydrateJobs(jobRows: JobRow[]): PersistedAcquisitionJob[] {
    if (jobRows.length === 0) {
      return [];
    }

    const jobIds = jobRows.map((row) => row.id);
    const parameterList = placeholders(jobIds.length);
    const attemptRows = this.database
      .prepare(
        `SELECT * FROM acquisition_attempts WHERE job_id IN (${parameterList}) ORDER BY attempt ASC`,
      )
      .all(...jobIds) as AttemptRow[];
    const failedGuidRows = this.database
      .prepare(`SELECT * FROM acquisition_failed_guids WHERE job_id IN (${parameterList})`)
      .all(...jobIds) as FailedGuidRow[];

    const attemptsByJob = new Map<string, AcquisitionAttempt[]>();
    for (const row of attemptRows) {
      const attempts = attemptsByJob.get(row.job_id) ?? [];
      attempts.push({
        attempt: row.attempt,
        status: row.status,
        reasonCode: row.reason_code,
        releaseTitle: row.release_title,
        releaser: row.releaser,
        reason: row.reason,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      });
      attemptsByJob.set(row.job_id, attempts);
    }

    const failedGuidsByJob = new Map<string, string[]>();
    for (const row of failedGuidRows) {
      const failedGuids = failedGuidsByJob.get(row.job_id) ?? [];
      failedGuids.push(row.guid);
      failedGuidsByJob.set(row.job_id, failedGuids);
    }

    return sortJobs(
      jobRows.map((row) => ({
        id: row.id,
        itemId: row.item_id,
        arrItemId: row.arr_item_id,
        kind: row.kind,
        title: row.title,
        sourceService: row.source_service,
        status: row.status,
        attempt: row.attempt,
        maxRetries: row.max_retries,
        currentRelease: row.current_release,
        selectedReleaser: row.selected_releaser,
        preferredReleaser: row.preferred_releaser,
        reasonCode: row.reason_code,
        failureReason: row.failure_reason,
        validationSummary: row.validation_summary,
        autoRetrying: row.auto_retrying === 1,
        progress: row.progress,
        queueStatus: row.queue_status,
        preferences: {
          preferredLanguage: sanitizePreferredLanguage(row.preferred_language),
          subtitleLanguage: sanitizePreferredLanguage(row.subtitle_language, 'Any'),
        },
        startedAt: row.started_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
        attempts: attemptsByJob.get(row.id) ?? [],
        failedGuids: failedGuidsByJob.get(row.id) ?? [],
      })),
    );
  }

  listJobs(): PersistedAcquisitionJob[] {
    const rows = this.database
      .prepare('SELECT * FROM acquisition_jobs ORDER BY updated_at DESC')
      .all() as JobRow[];

    return this.hydrateJobs(rows);
  }

  listRunnableJobIds(): string[] {
    const rows = this.database
      .prepare(
        `SELECT id FROM acquisition_jobs
         WHERE status NOT IN ('completed', 'failed', 'cancelled')
         ORDER BY updated_at DESC`,
      )
      .all() as Array<{ id: string }>;

    return rows.map((row) => row.id);
  }

  listRunnableJobs(): PersistedAcquisitionJob[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM acquisition_jobs
         WHERE status NOT IN ('completed', 'failed', 'cancelled')
         ORDER BY updated_at DESC`,
      )
      .all() as JobRow[];

    return this.hydrateJobs(rows);
  }

  getJob(jobId: string): PersistedAcquisitionJob | null {
    const row = this.database.prepare('SELECT * FROM acquisition_jobs WHERE id = ?').get(jobId) as
      | JobRow
      | undefined;

    return row ? (this.hydrateJobs([row])[0] ?? null) : null;
  }

  hasJob(jobId: string): boolean {
    const row = this.database
      .prepare('SELECT 1 FROM acquisition_jobs WHERE id = ? LIMIT 1')
      .get(jobId) as { 1?: number } | undefined;

    return row !== undefined;
  }

  findActiveJob(
    arrItemId: number,
    kind: MediaKind,
    sourceService: ArrService,
  ): PersistedAcquisitionJob | null {
    const row = this.database
      .prepare(
        `SELECT * FROM acquisition_jobs
         WHERE arr_item_id = ? AND kind = ? AND source_service = ?
           AND status NOT IN ('completed', 'failed', 'cancelled')
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(arrItemId, kind, sourceService) as JobRow | undefined;

    return row ? (this.hydrateJobs([row])[0] ?? null) : null;
  }

  listActiveJobsByArrItem(
    arrItemId: number,
    kind: MediaKind,
    sourceService: ArrService,
  ): PersistedAcquisitionJob[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM acquisition_jobs
         WHERE arr_item_id = ? AND kind = ? AND source_service = ?
           AND status NOT IN ('completed', 'failed', 'cancelled')
         ORDER BY updated_at DESC`,
      )
      .all(arrItemId, kind, sourceService) as JobRow[];

    return this.hydrateJobs(rows);
  }

  findPreferredReleaser(kind: MediaKind, title: string): string | null {
    const row = this.database
      .prepare(
        `SELECT selected_releaser FROM acquisition_jobs
         WHERE kind = ? AND lower(title) = lower(?) AND status = 'completed'
           AND selected_releaser IS NOT NULL
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(kind, title) as { selected_releaser: string | null } | undefined;

    return row?.selected_releaser ?? null;
  }

  createJob(input: CreateAcquisitionJobInput): PersistedAcquisitionJob {
    const startedAt = new Date().toISOString();
    const job: PersistedAcquisitionJob = {
      id: crypto.randomUUID(),
      itemId: input.itemId,
      arrItemId: input.arrItemId,
      kind: input.kind,
      title: input.title,
      sourceService: input.sourceService,
      status: 'queued',
      attempt: 1,
      maxRetries: input.maxRetries,
      currentRelease: null,
      selectedReleaser: null,
      preferredReleaser: input.preferredReleaser,
      reasonCode: null,
      failureReason: null,
      validationSummary: null,
      autoRetrying: false,
      progress: null,
      queueStatus: 'Queued',
      preferences: input.preferences,
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      attempts: [],
      failedGuids: [],
    };

    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO acquisition_jobs (
            id, item_id, arr_item_id, kind, title, source_service, status, attempt,
            max_retries, current_release, selected_releaser, preferred_releaser,
            reason_code, failure_reason, validation_summary, auto_retrying, progress, queue_status,
            preferred_language, subtitle_language, started_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          job.id,
          job.itemId,
          job.arrItemId,
          job.kind,
          job.title,
          job.sourceService,
          job.status,
          job.attempt,
          job.maxRetries,
          job.currentRelease,
          job.selectedReleaser,
          job.preferredReleaser,
          job.reasonCode,
          job.failureReason,
          job.validationSummary,
          job.autoRetrying ? 1 : 0,
          job.progress,
          job.queueStatus,
          job.preferences.preferredLanguage,
          job.preferences.subtitleLanguage,
          job.startedAt,
          job.updatedAt,
          job.completedAt,
        );
    });

    this.invalidateQueueCache();
    return job;
  }

  updateJob(jobId: string, patch: UpdateAcquisitionJobPatch): PersistedAcquisitionJob {
    const current = this.getJob(jobId);
    if (!current) {
      throw new Error(`Acquisition job ${jobId} was not found`);
    }

    const nextStatus = patch.status ?? current.status;
    if (!canTransitionJobStatus(current.status, nextStatus)) {
      throw new Error(`Invalid acquisition job status transition: ${current.status} -> ${nextStatus}`);
    }

    if (patch.attempt !== undefined && patch.attempt < current.attempt) {
      throw new Error(
        `Invalid acquisition attempt regression for ${jobId}: ${patch.attempt} < ${current.attempt}`,
      );
    }

    const next: PersistedAcquisitionJob = {
      ...current,
      ...patch,
      preferences: {
        ...current.preferences,
        ...(patch.preferences ?? {}),
      },
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };

    this.withTransaction(() => {
      this.database
        .prepare(
          `UPDATE acquisition_jobs SET
            status = ?, attempt = ?, current_release = ?, selected_releaser = ?,
            preferred_releaser = ?, reason_code = ?, failure_reason = ?, validation_summary = ?,
            auto_retrying = ?, progress = ?, queue_status = ?, preferred_language = ?, subtitle_language = ?,
            updated_at = ?, completed_at = ?
           WHERE id = ?`,
        )
        .run(
          next.status,
          next.attempt,
          next.currentRelease,
          next.selectedReleaser,
          next.preferredReleaser,
          next.reasonCode,
          next.failureReason,
          next.validationSummary,
          next.autoRetrying ? 1 : 0,
          next.progress,
          next.queueStatus,
          next.preferences.preferredLanguage,
          next.preferences.subtitleLanguage,
          next.updatedAt,
          next.completedAt,
          jobId,
        );
    });

    this.invalidateQueueCache();
    return this.getJob(jobId) ?? next;
  }

  upsertAttempt(jobId: string, input: UpsertAcquisitionAttemptInput): void {
    if (!this.hasJob(jobId)) {
      return;
    }

    const existing = this.database
      .prepare('SELECT * FROM acquisition_attempts WHERE job_id = ? AND attempt = ?')
      .get(jobId, input.attempt) as AttemptRow | undefined;

    const row: AttemptRow = {
      job_id: jobId,
      attempt: input.attempt,
      status: input.status,
      reason_code: input.reasonCode ?? existing?.reason_code ?? null,
      release_title: input.releaseTitle ?? existing?.release_title ?? null,
      releaser: input.releaser ?? existing?.releaser ?? null,
      reason: input.reason ?? existing?.reason ?? null,
      started_at: input.startedAt ?? existing?.started_at ?? new Date().toISOString(),
      finished_at:
        input.finishedAt !== undefined ? input.finishedAt : (existing?.finished_at ?? null),
    };

    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO acquisition_attempts (
            job_id, attempt, status, reason_code, release_title, releaser, reason, started_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(job_id, attempt) DO UPDATE SET
            status = excluded.status,
            reason_code = excluded.reason_code,
            release_title = excluded.release_title,
            releaser = excluded.releaser,
            reason = excluded.reason,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at`,
        )
        .run(
          row.job_id,
          row.attempt,
          row.status,
          row.reason_code,
          row.release_title,
          row.releaser,
          row.reason,
          row.started_at,
          row.finished_at,
        );
    });

    this.invalidateQueueCache();
  }

  addFailedGuid(jobId: string, guid: string): void {
    if (!this.hasJob(jobId)) {
      return;
    }

    this.withTransaction(() => {
      this.database
        .prepare('INSERT OR IGNORE INTO acquisition_failed_guids (job_id, guid) VALUES (?, ?)')
        .run(jobId, guid);
    });

    this.invalidateQueueCache();
  }

  deleteJobsByArrItem(arrItemId: number, kind: MediaKind, sourceService: ArrService): void {
    this.withTransaction(() => {
      this.database
        .prepare(
          'DELETE FROM acquisition_jobs WHERE arr_item_id = ? AND kind = ? AND source_service = ?',
        )
        .run(arrItemId, kind, sourceService);
    });

    this.invalidateQueueCache();
  }
}

let jobRepositorySingleton: AcquisitionJobRepository | null = null;

export function getAcquisitionJobRepository(): AcquisitionJobRepository {
  if (!jobRepositorySingleton) {
    jobRepositorySingleton = new AcquisitionJobRepository();
  }

  return jobRepositorySingleton;
}

export function resetAcquisitionJobRepositoryForTests(): void {
  jobRepositorySingleton = null;
}
