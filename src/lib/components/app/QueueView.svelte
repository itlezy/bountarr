<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import AcquisitionJobCard from '$lib/components/app/AcquisitionJobCard.svelte';
import QueueItemCard from '$lib/components/app/QueueItemCard.svelte';

let { state }: { state: AppState } = $props();
</script>

<section class="panel-shell relative px-3 py-3 sm:px-4">
  <div>
    <h2 class="text-lg font-800">Request progress</h2>
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
  {:else if state.queue && (state.queue.acquisitionJobs.length > 0 || state.queue.items.length > 0)}
    <div class="mt-4 space-y-3">
      {#each state.queue.acquisitionJobs as job}
        <AcquisitionJobCard {job} {state} />
      {/each}

      {#each state.queue.items as item}
        <QueueItemCard {item} {state} />
      {/each}
    </div>
  {:else}
    <div class="mt-4 text-sm text-[var(--muted)]">No active requests or downloads right now.</div>
  {/if}
</section>
