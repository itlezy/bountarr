<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import { dismissable } from '$lib/client/dismissable';
import PlexRecentStrip from '$lib/components/app/PlexRecentStrip.svelte';
import SearchFiltersPanel from '$lib/components/app/SearchFiltersPanel.svelte';
import SearchResultCard from '$lib/components/app/SearchResultCard.svelte';

let { state }: { state: AppState } = $props();
</script>

{#if state.config.plexConfigured}
  <PlexRecentStrip {state} />
{/if}

<section
  class="panel-shell relative z-10 px-3 py-3 sm:px-4"
  class:z-40={state.kindMenuOpen}
>
  <form class="space-y-2" onsubmit={(event) => {
    event.preventDefault();
    void state.runSearchNow();
  }}>
    <div class="flex flex-col items-stretch gap-2">
      <div class="relative w-full">
        <input
          class="control-shell min-h-12 w-full min-w-0 px-4 pr-12 text-sm text-[var(--text)]"
          bind:value={state.query}
          placeholder="Search movies or shows"
        />
        {#if state.query.trim().length > 0}
          <button
            class="control-shell app-icon-button absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2"
            type="button"
            data-testid="search-clear-button"
            aria-label="Clear search"
            onclick={() => {
              state.query = '';
              state.searchResults = [];
              state.searchError = null;
            }}
          >
            <svg
              class="app-icon-button__glyph"
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M4 4L12 12M12 4L4 12"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.8"
              />
            </svg>
          </button>
        {/if}
      </div>
    </div>
    <div
      class="relative"
      class:z-50={state.kindMenuOpen}
    >
      <button
        class="control-shell min-h-12 w-full px-3 text-xs font-700 uppercase tracking-[0.08em]"
        type="button"
        onclick={() => state.toggleKindMenu()}
      >
        {state.currentKindLabel}
      </button>
      {#if state.kindMenuOpen && !state.usesFullscreenDialogs}
          <div
            class="floating-shell absolute left-0 right-0 top-full z-[60] mt-2 p-2"
            use:dismissable={() => state.closeKindMenu()}
          >
            <SearchFiltersPanel {state} />
          </div>
      {/if}
    </div>
  </form>

  {#if state.latestActionMessage}
    <div class="mt-2 rounded-[14px] border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
      {state.latestActionMessage}
    </div>
  {/if}
</section>

<section class="panel-shell relative px-3 py-3 sm:px-4">
  <div class="text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">
    Search results
  </div>

  {#if !state.config.configured}
    <div class="mt-3 rounded-[14px] border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
      Configure your library services in `.env` before searching.
    </div>
  {:else if state.searchError}
    <div class="mt-3 rounded-[14px] border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
      {state.searchError}
    </div>
  {:else if state.query.trim().length < 2}
    <div class="mt-3 text-sm text-[var(--muted)]">Type at least two characters to search.</div>
  {:else if state.searchLoading}
    <div class="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]">
      <span class="spinner h-4 w-4 shrink-0" aria-hidden="true"></span>
      <span>Searching your library system{state.config.plexConfigured ? ' and Plex' : ''}...</span>
    </div>
  {:else if state.searchResults.length === 0}
    <div class="mt-3 text-sm text-[var(--muted)]">No results found.</div>
  {:else}
    <div class="mt-3 space-y-2">
      {#each state.visibleSearchResults as item}
        <SearchResultCard
          feedback={state.grabFeedback[item.id] ?? null}
          {item}
          {state}
        />
      {/each}
    </div>
  {/if}

  {#if state.grabError}
    <div class="mt-3 rounded-[14px] border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
      {state.grabError}
    </div>
  {/if}

  {#if state.deleteError}
    <div class="mt-3 rounded-[14px] border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
      {state.deleteError}
    </div>
  {/if}
</section>
