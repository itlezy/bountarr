<script lang="ts">
  import { describeAcquisitionTarget } from '$lib/shared/acquisition-scope';
  import {
    acquisitionAttemptSummary,
    acquisitionJourneySummary,
    acquisitionNextStep,
    acquisitionReasonSummary,
    acquisitionStatusLabel,
    downloadedSummary,
    queueEtaLabel,
  } from '$lib/client/app-ui';
  import type { AppState } from '$lib/client/app-state.svelte';
  import type { ManagedQueueEntry } from '$lib/shared/types';

  let { entry, state }: { entry: ManagedQueueEntry; state: AppState } = $props();

  const job = $derived(entry.job);
  const liveQueueItems = $derived(entry.liveQueueItems);
  const liveSummary = $derived(entry.liveSummary);
  const displayProgress = $derived(liveSummary?.progress ?? job.progress);
  const displayQueueStatus = $derived(
    liveSummary?.status ?? job.queueStatus ?? job.validationSummary ?? 'Waiting for more progress',
  );
  const etaLabel = $derived(liveSummary ? queueEtaLabel(liveSummary) : null);
  const downloadSummary = $derived(
    liveSummary && !liveSummary.byteMetricsPartial ? downloadedSummary(liveSummary) : null,
  );
  const targetScope = $derived(describeAcquisitionTarget(job));
  const canOpenManualRelease = $derived(
    (job.status === 'queued' && job.queueStatus !== 'Manual selection queued') ||
      job.status === 'failed' ||
      job.status === 'retrying' ||
      job.status === 'searching',
  );
</script>

<article
  class={`card-shell p-3 ${state.isGuidedQueueJob(job.id) ? 'border-sky-400 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]' : ''}`}
  data-testid="acquisition-job-card"
  data-item-title={job.title}
>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="min-w-0">
      <div class="overflow-safe-text text-base font-800">{job.title}</div>
      <div class="overflow-safe-text text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
        {acquisitionJourneySummary(job)} · attempt {Math.min(job.attempt, job.maxRetries)}/{job.maxRetries}
      </div>
    </div>
    {#if displayProgress !== null}
      <div class="text-sm font-700">{Math.round(displayProgress)}%</div>
    {/if}
  </div>

  <div class="progress-track mt-3 h-2 overflow-hidden">
    <div
      class="progress-fill h-full"
      style={`width: ${displayProgress ?? 0}%`}
    ></div>
  </div>

  <div class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
    <div class="min-w-0">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Status</div>
      <div class="overflow-safe-text">{acquisitionStatusLabel(job.status)}</div>
    </div>
    <div class="min-w-0">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Last result</div>
      <div class="overflow-safe-text">{acquisitionReasonSummary(job) ?? 'No completed attempts yet'}</div>
    </div>
    <div class="min-w-0">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Next step</div>
      <div class="overflow-safe-text">{acquisitionNextStep(job) ?? 'Waiting'}</div>
    </div>
    <div class="min-w-0">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Queue check</div>
      <div class="overflow-safe-text">{displayQueueStatus}</div>
    </div>
    {#if downloadSummary}
      <div class="min-w-0">
        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Downloaded</div>
        <div class="overflow-safe-text">{downloadSummary}</div>
      </div>
    {/if}
    {#if etaLabel}
      <div class="min-w-0">
        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">ETA</div>
        <div class="overflow-safe-text">{etaLabel}</div>
      </div>
    {/if}
    {#if liveSummary}
      <div class="min-w-0 sm:col-span-2">
        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Queue detail</div>
        <div class="overflow-safe-text">
          {displayQueueStatus}
          {#if liveSummary.rowCount > 1}
            · {liveSummary.rowCount} live downloads
          {/if}
        </div>
      </div>
    {/if}
  </div>

  {#if liveQueueItems.length > 0}
    <div class="mt-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
        Live Arr Queue
      </div>
      <div class="mt-2 space-y-2">
        {#each liveQueueItems as liveQueueItem (liveQueueItem.queueId ?? liveQueueItem.id)}
          <div class="rounded-[12px] border border-[var(--line)] bg-[var(--surface-strong)] px-3 py-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="overflow-safe-text text-sm font-700">
                {liveQueueItem.detail ?? liveQueueItem.title}
              </div>
              {#if liveQueueItem.progress !== null}
                <div class="text-sm font-700">{Math.round(liveQueueItem.progress)}%</div>
              {/if}
            </div>
            <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{liveQueueItem.status}</div>
            <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
              {#if queueEtaLabel(liveQueueItem)}
                <div>{queueEtaLabel(liveQueueItem)}</div>
              {/if}
              {#if downloadedSummary(liveQueueItem) !== 'Unknown'}
                <div>{downloadedSummary(liveQueueItem)}</div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if job.failureReason}
    <div class="mt-3 overflow-safe-text rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted)]">
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
            <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{acquisitionAttemptSummary(attempt)}</div>
            {#if attempt.releaseTitle}
              <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{attempt.releaseTitle}</div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="mt-3 space-y-3">
    <div class="grid gap-2 text-sm sm:grid-cols-2">
      <div class="min-w-0">
        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Release</div>
        <div class="overflow-safe-text">{job.currentRelease ?? 'Waiting for selection'}</div>
      </div>
      <div class="min-w-0">
        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Preferred releaser</div>
        <div class="overflow-safe-text">{job.preferredReleaser ?? job.selectedReleaser ?? 'Not set'}</div>
      </div>
      {#if targetScope}
        <div class="min-w-0">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Scope</div>
          <div class="overflow-safe-text">{targetScope}</div>
        </div>
      {/if}
      <div class="min-w-0 sm:col-span-2">
        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Validation detail</div>
        <div class="overflow-safe-text">{job.validationSummary ?? 'Waiting for import'}</div>
      </div>
    </div>

    {#if entry.canCancel}
      <button
        class="control-shell min-h-10 w-full border-amber-300 px-4 text-sm font-700 text-amber-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:text-amber-200"
        type="button"
        onclick={() => void state.cancelQueueEntry(entry)}
        disabled={state.cancelingQueueEntryId === entry.id || state.deletingItemId === entry.id}
      >
        {state.cancelingQueueEntryId === entry.id ? 'Cancelling...' : 'Cancel download'}
      </button>
    {/if}

    {#if entry.canRemove}
      <button
        class="control-shell min-h-10 w-full border-rose-300 px-4 text-sm font-700 text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700 dark:text-rose-200"
        type="button"
        onclick={() => void state.deleteQueueEntry(entry)}
        disabled={state.deletingItemId === entry.id || state.cancelingQueueEntryId === entry.id}
      >
        {state.deletingItemId === entry.id ? 'Removing...' : 'Remove from Library'}
      </button>
    {/if}

    {#if state.queueEntryError(entry.id)}
      <div class="overflow-safe-text rounded-[14px] border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
        {state.queueEntryError(entry.id)}
      </div>
    {/if}

    {#if canOpenManualRelease}
      <div class="flex flex-col gap-2 sm:flex-row">
        <button
          class="control-shell min-h-10 flex-1 px-4 text-sm font-700"
          type="button"
          onclick={() => void state.toggleManualReleaseList(job.id)}
        >
          {state.manualReleaseListOpen(job.id) ? 'Hide manual release options' : 'Show manual release options'}
        </button>
      </div>
    {/if}
  </div>
</article>
