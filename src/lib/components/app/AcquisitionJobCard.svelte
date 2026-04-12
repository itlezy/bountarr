<script lang="ts">
import {
  acquisitionAttemptSummary,
  acquisitionJourneySummary,
  acquisitionNextStep,
  acquisitionReasonSummary,
  acquisitionStatusLabel,
  formatBytes,
  manualReleaseStatusLabel,
  manualReleaseStatusTone,
} from '$lib/client/app-ui';
import type { AppState } from '$lib/client/app-state.svelte';
import type { AcquisitionJob } from '$lib/shared/types';

let { job, state }: { job: AcquisitionJob; state: AppState } = $props();
</script>

<article class={`card-shell p-3 ${state.isGuidedQueueJob(job.id) ? 'border-sky-400 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]' : ''}`}>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="min-w-0">
      <div class="text-base font-800">{job.title}</div>
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
        {acquisitionJourneySummary(job)} · attempt {Math.min(job.attempt, job.maxRetries)}/{job.maxRetries}
      </div>
    </div>
    {#if job.progress !== null}
      <div class="text-sm font-700">{Math.round(job.progress)}%</div>
    {/if}
  </div>

  <div class="progress-track mt-3 h-2 overflow-hidden">
    <div
      class="progress-fill h-full"
      style={`width: ${job.progress ?? 0}%`}
    ></div>
  </div>

  <div class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
    <div>
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Status</div>
      <div>{acquisitionStatusLabel(job.status)}</div>
    </div>
    <div>
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Last result</div>
      <div>{acquisitionReasonSummary(job) ?? 'No completed attempts yet'}</div>
    </div>
    <div>
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Next step</div>
      <div>{acquisitionNextStep(job) ?? 'Waiting'}</div>
    </div>
    <div>
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Queue check</div>
      <div>{job.queueStatus ?? job.validationSummary ?? 'Waiting for more progress'}</div>
    </div>
  </div>

  {#if job.failureReason}
    <div class="mt-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted)]">
      {job.failureReason}
    </div>
  {/if}

  {#if job.attempts.length > 0}
    <div class="mt-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Attempt history</div>
      <div class="mt-2 space-y-2">
        {#each [...job.attempts].reverse() as attempt}
          <div class="rounded-[12px] border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2">
            <div class="text-sm font-700">Attempt {attempt.attempt}</div>
            <div class="mt-1 text-sm text-[var(--muted)]">{acquisitionAttemptSummary(attempt)}</div>
            {#if attempt.releaseTitle}
              <div class="mt-1 break-all text-sm text-[var(--muted)]">{attempt.releaseTitle}</div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="mt-3 flex flex-col gap-2 sm:flex-row">
    <button
      class="control-shell min-h-10 flex-1 px-4 text-sm font-700"
      type="button"
      onclick={() => state.toggleOperatorReveal('job', job.id)}
    >
      {state.operatorRevealOpen('job', job.id) ? 'Hide operator tools' : 'Show operator tools'}
    </button>
  </div>

  {#if state.operatorRevealOpen('job', job.id)}
    <div class="mt-3 space-y-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Operator tools</div>
      <div class="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Release</div>
          <div>{job.currentRelease ?? 'Waiting for selection'}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Preferred releaser</div>
          <div>{job.preferredReleaser ?? job.selectedReleaser ?? 'Not set'}</div>
        </div>
        <div class="sm:col-span-2">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Validation detail</div>
          <div>{job.validationSummary ?? 'Waiting for import'}</div>
        </div>
      </div>

      {#if job.status !== 'cancelled'}
        <button
          class="control-shell min-h-10 w-full border-rose-300 px-4 text-sm font-700 text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700 dark:text-rose-200"
          type="button"
          onclick={() => void state.deleteAcquisitionJob(job)}
          disabled={state.deletingItemId === job.id}
        >
          {state.deletingItemId === job.id ? 'Removing...' : 'Remove from library system'}
        </button>
      {/if}

      {#if state.manualSelectionError[job.id]}
        <div class="rounded-[14px] border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
          {state.manualSelectionError[job.id]}
        </div>
      {/if}

      <div class="flex flex-col gap-2 sm:flex-row">
        <button
          class="control-shell min-h-10 flex-1 px-4 text-sm font-700"
          type="button"
          onclick={() => void state.toggleManualReleaseList(job.id)}
        >
          {state.manualReleaseListOpen(job.id) ? 'Hide manual release options' : 'Show manual release options'}
        </button>
      </div>

      {#if state.manualReleaseListOpen(job.id)}
        <div class="rounded-[14px] border border-[var(--line)] bg-[var(--surface-strong)] p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Manual results</div>
              <div class="mt-1 text-sm text-[var(--muted)]">
                {state.manualReleaseList(job.id)?.summary ?? 'Available manual-search releases for this job.'}
              </div>
            </div>
            {#if state.manualReleaseList(job.id)}
              <div class="text-sm font-700">{state.manualReleaseList(job.id)?.releases.length} releases</div>
            {/if}
          </div>

          {#if state.manualReleaseLoading[job.id]}
            <div class="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]">
              <span class="spinner h-4 w-4 shrink-0" aria-hidden="true"></span>
              <span>Loading manual-search releases...</span>
            </div>
          {:else if state.manualReleaseError[job.id]}
            <div class="mt-3 rounded-[14px] border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
              {state.manualReleaseError[job.id]}
            </div>
          {:else if state.manualReleaseList(job.id)?.releases.length}
            <div class="mt-3 space-y-2">
              {#each state.manualReleaseList(job.id)?.releases ?? [] as release}
                <article class="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="break-all text-sm font-700 leading-5">{release.title}</div>
                      <div class="mt-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                        {release.indexer} · {release.protocol} · {formatBytes(release.size)}
                      </div>
                    </div>
                    <span class={`pill-shell border px-2 py-1 text-[11px] font-700 uppercase tracking-[0.08em] ${manualReleaseStatusTone(release.status)}`}>
                      {manualReleaseStatusLabel(release.status)}
                    </span>
                  </div>

                  <div class="mt-2 text-sm text-[var(--muted)]">
                    {release.languages.length > 0 ? release.languages.join(', ') : 'Unknown audio'} · Score {release.score}
                  </div>
                  <div class="mt-2 text-sm text-[var(--muted)]">{release.reason}</div>
                  {#if release.rejectionReasons.length > 0}
                    <div class="mt-2 text-sm text-[var(--muted)]">
                      Arr: {release.rejectionReasons.join('; ')}
                    </div>
                  {/if}

                  <div class="mt-3">
                    <button
                      class="control-primary min-h-10 w-full px-4 text-sm font-700 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      onclick={() => void state.selectManualRelease(job.id, release.guid, release.indexerId)}
                      disabled={state.manualSelectingJobId === job.id || state.deletingItemId === job.id}
                    >
                      {state.manualSelectingJobId === job.id ? 'Selecting...' : 'Select release'}
                    </button>
                  </div>
                </article>
              {/each}
            </div>
          {:else}
            <div class="mt-3 text-sm text-[var(--muted)]">No manual-search releases are currently available.</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</article>
