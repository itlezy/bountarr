<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import AuditItemCard from '$lib/components/app/AuditItemCard.svelte';

let { state }: { state: AppState } = $props();
</script>

<section class="panel-shell relative px-3 py-3 sm:px-4">
  <div>
    <h2 class="text-lg font-800">Download checks</h2>
    <div class="text-sm text-[var(--muted)]">
      {state.dashboard?.updatedAt ? `Updated ${new Date(state.dashboard.updatedAt).toLocaleTimeString()}` : 'Waiting for first sync'}
    </div>
  </div>

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

  {#if state.dashboardError}
    <div class="mt-4 rounded-[14px] border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
      {state.dashboardError}
    </div>
  {:else if state.dashboard && state.dashboard.items.length > 0}
    <div class="mt-4 space-y-4">
      {#if state.auditAttentionItems.length > 0}
        <div>
          <div class="text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">
            Needs attention
          </div>
          <div class="mt-3 space-y-3">
            {#each state.auditAttentionItems as item}
              <AuditItemCard {item} {state} />
            {/each}
          </div>
        </div>
      {/if}

      {#if state.auditPendingItems.length > 0}
        <div>
          <div class="text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">
            Waiting for check
          </div>
          <div class="mt-3 space-y-3">
            {#each state.auditPendingItems as item}
              <AuditItemCard {item} {state} />
            {/each}
          </div>
        </div>
      {/if}

      {#if state.auditVerifiedItems.length > 0}
        <div>
          <div class="text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">
            Recently verified
          </div>
          <div class="mt-3 space-y-3">
            {#each state.auditVerifiedItems as item}
              <AuditItemCard {item} {state} />
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="mt-4 text-sm text-[var(--muted)]">No recent downloads need checking.</div>
  {/if}
</section>
