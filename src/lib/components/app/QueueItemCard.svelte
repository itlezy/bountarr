<script lang="ts">
import { downloadedSummary, queueItemNextStep, queueItemSummary } from '$lib/client/app-ui';
import type { AppState } from '$lib/client/app-state.svelte';
import type { QueueItem } from '$lib/shared/types';

let { item, state }: { item: QueueItem; state: AppState } = $props();
</script>

<article class="card-shell p-3">
  <div class="flex gap-3">
    {#if item.poster}
      <img class="h-24 w-18 shrink-0 rounded-[14px] object-cover" src={item.poster} alt={`${item.title} poster`} />
    {:else}
      <div class="flex h-24 w-18 shrink-0 rounded-[14px] bg-slate-200 text-[11px] uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-800 dark:text-slate-300 items-center justify-center">
        {item.kind}
      </div>
    {/if}

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-base font-800">{item.title}</div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
            {queueItemSummary(item)}
          </div>
        </div>
        {#if item.progress !== null}
          <div class="text-sm font-700">{Math.round(item.progress)}%</div>
        {/if}
      </div>

      <div class="progress-track mt-3 h-2 overflow-hidden">
        <div
          class="progress-fill h-full"
          style={`width: ${item.progress ?? 0}%`}
        ></div>
      </div>

      <div class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Next step</div>
          <div>{queueItemNextStep(item)}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Download progress</div>
          <div>{downloadedSummary(item)}</div>
        </div>
        <div class="sm:col-span-2">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Queue detail</div>
          <div>
            {item.status}
            {#if item.detail}
              · {item.detail}
            {/if}
            {#if item.estimatedCompletionTime}
              · ETA {new Date(item.estimatedCompletionTime).toLocaleString()}
            {/if}
          </div>
        </div>
      </div>

      {#if state.hasQueueOperatorActions(item)}
        <div class="mt-3">
          <button
            class="control-shell min-h-10 w-full px-4 text-sm font-700"
            type="button"
            onclick={() => state.toggleOperatorReveal('queue', item.id)}
          >
            {state.operatorRevealOpen('queue', item.id) ? 'Hide operator tools' : 'Show operator tools'}
          </button>
        </div>
      {/if}

      {#if state.operatorRevealOpen('queue', item.id)}
        <div class="mt-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Operator tools</div>
          <button
            class="control-shell mt-3 min-h-10 w-full border-rose-300 px-4 text-sm font-700 text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700 dark:text-rose-200"
            type="button"
            onclick={() => void state.deleteQueueArrItem(item)}
            disabled={state.deletingItemId === item.id}
          >
            {state.deletingItemId === item.id ? 'Removing...' : 'Remove from library system'}
          </button>
        </div>
      {/if}
    </div>
  </div>
</article>
