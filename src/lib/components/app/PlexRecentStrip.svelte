<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';

let { state }: { state: AppState } = $props();
</script>

<section class="panel-shell relative px-3 py-3 sm:px-4">
  {#if state.recentPlexError}
    <div class="rounded-[14px] border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
      {state.recentPlexError}
    </div>
  {:else if state.recentPlexItems.length > 0}
    <div class="no-scrollbar flex gap-3 overflow-x-auto pb-1">
      {#each state.recentPlexItems as item}
        <article class="card-shell min-w-72 p-3">
          <div class="flex items-center gap-3">
            {#if item.poster}
              <img class="h-20 w-14 shrink-0 rounded-[12px] object-cover" src={item.poster} alt={`${item.title} poster`} />
            {:else}
              <div class="flex h-20 w-14 shrink-0 rounded-[12px] bg-slate-200 text-[10px] uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-800 dark:text-slate-300 items-center justify-center">
                {item.kind}
              </div>
            {/if}
            <div class="min-w-0 flex-1">
              <div class="truncate text-base font-800">{item.title}</div>
              <div class="mt-1 truncate text-[11px] uppercase tracking-[0.1em] text-[var(--muted)]">
                {item.kind}{item.detail ? ` · ${item.detail}` : ''}
              </div>
              <div class="mt-2 truncate text-sm text-[var(--muted)]">
                {item.plexLibraries.join(', ')}
              </div>
            </div>
          </div>
        </article>
      {/each}
    </div>
  {:else if state.recentPlexLoading}
    <div class="text-sm text-[var(--muted)]">Loading recent Plex items...</div>
  {:else}
    <div class="text-sm text-[var(--muted)]">No recent Plex items found.</div>
  {/if}
</section>
