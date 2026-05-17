<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import {
  actionDisabled,
  actionLabel,
  auditEvidenceRows,
  auditDetailSummary,
  auditLabel,
  deleteActionLabel,
  mediaDetailRows,
  statusTone,
} from '$lib/client/app-ui';
import type { MediaItem } from '$lib/shared/types';

let { item, state }: { item: MediaItem; state: AppState } = $props();
const evidenceRows = $derived(auditEvidenceRows(item));
const mediaRows = $derived(mediaDetailRows(item.mediaDetails));
const manualReleaseJobId = $derived(state.auditManualReleaseJobId(item));

function fileNameOnly(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  const segments = normalized.split('/');
  return segments.at(-1) || value;
}
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
          <div class="overflow-safe-text text-base font-800">{item.title}</div>
          <div class="overflow-safe-text text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
            {item.kind} · {item.status}
          </div>
        </div>
        <span class={`pill-shell border px-2 py-1 text-[11px] font-700 uppercase tracking-[0.08em] ${statusTone[item.auditStatus]}`}>
          {auditLabel(item.auditStatus)}
        </span>
      </div>

      <div class="mt-3 overflow-safe-text rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted)]">
        {auditDetailSummary(item)}
      </div>

      {#if evidenceRows.length > 0}
        <dl class="mt-3 grid gap-x-3 gap-y-2 border-t border-[var(--line)] pt-3 text-sm sm:grid-cols-2">
          {#each evidenceRows as row}
            <div class="min-w-0">
              <dt class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">{row.label}</dt>
              <dd class="overflow-safe-text">{row.value}</dd>
            </div>
          {/each}
        </dl>
      {/if}

      {#if item.detail}
        <div class="mt-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">File name</div>
          <div class="mt-1 overflow-safe-text text-sm leading-5">{fileNameOnly(item.detail)}</div>
        </div>
      {/if}

      {#if mediaRows.length > 0}
        <dl class="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {#each mediaRows as row}
            <div class="min-w-0 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
              <dt class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">{row.label}</dt>
              <dd class="mt-1 overflow-safe-text font-700">{row.value}</dd>
            </div>
          {/each}
        </dl>
      {/if}

      <div class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div class="min-w-0">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Audio</div>
          <div class="overflow-safe-text">{item.audioLanguages.length > 0 ? item.audioLanguages.join(', ') : 'No metadata'}</div>
        </div>
        <div class="min-w-0">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Subtitles</div>
          <div class="overflow-safe-text">{item.subtitleLanguages.length > 0 ? item.subtitleLanguages.join(', ') : 'None detected'}</div>
        </div>
      </div>

      {#if item.canAdd || state.canGrabWithConfirmation(item) || state.hasAuditOperatorActions(item) || manualReleaseJobId}
        <div class="mt-3 space-y-2">
          {#if item.canAdd || state.canGrabWithConfirmation(item)}
            <button
              class="control-primary min-h-11 w-full px-4 text-sm font-700 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              disabled={actionDisabled(item, state.grabbing)}
              onclick={() => state.openAddConfirm(item)}
            >
              {actionLabel(item, state.grabbing)}
            </button>
          {/if}

          {#if manualReleaseJobId}
          <button
            class="control-shell min-h-11 w-full px-4 text-sm font-700 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            disabled={state.manualReleaseLoading[manualReleaseJobId] === true}
            onclick={() => void state.openManualReleaseList(manualReleaseJobId)}
          >
            {state.manualReleaseLoading[manualReleaseJobId] === true ? 'Loading releases...' : 'Review Releases'}
          </button>
          {/if}

          {#if state.hasAuditOperatorActions(item)}
          <button
            class="control-shell min-h-11 w-full border-rose-300 px-4 text-sm font-700 text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700 dark:text-rose-200"
            type="button"
            disabled={state.deletingItemId === item.id}
            onclick={() => void state.deleteMediaItem(item)}
          >
            {deleteActionLabel(item, state.deletingItemId)}
          </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</article>
