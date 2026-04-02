<script lang="ts">
import { onMount } from 'svelte';
import { AppState } from '$lib/client/app-state.svelte';
import AddConfirmModal from '$lib/components/app/AddConfirmModal.svelte';
import DashboardView from '$lib/components/app/DashboardView.svelte';
import QueueView from '$lib/components/app/QueueView.svelte';
import SearchView from '$lib/components/app/SearchView.svelte';
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

<svelte:head>
  <title>Bountarr</title>
  <meta
    name="description"
    content="Search, add, and audit media from Radarr and Sonarr with a mobile-friendly interface."
  />
</svelte:head>

<div class="app-shell mx-auto min-h-screen max-w-5xl text-[var(--text)]">
  <ViewToolbar
    activeView={state.activeView}
    onSelect={(view) => state.setActiveView(view)}
  />
  {#if state.addSuccessToastMessage}
    <div class="pointer-events-none fixed left-1/2 top-24 z-[60] w-[calc(100%-1rem)] max-w-md -translate-x-1/2 sm:top-28 sm:w-[calc(100%-1.5rem)]">
      <div class="floating-shell border-emerald-300 bg-emerald-50/95 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/85 dark:text-emerald-200">
        {state.addSuccessToastMessage}
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
