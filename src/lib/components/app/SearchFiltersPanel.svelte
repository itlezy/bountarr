<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';

let { state }: { state: AppState } = $props();

function closeMenu(): void {
  state.kindMenuOpen = false;
}

function optionClass(selected: boolean, spacing = ''): string {
  return `filter-option control-shell ${spacing} ${selected ? 'filter-option-active' : ''}`.trim();
}
</script>

<button
  class={optionClass(state.kind === 'all')}
  type="button"
  onclick={() => {
    state.kind = 'all';
    closeMenu();
  }}
>
  <span>All</span>
  {#if state.kind === 'all'}
    <span class="filter-option__marker" aria-hidden="true">✓</span>
  {/if}
</button>
<button
  class={optionClass(state.kind === 'movie', 'mt-1')}
  type="button"
  onclick={() => {
    state.kind = 'movie';
    closeMenu();
  }}
>
  <span>Movies</span>
  {#if state.kind === 'movie'}
    <span class="filter-option__marker" aria-hidden="true">✓</span>
  {/if}
</button>
<button
  class={optionClass(state.kind === 'series', 'mt-1')}
  type="button"
  onclick={() => {
    state.kind = 'series';
    closeMenu();
  }}
>
  <span>Shows</span>
  {#if state.kind === 'series'}
    <span class="filter-option__marker" aria-hidden="true">✓</span>
  {/if}
</button>
<div class="mt-2 border-t border-[var(--line)] pt-2">
  <div class="px-3 text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">
    Availability
  </div>
  <button
    class={optionClass(state.availability === 'all', 'mt-1')}
    type="button"
    onclick={() => {
      state.availability = 'all';
      closeMenu();
    }}
  >
    <span>All</span>
    {#if state.availability === 'all'}
      <span class="filter-option__marker" aria-hidden="true">✓</span>
    {/if}
  </button>
  <button
    class={optionClass(state.availability === 'available-only', 'mt-1')}
    type="button"
    onclick={() => {
      state.availability = 'available-only';
      closeMenu();
    }}
  >
    <span>Only Available</span>
    {#if state.availability === 'available-only'}
      <span class="filter-option__marker" aria-hidden="true">✓</span>
    {/if}
  </button>
  <button
    class={optionClass(state.availability === 'not-available-only', 'mt-1')}
    type="button"
    onclick={() => {
      state.availability = 'not-available-only';
      closeMenu();
    }}
  >
    <span>Only Not Available</span>
    {#if state.availability === 'not-available-only'}
      <span class="filter-option__marker" aria-hidden="true">✓</span>
    {/if}
  </button>
</div>
<div class="mt-2 border-t border-[var(--line)] pt-2">
  <div class="px-3 text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">
    Sort by
  </div>
  <button
    class={optionClass(state.sortField === 'title', 'mt-1')}
    type="button"
    onclick={() => {
      state.sortField = 'title';
      closeMenu();
    }}
  >
    <span>Title</span>
    {#if state.sortField === 'title'}
      <span class="filter-option__marker" aria-hidden="true">✓</span>
    {/if}
  </button>
  <button
    class={optionClass(state.sortField === 'year', 'mt-1')}
    type="button"
    onclick={() => {
      state.sortField = 'year';
      closeMenu();
    }}
  >
    <span>Year</span>
    {#if state.sortField === 'year'}
      <span class="filter-option__marker" aria-hidden="true">✓</span>
    {/if}
  </button>
  <button
    class={optionClass(state.sortField === 'popularity', 'mt-1')}
    type="button"
    onclick={() => {
      state.sortField = 'popularity';
      closeMenu();
    }}
  >
    <span>Popularity</span>
    {#if state.sortField === 'popularity'}
      <span class="filter-option__marker" aria-hidden="true">✓</span>
    {/if}
  </button>
  <button
    class={optionClass(state.sortField === 'rating', 'mt-1')}
    type="button"
    onclick={() => {
      state.sortField = 'rating';
      closeMenu();
    }}
  >
    <span>Rating</span>
    {#if state.sortField === 'rating'}
      <span class="filter-option__marker" aria-hidden="true">✓</span>
    {/if}
  </button>
</div>
<div class="mt-2 border-t border-[var(--line)] pt-2">
  <div class="px-3 text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">
    Order
  </div>
  <button
    class={optionClass(state.sortDirection === 'asc', 'mt-1')}
    type="button"
    onclick={() => {
      state.sortDirection = 'asc';
      closeMenu();
    }}
  >
    <span>Ascending</span>
    {#if state.sortDirection === 'asc'}
      <span class="filter-option__marker" aria-hidden="true">✓</span>
    {/if}
  </button>
  <button
    class={optionClass(state.sortDirection === 'desc', 'mt-1')}
    type="button"
    onclick={() => {
      state.sortDirection = 'desc';
      closeMenu();
    }}
  >
    <span>Descending</span>
    {#if state.sortDirection === 'desc'}
      <span class="filter-option__marker" aria-hidden="true">✓</span>
    {/if}
  </button>
</div>
