<script lang="ts">
import {
  acquisitionAttemptSummary,
  acquisitionJourneySummary,
  acquisitionNextStep,
  acquisitionReasonSummary,
  acquisitionStatusLabel,
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
  </div>
</article>
