import type { DatabaseSync } from 'node:sqlite';
import { ensureAcquisitionSchema, getAcquisitionDatabase } from '$lib/server/acquisition-db';
import { queueCache } from '$lib/server/app-cache';
import type {
  ArrService,
  PersistedAcquisitionJob,
  PersistedManualSelection,
} from '$lib/server/acquisition-domain';
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
  queued_manual_selection_json: string | null;
  completion_episode_ids_json: string | null;
  target_season_numbers_json: string | null;
  target_episode_ids_json: string | null;
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
  submitted_guid: string | null;
  submitted_indexer_id: number | null;
  submission_claimed_at: string | null;
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
  completionEpisodeIds?: number[] | null;
  targetEpisodeIds?: number[] | null;
  targetSeasonNumbers?: number[] | null;
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
    | 'completionEpisodeIds'
    | 'preferences'
    | 'sourceService'
    | 'targetEpisodeIds'
    | 'targetSeasonNumbers'
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
  submittedGuid?: string | null;
  submittedIndexerId?: number | null;
  submissionClaimedAt?: string | null;
  startedAt?: string;
  status: AcquisitionAttempt['status'];
};

export type ClaimAttemptReleaseSubmissionResult = 'claimed' | 'already-claimed' | 'missing';
export type ClaimAttemptSearchResult = 'claimed' | 'already-claimed' | 'missing';
export type ConditionalJobUpdateResult = {
  job: PersistedAcquisitionJob | null;
  updated: boolean;
};

const attemptSearchClaimTtlMs = 120_000;

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

function normalizeNumberArray(value: number[] | null | undefined): number[] | null {
  if (!value) {
    return null;
  }

  const normalized = [...new Set(
    value
      .filter((entry) => Number.isFinite(entry) && entry >= 0)
      .map((entry) => Math.trunc(entry)),
  )].sort((left, right) => left - right);

  return normalized.length > 0 ? normalized : null;
}

function parseNumberArrayJson(value: string | null | undefined): number[] | null {
  if (!value) {
    return null;
  }

  try {
    return normalizeNumberArray(JSON.parse(value) as number[]);
  } catch {
    return null;
  }
}

function serializeNumberArray(value: number[] | null): string | null {
  return value ? JSON.stringify(value) : null;
}

