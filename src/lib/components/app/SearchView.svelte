<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import { dismissable } from '$lib/client/dismissable';
import PlexRecentStrip from '$lib/components/app/PlexRecentStrip.svelte';
import SearchResultCard from '$lib/components/app/SearchResultCard.svelte';

let { state }: { state: AppState } = $props();
</script>

{#if state.config.plexConfigured}
  <PlexRecentStrip {state} />
{/if}

<section
  class="panel-shell relative px-3 py-3 sm:px-4"
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
            class="control-shell absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-xs font-700"
            type="button"
            aria-label="Clear search"
            onclick={() => {
              state.query = '';
              state.searchResults = [];
              state.searchError = null;
            }}
          >
            X
          </button>
        {/if}
      </div>
    </div>
    <div
      class="relative"
      class:z-50={state.kindMenuOpen}
      use:dismissable={() => state.closeKindMenu()}
    >
      <button
        class="control-shell min-h-12 w-full px-3 text-xs font-700 uppercase tracking-[0.08em]"
        type="button"
        onclick={() => state.toggleKindMenu()}
      >
        {state.currentKindLabel}
      </button>
      {#if state.kindMenuOpen}
        <div class="floating-shell absolute left-0 right-0 top-full z-50 mt-2 p-2">
          <button
            class={`control-shell block min-h-9 w-full px-3 text-left text-sm ${state.kind === 'all' ? 'bg-[var(--surface)] font-700' : ''}`}
            type="button"
            onclick={() => {
              state.kind = 'all';
              state.kindMenuOpen = false;
            }}
          >
            All
          </button>
          <button
            class={`control-shell mt-1 block min-h-9 w-full px-3 text-left text-sm ${state.kind === 'movie' ? 'bg-[var(--surface)] font-700' : ''}`}
            type="button"
            onclick={() => {
              state.kind = 'movie';
              state.kindMenuOpen = false;
            }}
          >
            Movies
          </button>
          <button
            class={`control-shell mt-1 block min-h-9 w-full px-3 text-left text-sm ${state.kind === 'series' ? 'bg-[var(--surface)] font-700' : ''}`}
            type="button"
            onclick={() => {
              state.kind = 'series';
              state.kindMenuOpen = false;
            }}
          >
            Shows
          </button>
          <div class="mt-2 border-t border-[var(--line)] pt-2">
            <div class="px-3 text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">
              Availability
            </div>
            <button
              class={`control-shell mt-1 block min-h-9 w-full px-3 text-left text-sm ${state.availability === 'all' ? 'bg-[var(--surface)] font-700' : ''}`}
              type="button"
              onclick={() => {
                state.availability = 'all';
                state.kindMenuOpen = false;
              }}
            >
              All
            </button>
            <button
              class={`control-shell mt-1 block min-h-9 w-full px-3 text-left text-sm ${state.availability === 'available-only' ? 'bg-[var(--surface)] font-700' : ''}`}
              type="button"
              onclick={() => {
                state.availability = 'available-only';
                state.kindMenuOpen = false;
              }}
            >
              Only Available
            </button>
            <button
              class={`control-shell mt-1 block min-h-9 w-full px-3 text-left text-sm ${state.availability === 'not-available-only' ? 'bg-[var(--surface)] font-700' : ''}`}
              type="button"
              onclick={() => {
                state.availability = 'not-available-only';
                state.kindMenuOpen = false;
              }}
            >
              Only Not Available
            </button>
          </div>
          <div class="mt-2 border-t border-[var(--line)] pt-2">
            <div class="px-3 text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">
              Sort by
            </div>
            <button
              class={`control-shell mt-1 block min-h-9 w-full px-3 text-left text-sm ${state.sortField === 'title' ? 'bg-[var(--surface)] font-700' : ''}`}
              type="button"
              onclick={() => {
                state.sortField = 'title';
                state.kindMenuOpen = false;
              }}
            >
              Title
            </button>
            <button
              class={`control-shell mt-1 block min-h-9 w-full px-3 text-left text-sm ${state.sortField === 'year' ? 'bg-[var(--surface)] font-700' : ''}`}
              type="button"
              onclick={() => {
                state.sortField = 'year';
                state.kindMenuOpen = false;
              }}
            >
              Year
            </button>
            <button
              class={`control-shell mt-1 block min-h-9 w-full px-3 text-left text-sm ${state.sortField === 'popularity' ? 'bg-[var(--surface)] font-700' : ''}`}
              type="button"
              onclick={() => {
                state.sortField = 'popularity';
                state.kindMenuOpen = false;
              }}
            >
              Popularity
            </button>
            <button
              class={`control-shell mt-1 block min-h-9 w-full px-3 text-left text-sm ${state.sortField === 'rating' ? 'bg-[var(--surface)] font-700' : ''}`}
              type="button"
              onclick={() => {
                state.sortField = 'rating';
                state.kindMenuOpen = false;
              }}
            >
              Rating
            </button>
          </div>
          <div class="mt-2 border-t border-[var(--line)] pt-2">
            <div class="px-3 text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">
              Order
            </div>
            <button
              class={`control-shell mt-1 block min-h-9 w-full px-3 text-left text-sm ${state.sortDirection === 'asc' ? 'bg-[var(--surface)] font-700' : ''}`}
              type="button"
              onclick={() => {
                state.sortDirection = 'asc';
                state.kindMenuOpen = false;
              }}
            >
              Ascending
            </button>
            <button
              class={`control-shell mt-1 block min-h-9 w-full px-3 text-left text-sm ${state.sortDirection === 'desc' ? 'bg-[var(--surface)] font-700' : ''}`}
              type="button"
              onclick={() => {
                state.sortDirection = 'desc';
                state.kindMenuOpen = false;
              }}
            >
              Descending
            </button>
          </div>
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

<section class="panel-shell relative z-0 px-3 py-3 sm:px-4">
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
      <span>Searching your request system{state.config.plexConfigured ? ' and Plex' : ''}...</span>
    </div>
  {:else if state.searchResults.length === 0}
    <div class="mt-3 text-sm text-[var(--muted)]">No results found.</div>
  {:else}
    <div class="mt-3 space-y-2">
      {#each state.visibleSearchResults as item}
        <SearchResultCard
          feedback={state.requestFeedback[item.id] ?? null}
          {item}
          {state}
        />
      {/each}
    </div>
  {/if}

  {#if state.requestError}
    <div class="mt-3 rounded-[14px] border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
      {state.requestError}
    </div>
  {/if}

  {#if state.deleteError}
    <div class="mt-3 rounded-[14px] border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
      {state.deleteError}
    </div>
  {/if}
</section>
