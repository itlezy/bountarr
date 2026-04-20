<script lang="ts">
import { acquisitionStatusLabel, queueItemSummary } from '$lib/client/app-ui';
import type { AppState } from '$lib/client/app-state.svelte';
import AcquisitionJobCard from '$lib/components/app/AcquisitionJobCard.svelte';
import QueueItemCard from '$lib/components/app/QueueItemCard.svelte';
import type { QueueEntry } from '$lib/shared/types';

let { state }: { state: AppState } = $props();

function compactEntryTitle(entry: QueueEntry): string {
  return entry.kind === 'managed' ? entry.job.title : entry.item.title;
}

function compactEntryStatus(entry: QueueEntry): string {
  if (entry.kind === 'managed') {
    return entry.liveSummary?.status ?? acquisitionStatusLabel(entry.job.status);
  }

  return queueItemSummary(entry.item);
}

function compactEntryContext(entry: QueueEntry): string | null {
  if (entry.kind === 'managed') {
    if (entry.liveQueueItems.length > 1) {
      return `${entry.liveQueueItems.length} live queue rows`;
    }

    return entry.liveQueueItems[0]?.detail ?? entry.job.currentRelease;
  }

  const detailParts = entry.canRemove
    ? [entry.item.statusDetail, entry.item.detail]
    : [entry.item.detail, entry.item.statusDetail];
  const context = detailParts.filter((value): value is string => Boolean(value && value.trim()));
  return context.length > 0 ? context.join(' · ') : null;
}

function compactEntryProgress(entry: QueueEntry): number | null {
  return entry.kind === 'managed'
    ? (entry.liveSummary?.progress ?? entry.job.progress)
    : entry.item.progress;
}

function compactEntryTag(entry: QueueEntry): string {
  if (entry.kind === 'managed') {
    return 'Managed grab';
  }

  return entry.canRemove ? 'Stale queue entry' : 'External download';
}
</script>

<section class="panel-shell relative px-3 py-3 sm:px-4">
  <div>
    <h2 class="text-lg font-800">Grab Progress</h2>
    <div class="text-sm text-[var(--muted)]">
      {state.queue?.updatedAt ? `Updated ${new Date(state.queue.updatedAt).toLocaleTimeString()}` : 'Waiting for first sync'}
    </div>
  </div>

  {#if state.queueGuidanceMessage}
    <div class="mt-4 rounded-[14px] border border-sky-300 bg-sky-50 p-3 text-sm text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
      {state.queueGuidanceMessage}
    </div>
  {/if}

  {#if state.latestActionMessage}
    <div class="mt-4 rounded-[14px] border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
      {state.latestActionMessage}
    </div>
  {/if}

  {#if state.deleteError}
    <div class="mt-4 rounded-[14px] border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
      {state.deleteError}
    </div>
  {/if}

  {#if state.queueError}
    <div class="mt-4 rounded-[14px] border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
      {state.queueError}
    </div>
  {:else if state.queueLoading && !state.queue}
    <div class="mt-4 text-sm text-[var(--muted)]">Loading active downloads...</div>
  {:else if state.queue && state.queue.entries.length > 1}
    <div class="mt-4 space-y-4">
      <div class="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-3">
        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Active items</div>
        <div class="mt-3 grid gap-2">
          {#each state.queue.entries as entry}
            <button
              class={`queue-entry-list-item w-full rounded-[14px] border px-3 py-3 text-left transition ${
                state.selectedQueueEntry?.id === entry.id
                  ? 'queue-entry-list-item-selected border-sky-400 bg-sky-50 shadow-[0_0_0_1px_rgba(56,189,248,0.25)] dark:border-sky-700 dark:bg-sky-950/30'
                  : 'border-[var(--line)] bg-[var(--surface-strong)]'
              }`}
              data-testid="queue-entry-list-item"
              type="button"
              aria-pressed={state.selectedQueueEntry?.id === entry.id}
              data-selected={state.selectedQueueEntry?.id === entry.id}
              onclick={() => state.selectQueueEntry(entry.id)}
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <div class="overflow-safe-text text-sm font-800">{compactEntryTitle(entry)}</div>
                    <span class="pill-shell border border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 text-[10px] font-700 uppercase tracking-[0.08em] text-[var(--muted)]">
                      {compactEntryTag(entry)}
                    </span>
                    {#if entry.kind === 'managed' && state.isGuidedQueueJob(entry.job.id)}
                      <span class="pill-shell border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-700 uppercase tracking-[0.08em] text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
                        Tracking
                      </span>
                    {/if}
                  </div>
                  <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{compactEntryStatus(entry)}</div>
                  {#if compactEntryContext(entry)}
                    <div class="mt-1 overflow-safe-text text-xs text-[var(--muted)]">{compactEntryContext(entry)}</div>
                  {/if}
                </div>
                {#if compactEntryProgress(entry) !== null}
                  <div class="queue-entry-list-item__metric shrink-0 text-sm font-700">
                    {Math.round(compactEntryProgress(entry) ?? 0)}%
                  </div>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      </div>

      {#if state.selectedQueueEntry}
        {#if state.selectedQueueEntry.kind === 'managed'}
          <AcquisitionJobCard entry={state.selectedQueueEntry} {state} />
        {:else}
          <QueueItemCard entry={state.selectedQueueEntry} {state} />
        {/if}
      {:else}
        <div class="rounded-[16px] border border-dashed border-[var(--line)] bg-[var(--surface)] px-4 py-6 text-sm text-[var(--muted)]">
          Select an item above to inspect its current queue details.
        </div>
      {/if}
    </div>
  {:else if state.queue && state.queue.entries.length > 0}
    <div class="mt-4 space-y-3">
      {#each state.queue.entries as entry}
        {#if entry.kind === 'managed'}
          <AcquisitionJobCard {entry} {state} />
        {:else}
          <QueueItemCard {entry} {state} />
        {/if}
      {/each}
    </div>
  {:else}
    <div class="mt-4 text-sm text-[var(--muted)]">No active requests or downloads right now.</div>
  {/if}
</section>
