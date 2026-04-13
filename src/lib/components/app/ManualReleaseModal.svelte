<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import { formatBytes, manualReleaseStatusLabel, manualReleaseStatusTone } from '$lib/client/app-ui';
import OverlayDialog from '$lib/components/app/OverlayDialog.svelte';

let { state }: { state: AppState } = $props();

const activeJobId = $derived(state.activeManualReleaseJobId);
const activeJob = $derived(state.activeManualReleaseJob);
const releaseList = $derived(activeJobId ? state.manualReleaseList(activeJobId) : null);
const releaseError = $derived(activeJobId ? state.manualReleaseError[activeJobId] : null);
const selectionError = $derived(activeJobId ? state.manualSelectionError[activeJobId] : null);
const isLoading = $derived(activeJobId ? state.manualReleaseLoading[activeJobId] === true : false);
</script>

{#if activeJobId}
  <OverlayDialog
    closeLabel="Close manual release options"
    onClose={() => state.closeManualReleaseList()}
    size="wide"
    title="Manual release options"
    subtitle={activeJob ? `${activeJob.title} · attempt ${Math.min(activeJob.attempt, activeJob.maxRetries)}/${activeJob.maxRetries}` : 'Choose a release for this acquisition job.'}
  >
    {#snippet children()}
      <div class="space-y-4">
        {#if activeJob}
          <div class="grid gap-3 text-sm sm:grid-cols-2">
            <div class="min-w-0 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
              <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Current release</div>
              <div class="mt-1 overflow-safe-text">{activeJob.currentRelease ?? 'Waiting for selection'}</div>
            </div>
            <div class="min-w-0 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
              <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Preferred releaser</div>
              <div class="mt-1 overflow-safe-text">{activeJob.preferredReleaser ?? activeJob.selectedReleaser ?? 'Not set'}</div>
            </div>
          </div>
        {/if}

        {#if selectionError}
          <div class="overflow-safe-text rounded-[14px] border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            {selectionError}
          </div>
        {/if}

        <div class="rounded-[14px] border border-[var(--line)] bg-[var(--surface-strong)] p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Manual results</div>
              <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">
                {releaseList?.summary ?? 'Available manual-search releases for this job.'}
              </div>
            </div>
            {#if releaseList}
              <div class="text-sm font-700">{releaseList.releases.length} releases</div>
            {/if}
          </div>

          {#if isLoading}
            <div class="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]">
              <span class="spinner h-4 w-4 shrink-0" aria-hidden="true"></span>
              <span>Loading manual-search releases...</span>
            </div>
          {:else if releaseError}
            <div class="mt-3 overflow-safe-text rounded-[14px] border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
              {releaseError}
            </div>
          {:else if releaseList?.releases.length}
            <div class="mt-3 space-y-2">
              {#each releaseList.releases as release}
                <article class="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="overflow-safe-text text-sm font-700 leading-5">{release.title}</div>
                      <div class="mt-1 overflow-safe-text text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                        {release.indexer} · {release.protocol} · {formatBytes(release.size)}
                      </div>
                    </div>
                    <span class={`pill-shell border px-2 py-1 text-[11px] font-700 uppercase tracking-[0.08em] ${manualReleaseStatusTone(release.status)}`}>
                      {manualReleaseStatusLabel(release.status)}
                    </span>
                  </div>

                  <div class="mt-2 overflow-safe-text text-sm text-[var(--muted)]">
                    {release.languages.length > 0 ? release.languages.join(', ') : 'Unknown audio'} · Score {release.score}
                  </div>
                  <div class="mt-2 overflow-safe-text text-sm text-[var(--muted)]">{release.reason}</div>
                  {#if release.identityStatus === 'mismatch'}
                    <div class="mt-2 overflow-safe-text rounded-[14px] border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                      Title mismatch: {release.identityReason}
                    </div>
                  {/if}
                  {#if release.rejectionReasons.length > 0}
                    <div class="mt-2 overflow-safe-text text-sm text-[var(--muted)]">
                      Arr: {release.rejectionReasons.join('; ')}
                    </div>
                  {/if}

                  <div class="mt-3">
                    <button
                      class="control-primary min-h-10 w-full px-4 text-sm font-700 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      onclick={() => void state.selectManualRelease(activeJobId, release.guid, release.indexerId)}
                      disabled={state.manualSelectingJobId === activeJobId || state.deletingItemId === activeJobId}
                    >
                      {state.manualSelectingJobId === activeJobId ? 'Selecting...' : 'Select release'}
                    </button>
                  </div>
                </article>
              {/each}
            </div>
          {:else}
            <div class="mt-3 text-sm text-[var(--muted)]">No manual-search releases are currently available.</div>
          {/if}
        </div>
      </div>
    {/snippet}
  </OverlayDialog>
{/if}
