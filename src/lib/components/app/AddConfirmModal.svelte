<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import OverlayDialog from '$lib/components/app/OverlayDialog.svelte';
import { preferredAudioOptions, subtitleLanguageOptions } from '$lib/shared/languages';

let { state }: { state: AppState } = $props();

const confirmItem = $derived(state.confirmAddItem);
const confirmSeasonOptions = $derived(state.confirmSeasonOptions);
const isSubmitting = $derived(confirmItem ? state.grabbing === confirmItem.id : false);
const submitLabel = $derived(
  confirmItem?.inArr ? 'Grab Again' : 'Grab',
);

function seasonLabel(seasonNumber: number): string {
  return seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`;
}
</script>

{#if confirmItem}
  <OverlayDialog
    closeLabel="Close grab confirmation"
    closeDisabled={isSubmitting}
    onClose={() => state.closeAddConfirm()}
    size={confirmItem.kind === 'series' ? 'wide' : 'narrow'}
    title="Grab title"
    subtitle={`${confirmItem.title}${confirmItem.year ? ` (${confirmItem.year})` : ''}`}
  >
    {#snippet children()}
      <div class="space-y-4">
        <label class="block">
          <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
            Quality profile
          </div>
          <select
            class="control-shell min-h-11 w-full px-3 text-sm"
            bind:value={state.confirmQualityProfileId}
            disabled={isSubmitting}
          >
            {#each state.qualityProfileOptions(confirmItem) as profile}
              <option value={profile.id}>
                {profile.name}{profile.isDefault ? ' (default)' : ''}
              </option>
            {/each}
          </select>
        </label>

        {#if confirmItem.kind === 'series' && confirmSeasonOptions.length > 0}
          <div>
            <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              Seasons to monitor
            </div>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {#each confirmSeasonOptions as seasonNumber}
                <button
                  class={`${state.confirmSeasonSelected(seasonNumber) ? 'control-primary' : 'control-shell'} min-h-10 px-3 text-sm font-700`}
                  type="button"
                  aria-pressed={state.confirmSeasonSelected(seasonNumber)}
                  disabled={isSubmitting}
                  onclick={() => state.toggleConfirmSeason(seasonNumber)}
                >
                  {seasonLabel(seasonNumber)}
                </button>
              {/each}
            </div>
            <div class="mt-2 text-xs text-[var(--muted)]">
              Only the selected seasons will be monitored when this show is added. The default is first season only.
            </div>
            {#if !state.confirmCanSubmit}
              <div class="mt-2 text-xs text-rose-700 dark:text-rose-200">
                Select at least one season to grab this show.
              </div>
            {/if}
          </div>
        {/if}

        <label class="block">
          <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
            Preferred audio
          </div>
          <select
            class="control-shell min-h-11 w-full px-3 text-sm"
            bind:value={state.confirmPreferredLanguage}
            disabled={isSubmitting}
          >
            {#each preferredAudioOptions as language}
              <option value={language}>{language}</option>
            {/each}
          </select>
        </label>

        <label class="block">
          <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
            Subtitle language
          </div>
          <select
            class="control-shell min-h-11 w-full px-3 text-sm"
            bind:value={state.confirmSubtitleLanguage}
            disabled={isSubmitting}
          >
            {#each subtitleLanguageOptions as language}
              <option value={language}>{language}</option>
            {/each}
          </select>
        </label>

        {#if confirmItem.inArr || confirmItem.inPlex}
          <div class="rounded-[14px] border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            {#if confirmItem.inArr && confirmItem.inPlex}
              Plex already has this title and Arr is already tracking it. Confirm to download an alternate release anyway.
            {:else if confirmItem.inArr}
              Arr is already tracking this title. Confirm to download an alternate release anyway.
            {:else}
              Plex already has this title. Confirm to download an alternate release anyway.
            {/if}
          </div>
        {/if}

        <div class="text-xs text-[var(--muted)]">
          Defaults come from Settings. Confirming this grab also updates your local defaults to match these choices.
        </div>
        <div class="text-xs text-[var(--muted)]">
          `Any` leaves audio or subtitles unconstrained for this grab. Choosing a specific subtitle language makes that subtitle language required.
        </div>
        <div class="text-xs text-[var(--muted)]">
          The env-configured quality profile is used as the default, but you can override it for this grab.
        </div>
      </div>
    {/snippet}

    {#snippet footer()}
      <div>
        <button
          class="control-primary min-h-11 w-full px-4 text-sm font-700 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onclick={() => {
            void state.submitGrab(
              confirmItem,
              state.confirmQualityProfileId,
              {
                cardsView: state.cardsView,
                preferredLanguage: state.confirmPreferredLanguage,
                subtitleLanguage: state.confirmSubtitleLanguage,
                theme: state.theme,
              },
              confirmItem.kind === 'series' ? state.confirmSeasonNumbers : undefined,
            );
          }}
          disabled={isSubmitting || !state.confirmCanSubmit}
        >
          <span class="flex items-center justify-center gap-2">
            {#if isSubmitting}
              <span class="spinner h-4 w-4 shrink-0" aria-hidden="true"></span>
            {/if}
            <span>{isSubmitting ? 'Grabbing...' : submitLabel}</span>
          </span>
        </button>
      </div>
    {/snippet}
  </OverlayDialog>
{/if}
