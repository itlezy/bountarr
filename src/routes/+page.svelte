<script lang="ts">
import { onMount } from 'svelte';
import { AppState } from '$lib/client/app-state.svelte';
import AddConfirmModal from '$lib/components/app/AddConfirmModal.svelte';
import DashboardView from '$lib/components/app/DashboardView.svelte';
import ManualReleaseModal from '$lib/components/app/ManualReleaseModal.svelte';
import QueueView from '$lib/components/app/QueueView.svelte';
import SearchView from '$lib/components/app/SearchView.svelte';
import SearchFiltersModal from '$lib/components/app/SearchFiltersModal.svelte';
import SettingsView from '$lib/components/app/SettingsView.svelte';
import StatusView from '$lib/components/app/StatusView.svelte';
import ViewToolbar from '$lib/components/app/ViewToolbar.svelte';
import type { PageData } from '$lib/client/app-state.svelte';

const props = $props<{ data: PageData }>();
const state = new AppState(() => props.data);

onMount(() => state.mount());

$effect(() => {
  state.handlePreferencesChanged();
});

$effect(() => {
  state.handleSearchStateChanged();
});

$effect(() => state.handleSearchInputChanged());
</script>

<svelte:body class:app-overlay-open={state.hasOpenOverlay || state.addSuccessToastMessage !== null} />

<svelte:head>
  <title>Bountarr</title>
  <meta
    name="description"
    content="Search, add, and audit media from Radarr and Sonarr with a mobile-friendly interface."
  />
</svelte:head>

<ViewToolbar
  activeView={state.activeView}
  onSelect={(view) => state.setActiveView(view)}
/>

<div class="app-shell mx-auto min-h-screen max-w-5xl text-[var(--text)]">
  {#if state.addSuccessToastMessage}
    <div class="app-success-overlay__backdrop" aria-hidden="true"></div>
    <div class="app-success-overlay__frame">
      <div
        class="floating-shell app-success-overlay__panel border-emerald-300 bg-emerald-50/95 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/85 dark:text-emerald-200"
        aria-live="polite"
        role="status"
      >
        <div class="app-success-overlay__body">
          <div class="text-[11px] font-700 uppercase tracking-[0.12em]">Added</div>
          <div class="mt-2 text-sm">{state.addSuccessToastMessage}</div>
        </div>
      </div>
    </div>
  {/if}
  <main class="app-main">
    {#if state.activeView === 'search'}
      <SearchView {state} />
    {:else if state.activeView === 'queue'}
      <QueueView {state} />
    {:else if state.activeView === 'dashboard'}
      <DashboardView {state} />
    {:else if state.activeView === 'status'}
      <StatusView {state} />
    {:else}
      <SettingsView {state} />
    {/if}
  </main>
</div>

<AddConfirmModal {state} />
<ManualReleaseModal {state} />
<SearchFiltersModal {state} />
