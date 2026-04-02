<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import { cardViewOptions } from '$lib/shared/card-views';
import { preferredAudioOptions, subtitleLanguageOptions } from '$lib/shared/languages';
import { themeOptions } from '$lib/shared/themes';

let { state }: { state: AppState } = $props();
</script>

<section class="panel-shell relative px-3 py-3 sm:px-4">
  <div>
    <h2 class="text-lg font-800">Settings</h2>
    <div class="mt-1 text-sm text-[var(--muted)]">Local-only preferences for theme, card chrome, language, subtitles, and notifications.</div>
  </div>

  <div class="mt-4 space-y-4 border-t border-[var(--line)] pt-4">
    <label class="block">
      <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Theme</div>
      <select
        class="control-shell min-h-12 w-full px-4 text-sm"
        bind:value={state.theme}
      >
        {#each themeOptions as themeOption}
          <option value={themeOption.value}>{themeOption.label}</option>
        {/each}
      </select>
    </label>

    <label class="block">
      <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Cards view</div>
      <select
        class="control-shell min-h-12 w-full px-4 text-sm"
        bind:value={state.cardsView}
      >
        {#each cardViewOptions as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>

    <label class="block">
      <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Preferred audio</div>
      <select
        class="control-shell min-h-12 w-full px-4 text-sm"
        bind:value={state.preferredLanguage}
      >
        {#each preferredAudioOptions as language}
          <option value={language}>{language}</option>
        {/each}
      </select>
    </label>

    <label class="block">
      <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Subtitle language</div>
      <select
        class="control-shell min-h-12 w-full px-4 text-sm"
        bind:value={state.subtitleLanguage}
      >
        {#each subtitleLanguageOptions as language}
          <option value={language}>{language}</option>
        {/each}
      </select>
    </label>

    <div class="text-sm text-[var(--muted)]">
      `Any` leaves that language unconstrained. A specific subtitle language makes that subtitle language required during audit and validation.
    </div>

    <div class="space-y-3 border-t border-[var(--line)] pt-4">
      <button
        class="control-shell min-h-10 w-full px-4 text-sm font-700"
        type="button"
        onclick={() => void state.enableNotifications()}
      >
        Enable browser notifications
      </button>
      {#if state.notificationState !== 'idle'}
        <div class="text-sm text-[var(--muted)]">
          {state.notificationState === 'unsupported'
            ? 'This browser does not support notifications.'
            : `Notification permission: ${state.notificationState}`}
        </div>
      {/if}
    </div>
  </div>
</section>
