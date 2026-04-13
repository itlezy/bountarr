<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import { auditDetailSummary, auditLabel, deleteActionLabel, statusTone } from '$lib/client/app-ui';
import type { MediaItem } from '$lib/shared/types';

let { item, state }: { item: MediaItem; state: AppState } = $props();

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
          <div class="text-base font-800">{item.title}</div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
            {item.kind} · {item.status}
          </div>
        </div>
        <span class={`pill-shell border px-2 py-1 text-[11px] font-700 uppercase tracking-[0.08em] ${statusTone[item.auditStatus]}`}>
          {auditLabel(item.auditStatus)}
        </span>
      </div>

      <div class="mt-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted)]">
        {auditDetailSummary(item)}
      </div>

      {#if item.detail}
        <div class="mt-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">File name</div>
          <div class="mt-1 whitespace-normal break-all text-sm leading-5">{fileNameOnly(item.detail)}</div>
        </div>
      {/if}

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

      {#if state.hasAuditOperatorActions(item)}
        <div class="mt-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Operator tools</div>
          <button
            class="control-shell mt-3 min-h-11 w-full border-rose-300 px-4 text-sm font-700 text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-700 dark:text-rose-200"
            type="button"
            disabled={state.deletingItemId === item.id}
            onclick={() => void state.deleteMediaItem(item)}
          >
            {deleteActionLabel(item, state.deletingItemId)}
          </button>
        </div>
      {/if}
    </div>
  </div>
</article>
