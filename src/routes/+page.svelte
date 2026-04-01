<script lang="ts">
  import { onMount } from 'svelte';
  import { applyTheme, loadPreferences, savePreferences } from '$lib/client/storage';
  import {
    ensureNotificationPermission,
    notifyAuditFailures,
    pushNotification
  } from '$lib/client/notifications';
  import { defaultPreferences } from '$lib/shared/preferences';
  import type {
    ConfigStatus,
    DashboardResponse,
    MediaItem,
    Preferences,
    RequestResponse,
    SearchKind
  } from '$lib/shared/types';

  const { data } = $props<{ data: { config: ConfigStatus } }>();

  let preferences = $state<Preferences>(defaultPreferences);
  let initialized = false;
  let activeView = $state<'dashboard' | 'search'>('search');
  let query = $state('');
  let kind = $state<SearchKind>('all');
  let searchResults = $state<MediaItem[]>([]);
  let dashboard = $state<DashboardResponse | null>(null);
  let searchError = $state<string | null>(null);
  let dashboardError = $state<string | null>(null);
  let requestError = $state<string | null>(null);
  let searchLoading = $state(false);
  let dashboardLoading = $state(false);
  let requesting = $state<string | null>(null);
  let notificationState = $state<NotificationPermission | 'unsupported' | 'idle'>('idle');
  let settingsOpen = $state(false);

  function preferencesQuery() {
    return new URLSearchParams({
      preferredLanguage: preferences.preferredLanguage,
      requireSubtitles: String(preferences.requireSubtitles)
    });
  }

  function auditLabel(status: MediaItem['auditStatus']) {
    switch (status) {
      case 'verified':
        return 'Verified';
      case 'missing-language':
        return 'Missing audio';
      case 'no-subs':
        return 'Missing subs';
      case 'unknown':
        return 'Unknown';
      default:
        return 'Pending';
    }
  }

  async function loadDashboard(force = false) {
    if (!data.config.configured) {
      return;
    }

    dashboardLoading = true;
    dashboardError = null;

    try {
      const endpoint = force ? '/api/dashboard/refresh' : `/api/dashboard?${preferencesQuery().toString()}`;
      const response = await fetch(endpoint, {
        method: force ? 'POST' : 'GET',
        headers: force ? { 'Content-Type': 'application/json' } : undefined,
        body: force
          ? JSON.stringify({
              preferredLanguage: preferences.preferredLanguage,
              requireSubtitles: preferences.requireSubtitles
            })
          : undefined
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      dashboard = (await response.json()) as DashboardResponse;
      notifyAuditFailures(dashboard.items);
    } catch (error) {
      dashboardError = error instanceof Error ? error.message : 'Unable to load the dashboard.';
    } finally {
      dashboardLoading = false;
    }
  }

  async function loadSearch(searchTerm: string, searchKind: SearchKind) {
    if (searchTerm.trim().length < 2) {
      searchResults = [];
      searchError = null;
      return;
    }

    searchLoading = true;
    searchError = null;

    try {
      const params = new URLSearchParams({
        q: searchTerm.trim(),
        kind: searchKind
      });
      const response = await fetch(`/api/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }

      searchResults = (await response.json()) as MediaItem[];
    } catch (error) {
      searchError = error instanceof Error ? error.message : 'Search failed.';
    } finally {
      searchLoading = false;
    }
  }

  async function submitRequest(item: MediaItem) {
    requesting = item.id;
    requestError = null;

    try {
      const response = await fetch('/api/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          item,
          preferences: {
            preferredLanguage: preferences.preferredLanguage,
            requireSubtitles: preferences.requireSubtitles
          }
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = (await response.json()) as RequestResponse;
      pushNotification('Bountarr', result.message);
      searchResults = searchResults.map((candidate) => (candidate.id === item.id ? result.item : candidate));
      activeView = 'dashboard';
      await loadDashboard(true);
    } catch (error) {
      requestError = error instanceof Error ? error.message : 'Request failed.';
      pushNotification('Bountarr request failed', requestError);
    } finally {
      requesting = null;
    }
  }

  async function enableNotifications() {
    notificationState = await ensureNotificationPermission();
  }

  onMount(() => {
    preferences = loadPreferences();
    applyTheme(preferences.theme);
    initialized = true;
    void loadDashboard();

    const interval = window.setInterval(() => {
      void loadDashboard();
    }, 5 * 60_000);

    return () => {
      window.clearInterval(interval);
    };
  });

  $effect(() => {
    if (!initialized) {
      return;
    }

    savePreferences(preferences);
    applyTheme(preferences.theme);
    void loadDashboard();
  });

  $effect(() => {
    if (!initialized) {
      return;
    }

    const handle = window.setTimeout(() => {
      void loadSearch(query, kind);
    }, 250);

    return () => {
      window.clearTimeout(handle);
    };
  });

  const statusTone: Record<MediaItem['auditStatus'], string> = {
    pending: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100',
    verified: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
    'missing-language': 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200',
    'no-subs': 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
    unknown: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
  };
</script>

<svelte:head>
  <title>Bountarr</title>
  <meta
    name="description"
    content="Request media from Radarr and Sonarr, then audit downloads for language and subtitles."
  />
</svelte:head>

<div class="mx-auto min-h-screen max-w-5xl px-0 py-0 text-[var(--text)] sm:px-4 sm:py-4">
  <header class="border-y border-[var(--line)] bg-[var(--surface)] px-4 py-4 sm:rounded-2 sm:border sm:px-5">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 class="text-2xl font-800 tracking-tight">Bountarr</h1>
        <p class="mt-1 text-sm text-[var(--muted)]">
          Search first, request fast, audit downloads without the clutter.
        </p>
      </div>

      <div class="flex flex-wrap gap-2 text-xs font-700 uppercase tracking-[0.12em]">
        <span class={`border px-2 py-1 ${data.config.radarrConfigured ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'}`}>
          Radarr {data.config.radarrConfigured ? 'ready' : 'missing'}
        </span>
        <span class={`border px-2 py-1 ${data.config.sonarrConfigured ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200' : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100'}`}>
          Sonarr {data.config.sonarrConfigured ? 'ready' : 'missing'}
        </span>
      </div>
    </div>

    {#if dashboard}
      <div class="mt-4 grid grid-cols-3 border-t border-[var(--line)] pt-4 text-sm">
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Tracked</div>
          <div class="mt-1 text-xl font-800">{dashboard.summary.total}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Verified</div>
          <div class="mt-1 text-xl font-800">{dashboard.summary.verified}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Attention</div>
          <div class="mt-1 text-xl font-800">{dashboard.summary.attention}</div>
        </div>
      </div>
    {/if}
  </header>

  <main class="mt-4 space-y-4 sm:mt-4">
    <section class="border-y border-[var(--line)] bg-[var(--surface)] px-4 py-3 sm:rounded-2 sm:border sm:px-5">
      <div class="grid grid-cols-2 gap-2">
        <button
          class={`min-h-11 border px-4 text-sm font-700 ${activeView === 'search' ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950' : 'border-[var(--line)] bg-[var(--surface-strong)] text-[var(--text)]'}`}
          type="button"
          onclick={() => (activeView = 'search')}
        >
          Search
        </button>
        <button
          class={`min-h-11 border px-4 text-sm font-700 ${activeView === 'dashboard' ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950' : 'border-[var(--line)] bg-[var(--surface-strong)] text-[var(--text)]'}`}
          type="button"
          onclick={() => (activeView = 'dashboard')}
        >
          Dashboard
        </button>
      </div>
    </section>

    {#if activeView === 'search'}
      <section class="border-y border-[var(--line)] bg-[var(--surface)] px-4 py-4 sm:rounded-2 sm:border sm:px-5">
        <div class="space-y-3">
          <input
            class="min-h-12 w-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 text-sm text-[var(--text)] outline-none"
            bind:value={query}
            placeholder="Search movies or shows"
          />
          <select
            class="min-h-12 w-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 text-sm text-[var(--text)] outline-none sm:w-56"
            bind:value={kind}
          >
            <option value="all">Movies + Shows</option>
            <option value="movie">Movies</option>
            <option value="series">Shows</option>
          </select>
        </div>

        {#if !data.config.configured}
          <div class="mt-4 border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            Configure Radarr or Sonarr in `.env` before searching.
          </div>
        {:else if searchError}
          <div class="mt-4 border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            {searchError}
          </div>
        {:else if query.trim().length < 2}
          <div class="mt-4 text-sm text-[var(--muted)]">Type at least two characters to search.</div>
        {:else if searchLoading}
          <div class="mt-4 text-sm text-[var(--muted)]">Searching...</div>
        {:else if searchResults.length === 0}
          <div class="mt-4 text-sm text-[var(--muted)]">No results found.</div>
        {:else}
          <div class="mt-4 space-y-3">
            {#each searchResults as item}
              <article class="border border-[var(--line)] bg-[var(--surface-strong)] p-3">
                <div class="flex gap-3">
                  {#if item.poster}
                    <img class="h-28 w-20 shrink-0 object-cover" src={item.poster} alt={`${item.title} poster`} />
                  {:else}
                    <div class="flex h-28 w-20 shrink-0 items-center justify-center bg-slate-200 text-[11px] uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {item.kind}
                    </div>
                  {/if}

                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h2 class="text-base font-800">{item.title}</h2>
                      {#if item.year}
                        <span class="text-sm text-[var(--muted)]">{item.year}</span>
                      {/if}
                    </div>
                    <div class="mt-1 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                      {item.kind} · {item.isExisting ? 'already tracked' : 'new request'}
                    </div>
                    <p class="mt-2 text-sm leading-5 text-[var(--muted)]">
                      {item.overview || 'No overview available.'}
                    </p>

                    <div class="mt-3">
                      <button
                        class="min-h-10 w-full border border-slate-900 bg-slate-900 px-4 text-sm font-700 text-white disabled:opacity-50 dark:border-white dark:bg-white dark:text-slate-950"
                        type="button"
                        disabled={requesting === item.id}
                        onclick={() => submitRequest(item)}
                      >
                        {requesting === item.id ? 'Sending...' : item.isExisting ? 'Open existing status' : 'Request'}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {/if}

        {#if requestError}
          <div class="mt-4 border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            {requestError}
          </div>
        {/if}
      </section>
    {:else}
      <section class="border-y border-[var(--line)] bg-[var(--surface)] px-4 py-4 sm:rounded-2 sm:border sm:px-5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-800">Recent audit</h2>
            <div class="text-sm text-[var(--muted)]">
              {dashboard?.updatedAt ? `Updated ${new Date(dashboard.updatedAt).toLocaleTimeString()}` : 'Waiting for first sync'}
            </div>
          </div>
          <button
            class="min-h-10 border border-slate-900 bg-slate-900 px-4 text-sm font-700 text-white disabled:opacity-50 dark:border-white dark:bg-white dark:text-slate-950"
            type="button"
            disabled={dashboardLoading}
            onclick={() => loadDashboard(true)}
          >
            {dashboardLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {#if dashboardError}
          <div class="mt-4 border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            {dashboardError}
          </div>
        {:else if dashboard && dashboard.items.length > 0}
          <div class="mt-4 space-y-3">
            {#each dashboard.items as item}
              <article class="border border-[var(--line)] bg-[var(--surface-strong)] p-3">
                <div class="flex gap-3">
                  {#if item.poster}
                    <img class="h-24 w-18 shrink-0 object-cover" src={item.poster} alt={`${item.title} poster`} />
                  {:else}
                    <div class="flex h-24 w-18 shrink-0 items-center justify-center bg-slate-200 text-[11px] uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {item.kind}
                    </div>
                  {/if}

                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <div class="min-w-0">
                        <div class="text-base font-800">{item.title}</div>
                        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                          {item.kind} · {item.status}{item.detail ? ` · ${item.detail}` : ''}
                        </div>
                      </div>
                      <span class={`border px-2 py-1 text-[11px] font-700 uppercase tracking-[0.08em] ${statusTone[item.auditStatus]}`}>
                        {auditLabel(item.auditStatus)}
                      </span>
                    </div>

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
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <div class="mt-4 text-sm text-[var(--muted)]">No recent queue or history items to show.</div>
        {/if}
      </section>
    {/if}

    <section class="border-y border-[var(--line)] bg-[var(--surface)] px-4 py-4 sm:rounded-2 sm:border sm:px-5">
      <button
        class="flex w-full items-center justify-between text-left text-sm font-700"
        type="button"
        onclick={() => (settingsOpen = !settingsOpen)}
      >
        <span>Preferences</span>
        <span class="text-[var(--muted)]">{settingsOpen ? 'Hide' : 'Show'}</span>
      </button>

      {#if settingsOpen}
        <div class="mt-4 space-y-4 border-t border-[var(--line)] pt-4">
          <label class="block">
            <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Preferred audio</div>
            <input
              class="min-h-12 w-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 text-sm outline-none"
              bind:value={preferences.preferredLanguage}
              placeholder="English"
            />
          </label>

          <label class="block">
            <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Theme</div>
            <select
              class="min-h-12 w-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 text-sm outline-none"
              bind:value={preferences.theme}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>

          <label class="flex items-center justify-between gap-3 border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-3">
            <div>
              <div class="text-sm font-700">Require subtitles</div>
              <div class="mt-1 text-sm text-[var(--muted)]">Fail audit when subtitles are missing.</div>
            </div>
            <input bind:checked={preferences.requireSubtitles} class="h-5 w-5" type="checkbox" />
          </label>

          <div class="space-y-3 border-t border-[var(--line)] pt-4">
            <button
              class="min-h-10 w-full border border-[var(--line)] bg-[var(--surface-strong)] px-4 text-sm font-700"
              type="button"
              onclick={enableNotifications}
            >
              Enable browser notifications
            </button>
            {#if notificationState !== 'idle'}
              <div class="text-sm text-[var(--muted)]">
                {notificationState === 'unsupported'
                  ? 'This browser does not support notifications.'
                  : `Notification permission: ${notificationState}`}
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </section>
  </main>
</div>
