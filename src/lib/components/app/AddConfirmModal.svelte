<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import { preferredAudioOptions, subtitleLanguageOptions } from '$lib/shared/languages';

let { state }: { state: AppState } = $props();
</script>

{#if state.confirmAddItem}
  <button
    class="fixed inset-0 z-40 bg-black/45"
    type="button"
    aria-label="Close add confirmation"
    onclick={() => state.closeAddConfirm()}
  ></button>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <section class="floating-shell w-full max-w-sm p-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-lg font-800">Add to Arr</div>
          <div class="mt-1 text-sm text-[var(--muted)]">
            {state.confirmAddItem.title}{state.confirmAddItem.year ? ` (${state.confirmAddItem.year})` : ''}
          </div>
        </div>
        <button
          class="control-shell flex h-8 w-8 items-center justify-center text-sm font-700"
          type="button"
          aria-label="Close add confirmation"
          onclick={() => state.closeAddConfirm()}
        >
          X
        </button>
      </div>

      <div class="mt-4">
        <div class="space-y-4">
          <label class="block">
            <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              Quality profile
            </div>
            <select
              class="control-shell min-h-11 w-full px-3 text-sm"
              bind:value={state.confirmQualityProfileId}
            >
              {#each state.qualityProfileOptions(state.confirmAddItem) as profile}
                <option value={profile.id}>
                  {profile.name}{profile.isDefault ? ' (default)' : ''}
                </option>
              {/each}
            </select>
          </label>
          <label class="block">
            <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
              Preferred audio
            </div>
            <select
              class="control-shell min-h-11 w-full px-3 text-sm"
              bind:value={state.confirmPreferredLanguage}
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
            >
              {#each subtitleLanguageOptions as language}
                <option value={language}>{language}</option>
              {/each}
            </select>
          </label>
        </div>
        <div class="mt-3 text-xs text-[var(--muted)]">
          Defaults come from Settings. Confirming this add also updates your local defaults to match these choices.
        </div>
        <div class="mt-2 text-xs text-[var(--muted)]">
          `Any` leaves audio or subtitles unconstrained for this add. Choosing a specific subtitle language makes that subtitle language required.
        </div>
        <div class="mt-2 text-xs text-[var(--muted)]">
          The env-configured quality profile is used as the default, but you can override it for this add.
        </div>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-2">
        <button
          class="control-shell min-h-11 px-4 text-sm font-700"
          type="button"
          onclick={() => state.closeAddConfirm()}
          disabled={state.requesting === state.confirmAddItem.id}
        >
          Cancel
        </button>
        <button
          class="control-primary min-h-11 px-4 text-sm font-700 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onclick={() => {
            if (state.confirmAddItem) {
              void state.submitRequest(
                state.confirmAddItem,
                state.confirmQualityProfileId,
                {
                  cardsView: state.cardsView,
                  preferredLanguage: state.confirmPreferredLanguage,
                  subtitleLanguage: state.confirmSubtitleLanguage,
                  theme: state.theme,
                },
              );
            }
          }}
          disabled={state.requesting === state.confirmAddItem.id}
        >
          {state.requesting === state.confirmAddItem.id ? 'Adding...' : 'Confirm'}
        </button>
      </div>
    </section>
  </div>
{/if}