function parseManualSelectionJson(
  value: string | null | undefined,
): PersistedManualSelection | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as PersistedManualSelection;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.payload !== 'object' ||
      parsed.payload === null ||
      typeof parsed.decision !== 'object' ||
      parsed.decision === null ||
      typeof parsed.decision.reason !== 'string' ||
      typeof parsed.decision.considered !== 'number' ||
      typeof parsed.decision.accepted !== 'number' ||
      typeof parsed.decision.selected !== 'object' ||
      parsed.decision.selected === null ||
      typeof parsed.selectedResult !== 'object' ||
      parsed.selectedResult === null ||
      typeof parsed.decision.selected.guid !== 'string' ||
      typeof parsed.decision.selected.indexerId !== 'number' ||
      typeof parsed.decision.selected.title !== 'string' ||
      typeof parsed.selectedResult.guid !== 'string' ||
      typeof parsed.selectedResult.indexerId !== 'number' ||
      typeof parsed.selectedResult.title !== 'string'
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function serializeManualSelection(value: PersistedManualSelection | null): string | null {
  return value ? JSON.stringify(value) : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/iu.test(error.message);
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

  private findActiveJobRow(
    arrItemId: number,
    kind: MediaKind,
    sourceService: ArrService,
  ): JobRow | undefined {
    return this.database
      .prepare(
        `SELECT * FROM acquisition_jobs
         WHERE arr_item_id = ? AND kind = ? AND source_service = ?
           AND status NOT IN ('completed', 'failed', 'cancelled')
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(arrItemId, kind, sourceService) as JobRow | undefined;
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
        submittedGuid: row.submitted_guid,
        submittedIndexerId: row.submitted_indexer_id,
        submissionClaimedAt: row.submission_claimed_at,
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
        queuedManualSelection: parseManualSelectionJson(row.queued_manual_selection_json),
        completionEpisodeIds: parseNumberArrayJson(row.completion_episode_ids_json),
        preferences: {
          preferredLanguage: sanitizePreferredLanguage(row.preferred_language),
          subtitleLanguage: sanitizePreferredLanguage(row.subtitle_language, 'Any'),
        },
        targetSeasonNumbers: parseNumberArrayJson(row.target_season_numbers_json),
        targetEpisodeIds: parseNumberArrayJson(row.target_episode_ids_json),
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
    const row = this.findActiveJobRow(arrItemId, kind, sourceService);
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
    return this.createOrReuseActiveJob(input).job;
  }

  createOrReuseActiveJob(
    input: CreateAcquisitionJobInput,
  ): { created: boolean; job: PersistedAcquisitionJob } {
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
      queuedManualSelection: null,
      completionEpisodeIds: normalizeNumberArray(input.completionEpisodeIds),
      preferences: input.preferences,
      targetSeasonNumbers: normalizeNumberArray(input.targetSeasonNumbers),
      targetEpisodeIds: normalizeNumberArray(input.targetEpisodeIds),
      startedAt,
      updatedAt: startedAt,
      completedAt: null,
      attempts: [],
      failedGuids: [],
    };

    const result = this.withTransaction<{ created: boolean; job: PersistedAcquisitionJob }>(() => {
      const existingRow = this.findActiveJobRow(job.arrItemId, job.kind, job.sourceService);
      if (existingRow) {
        return {
          created: false,
          job: this.hydrateJobs([existingRow])[0] ?? job,
        };
      }

      try {
        this.database
          .prepare(
            `INSERT INTO acquisition_jobs (
              id, item_id, arr_item_id, kind, title, source_service, status, attempt,
              max_retries, current_release, selected_releaser, preferred_releaser,
              reason_code, failure_reason, validation_summary, auto_retrying, progress, queue_status,
              queued_manual_selection_json, completion_episode_ids_json, target_season_numbers_json, target_episode_ids_json, preferred_language,
              subtitle_language, started_at, updated_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            serializeManualSelection(job.queuedManualSelection),
            serializeNumberArray(job.completionEpisodeIds),
            serializeNumberArray(job.targetSeasonNumbers),
            serializeNumberArray(job.targetEpisodeIds),
            job.preferences.preferredLanguage,
            job.preferences.subtitleLanguage,
            job.startedAt,
            job.updatedAt,
            job.completedAt,
          );
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }

        const racedRow = this.findActiveJobRow(job.arrItemId, job.kind, job.sourceService);
        if (!racedRow) {
          throw error;
        }

        return {
          created: false,
          job: this.hydrateJobs([racedRow])[0] ?? job,
        };
      }

      return {
        created: true,
        job,
      };
    });

    this.invalidateQueueCache();
    return result;
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
            auto_retrying = ?, progress = ?, queue_status = ?, queued_manual_selection_json = ?,
            preferred_language = ?, subtitle_language = ?,
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
          serializeManualSelection(next.queuedManualSelection),
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

  updateJobIfStatus(
    jobId: string,
    allowedStatuses: PersistedAcquisitionJob['status'][],
    patch: UpdateAcquisitionJobPatch,
  ): ConditionalJobUpdateResult {
    const result = this.withTransaction<ConditionalJobUpdateResult>(() => {
      const currentRow = this.database
        .prepare('SELECT * FROM acquisition_jobs WHERE id = ?')
        .get(jobId) as JobRow | undefined;

      if (!currentRow) {
        return { job: null, updated: false };
      }

      const current = this.hydrateJobs([currentRow])[0];
      if (!current) {
        return { job: null, updated: false };
      }

      if (!allowedStatuses.includes(current.status)) {
        return { job: current, updated: false };
      }

      const nextStatus = patch.status ?? current.status;
      if (!canTransitionJobStatus(current.status, nextStatus)) {
        throw new Error(
          `Invalid acquisition job status transition: ${current.status} -> ${nextStatus}`,
        );
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

      this.database
        .prepare(
          `UPDATE acquisition_jobs SET
            status = ?, attempt = ?, current_release = ?, selected_releaser = ?,
            preferred_releaser = ?, reason_code = ?, failure_reason = ?, validation_summary = ?,
            auto_retrying = ?, progress = ?, queue_status = ?, queued_manual_selection_json = ?,
            preferred_language = ?, subtitle_language = ?,
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
          serializeManualSelection(next.queuedManualSelection),
          next.preferences.preferredLanguage,
          next.preferences.subtitleLanguage,
          next.updatedAt,
          next.completedAt,
          jobId,
        );

      return {
        job: this.getJob(jobId) ?? next,
        updated: true,
      };
    });

    this.invalidateQueueCache();
    return result;
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
      submitted_guid:
        input.submittedGuid !== undefined ? input.submittedGuid : (existing?.submitted_guid ?? null),
      submitted_indexer_id:
        input.submittedIndexerId !== undefined
          ? input.submittedIndexerId
          : (existing?.submitted_indexer_id ?? null),
      submission_claimed_at:
        input.submissionClaimedAt !== undefined
          ? input.submissionClaimedAt
          : (existing?.submission_claimed_at ?? null),
      started_at: input.startedAt ?? existing?.started_at ?? new Date().toISOString(),
      finished_at:
        input.finishedAt !== undefined ? input.finishedAt : (existing?.finished_at ?? null),
    };

    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO acquisition_attempts (
            job_id, attempt, status, reason_code, release_title, releaser, reason,
            submitted_guid, submitted_indexer_id, submission_claimed_at, started_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(job_id, attempt) DO UPDATE SET
            status = excluded.status,
            reason_code = excluded.reason_code,
            release_title = excluded.release_title,
            releaser = excluded.releaser,
            reason = excluded.reason,
            submitted_guid = excluded.submitted_guid,
            submitted_indexer_id = excluded.submitted_indexer_id,
            submission_claimed_at = excluded.submission_claimed_at,
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
          row.submitted_guid,
          row.submitted_indexer_id,
          row.submission_claimed_at,
          row.started_at,
          row.finished_at,
        );
    });

    this.invalidateQueueCache();
  }

  claimAttemptReleaseSubmission(
    jobId: string,
    attempt: number,
    guid: string,
    indexerId: number,
  ): ClaimAttemptReleaseSubmissionResult {
    const result = this.withTransaction<ClaimAttemptReleaseSubmissionResult>(() => {
      const existing = this.database
        .prepare('SELECT * FROM acquisition_attempts WHERE job_id = ? AND attempt = ?')
        .get(jobId, attempt) as AttemptRow | undefined;

      if (!existing) {
        return 'missing';
      }

      if (existing.submission_claimed_at) {
        if (existing.submitted_guid === guid && existing.submitted_indexer_id === indexerId) {
          return 'already-claimed';
        }

        throw new Error(
          `Acquisition attempt ${attempt} for job ${jobId} already claimed release submission for ${existing.submitted_guid ?? 'unknown guid'}`,
        );
      }

      this.database
        .prepare(
          `UPDATE acquisition_attempts
           SET submitted_guid = ?, submitted_indexer_id = ?, submission_claimed_at = ?
           WHERE job_id = ? AND attempt = ?`,
        )
        .run(guid, indexerId, new Date().toISOString(), jobId, attempt);

      return 'claimed';
    });

    this.invalidateQueueCache();
    return result;
  }

  claimAttemptSearch(jobId: string, attempt: number): ClaimAttemptSearchResult {
    const result = this.withTransaction<ClaimAttemptSearchResult>(() => {
      const jobRow = this.database
        .prepare('SELECT 1 FROM acquisition_jobs WHERE id = ? LIMIT 1')
        .get(jobId) as { 1?: number } | undefined;
      if (!jobRow) {
        return 'missing';
      }

      const existing = this.database
        .prepare('SELECT * FROM acquisition_attempts WHERE job_id = ? AND attempt = ?')
        .get(jobId, attempt) as AttemptRow | undefined;
      const claimedAt = new Date().toISOString();

      if (!existing) {
        this.database
          .prepare(
            `INSERT INTO acquisition_attempts (
              job_id, attempt, status, reason_code, release_title, releaser, reason,
              submitted_guid, submitted_indexer_id, submission_claimed_at, started_at, finished_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            jobId,
            attempt,
            'searching',
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            claimedAt,
            null,
          );

        return 'claimed';
      }

      if (existing.status !== 'searching' || existing.finished_at !== null) {
        return 'already-claimed';
      }

      if (existing.status === 'searching' && existing.finished_at === null) {
        const startedAtMs = Date.parse(existing.started_at);
        if (Number.isFinite(startedAtMs) && Date.now() - startedAtMs < attemptSearchClaimTtlMs) {
          return 'already-claimed';
        }
      }

      this.database
        .prepare(
          `UPDATE acquisition_attempts
           SET status = ?, reason_code = NULL, release_title = NULL, releaser = NULL, reason = NULL,
               submitted_guid = NULL, submitted_indexer_id = NULL, submission_claimed_at = NULL,
               started_at = ?, finished_at = NULL
           WHERE job_id = ? AND attempt = ?`,
        )
        .run('searching', claimedAt, jobId, attempt);

      return 'claimed';
    });

    this.invalidateQueueCache();
    return result;
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
