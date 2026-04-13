<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import {
  actionDisabled,
  actionLabel,
  deleteActionLabel,
  formatRating,
  resultMessage,
  resultSummary,
} from '$lib/client/app-ui';
import type { MediaItem } from '$lib/shared/types';

let { feedback, item, state }: {
  feedback: string | null;
  item: MediaItem;
  state: AppState;
} = $props();
</script>

<article class="card-shell p-3">
  <div class="flex gap-3">
    {#if item.poster}
      <img class="h-28 w-20 shrink-0 rounded-[14px] object-cover" src={item.poster} alt={`${item.title} poster`} />
    {:else}
      <div class="flex h-28 w-20 shrink-0 rounded-[14px] bg-slate-200 text-[11px] uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-800 dark:text-slate-300 items-center justify-center">
        {item.kind}
      </div>
    {/if}

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 class="text-base font-800">{item.title}</h2>
        {#if item.year}
          <span class="text-sm text-[var(--muted)]">{item.year}</span>
        {/if}
        {#if formatRating(item.rating)}
          <span class="pill-shell border border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 text-[11px] font-700 uppercase tracking-[0.08em] text-[var(--muted)]">
            Rating {formatRating(item.rating)}
          </span>
        {/if}
      </div>

      <div class="mt-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
        {resultSummary(item)}
      </div>

      <div class="mt-2 flex flex-wrap gap-2 text-[11px] font-700 uppercase tracking-[0.08em]">
        {#if item.canAdd}
          <span class="border border-amber-300 bg-amber-50 px-2 py-1 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            Ready to Grab
          </span>
        {/if}
        {#if item.inArr}
          <span class="border border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
            Already Grabbed
          </span>
        {/if}
        {#if item.inPlex}
          <span class="border border-sky-300 bg-sky-50 px-2 py-1 text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
            Available in Plex
          </span>
        {/if}
      </div>

      <p class="mt-3 text-sm leading-5 text-[var(--muted)]">
        {item.overview || 'No overview available.'}
      </p>

      {#if item.inArr}
        <div class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Audio</div>
            <div>{item.audioLanguages.length > 0 ? item.audioLanguages.join(', ') : 'No metadata'}</div>
          </div>
          <div>
            <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Subtitles</div>
            <div>{item.subtitleLanguages.length > 0 ? item.subtitleLanguages.join(', ') : 'None detected'}</div>
          </div>
        </div>
      {/if}

      {#if item.plexLibraries.length > 0}
        <div class="mt-3 text-sm">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Plex libraries</div>
          <div>{item.plexLibraries.join(', ')}</div>
        </div>
      {/if}
    </div>
  </div>

  {#if feedback}
    <div class="mt-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
      {feedback}
    </div>
  {/if}

  {#if item.canAdd}
    <div class="mt-3">
      <button
        class="control-primary min-h-11 w-full px-4 text-sm font-700 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        disabled={actionDisabled(item, state.requesting)}
        onclick={() => state.openAddConfirm(item)}
      >
        {actionLabel(item, state.requesting)}
      </button>
    </div>
  {:else}
    <div class="mt-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
      {resultMessage(item)}
    </div>
  {/if}

  {#if state.hasSearchOperatorActions(item)}
    <div class="mt-3 space-y-2">
      {#if state.canOperatorRequestFromPlex(item)}
        <div class="text-sm text-[var(--muted)]">
          Plex already has this title, but you can still grab a managed copy from Arr if you want a different version.
        </div>
        <button
          class="control-primary min-h-10 w-full px-4 text-sm font-700"
          type="button"
          onclick={() => state.openAddConfirm(item, { operatorOverride: true })}
        >
          Grab anyway
        </button>
      {/if}
      {#if item.canDeleteFromArr}
        <button
          class="control-shell min-h-10 w-full border-rose-300 px-4 text-sm font-700 text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700 dark:text-rose-200"
          type="button"
          disabled={state.deletingItemId === item.id}
          onclick={() => void state.deleteMediaItem(item)}
        >
          {deleteActionLabel(item, state.deletingItemId)}
        </button>
      {/if}
    </div>
  {/if}
</article>
