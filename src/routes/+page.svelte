<script lang="ts">
  import { onMount } from 'svelte';
  import {
    applyTheme,
    loadPreferences,
    loadSearchState,
    savePreferences,
    saveSearchState
  } from '$lib/client/storage';
  import {
    ensureNotificationPermission,
    notifyAuditFailures,
    pushNotification
  } from '$lib/client/notifications';
  import { defaultPreferences } from '$lib/shared/preferences';
  import type {
    AcquisitionJob,
    AppView,
    ConfigStatus,
    DashboardResponse,
    MediaItem,
    Preferences,
    QualityProfileOption,
    QueueResponse,
    RequestResponse,
    SearchKind
  } from '$lib/shared/types';

  const { data } = $props<{ data: { config: ConfigStatus; recentPlex: MediaItem[] } }>();

  let preferences = $state<Preferences>(defaultPreferences);
  let initialized = false;
  let activeView = $state<AppView>('search');
  let query = $state('');
  let kind = $state<SearchKind>('all');
  let includeAvailable = $state(true);
  let searchResults = $state<MediaItem[]>([]);
  let recentPlexOverride = $state<MediaItem[] | null>(null);
  let recentPlexItems = $derived(recentPlexOverride ?? data.recentPlex);
  let dashboard = $state<DashboardResponse | null>(null);
  let queue = $state<QueueResponse | null>(null);
  let searchError = $state<string | null>(null);
  let recentPlexError = $state<string | null>(null);
  let dashboardError = $state<string | null>(null);
  let queueError = $state<string | null>(null);
  let requestError = $state<string | null>(null);
  let latestActionMessage = $state<string | null>(null);
  let requestFeedback = $state<Record<string, string>>({});
  let searchLoading = $state(false);
  let recentPlexLoading = $state(false);
  let dashboardLoading = $state(false);
  let queueLoading = $state(false);
  let requesting = $state<string | null>(null);
  let notificationState = $state<NotificationPermission | 'unsupported' | 'idle'>('idle');
  let viewMenuOpen = $state(false);
  let kindMenuOpen = $state(false);
  let confirmAddItem = $state<MediaItem | null>(null);
  let confirmQualityProfileId = $state<number | null>(null);
  const viewOptions: Array<{ value: AppView; label: string }> = [
    { value: 'search', label: 'Search' },
    { value: 'queue', label: 'Queue' },
    { value: 'dashboard', label: 'Audit queue' },
    { value: 'status', label: 'Arr / Plex status' },
    { value: 'settings', label: 'Settings' }
  ];

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

  function actionLabel(item: MediaItem) {
    if (requesting === item.id) {
      return 'Adding...';
    }

    if (item.canAdd) {
      return 'Add to Arr';
    }

    if (item.inArr) {
      return 'Already in Arr';
    }

    if (item.inPlex) {
      return 'Only in Plex';
    }

    return 'Unavailable';
  }

  function actionDisabled(item: MediaItem) {
    return requesting === item.id || !item.canAdd;
  }

  function resultState(item: MediaItem) {
    if (item.inArr && item.inPlex) {
      return 'In Arr + Plex';
    }

    if (item.inArr) {
      return 'In Arr';
    }

    if (item.inPlex) {
      return 'In Plex only';
    }

    return 'Addable';
  }

  function resultSummary(item: MediaItem) {
    const source =
      item.kind === 'movie'
        ? item.sourceService === 'radarr'
          ? 'Radarr'
          : 'Plex'
        : item.sourceService === 'sonarr'
          ? 'Sonarr'
          : 'Plex';

    return `${item.kind} · ${resultState(item)} · ${source}`;
  }

  function currentViewLabel() {
    switch (activeView) {
      case 'queue':
        return 'Queue';
      case 'dashboard':
        return 'Audit queue';
      case 'status':
        return 'Service status';
      case 'settings':
        return 'Settings';
      default:
        return 'Search';
    }
  }

  function currentKindLabel() {
    switch (kind) {
      case 'movie':
        return 'Movies';
      case 'series':
        return 'Shows';
      default:
        return 'All';
    }
  }

  function qualityProfileOptions(item: MediaItem | null): QualityProfileOption[] {
    if (!item) {
      return [];
    }

    return item.kind === 'movie'
      ? data.config.radarrQualityProfiles
      : data.config.sonarrQualityProfiles;
  }

  function defaultQualityProfileId(item: MediaItem | null): number | null {
    if (!item) {
      return null;
    }

    return item.kind === 'movie'
      ? data.config.defaultRadarrQualityProfileId
      : data.config.defaultSonarrQualityProfileId;
  }

  function openAddConfirm(item: MediaItem) {
    if (!item.canAdd) {
      return;
    }

    confirmAddItem = item;
    confirmQualityProfileId = defaultQualityProfileId(item);
    requestError = null;
    kindMenuOpen = false;
    viewMenuOpen = false;
  }

  function closeAddConfirm() {
    if (confirmAddItem && requesting === confirmAddItem.id) {
      return;
    }

    confirmAddItem = null;
    confirmQualityProfileId = null;
  }

  function acquisitionStatusLabel(status: AcquisitionJob['status']) {
    switch (status) {
      case 'import-check':
        return 'Import check';
      default:
        return status
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (char) => char.toUpperCase());
    }
  }

  function closeMenu() {
    viewMenuOpen = false;
  }

  function setActiveView(view: AppView) {
    activeView = view;
    closeMenu();
  }

  function isActiveView(view: AppView) {
    return activeView === view;
  }

  function mergeSearchItem(existing: MediaItem, next: MediaItem): MediaItem {
    return {
      ...existing,
      ...next,
      inPlex: existing.inPlex || next.inPlex,
      plexLibraries: Array.from(new Set([...(existing.plexLibraries ?? []), ...(next.plexLibraries ?? [])])),
      canAdd: !(existing.inPlex || next.inPlex) && next.canAdd,
      origin: existing.inPlex || next.inPlex ? 'merged' : next.origin
    };
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

  async function loadRecentPlex() {
    if (!data.config.plexConfigured) {
      recentPlexItems = [];
      recentPlexError = null;
      return;
    }

    recentPlexLoading = true;
    recentPlexError = null;

    try {
      const response = await fetch('/api/plex/recent');
      if (!response.ok) {
        throw new Error(await response.text());
      }

      recentPlexOverride = (await response.json()) as MediaItem[];
    } catch (error) {
      recentPlexError = error instanceof Error ? error.message : 'Unable to load Plex recent items.';
    } finally {
      recentPlexLoading = false;
    }
  }

  async function loadSearch(searchTerm: string, searchKind: SearchKind, shouldIncludeAvailable: boolean) {
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
        kind: searchKind,
        includeAvailable: String(shouldIncludeAvailable)
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

  async function runSearchNow() {
    await loadSearch(query, kind, includeAvailable);
  }

  async function loadQueue() {
    if (!data.config.configured) {
      queue = null;
      queueError = null;
      return;
    }

    queueLoading = true;
    queueError = null;

    try {
      const response = await fetch('/api/queue');
      if (!response.ok) {
        throw new Error(await response.text());
      }

      queue = (await response.json()) as QueueResponse;
    } catch (error) {
      queueError = error instanceof Error ? error.message : 'Unable to load the queue.';
    } finally {
      queueLoading = false;
    }
  }

  async function submitRequest(item: MediaItem, qualityProfileId?: number | null) {
    if (!item.canAdd) {
      return;
    }

    requesting = item.id;
    requestError = null;
    latestActionMessage = null;

    try {
      const response = await fetch('/api/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          item,
          qualityProfileId: qualityProfileId ?? undefined,
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
      const feedback =
        result.job
          ? `${acquisitionStatusLabel(result.job.status)} · attempt ${result.job.attempt}/${result.job.maxRetries}${result.job.validationSummary ? ` · ${result.job.validationSummary}` : ''}`
          : result.releaseDecision?.reason ?? result.message;

      latestActionMessage = result.message;
      requestFeedback = {
        ...requestFeedback,
        [item.id]: feedback
      };
      pushNotification('Bountarr', result.message);
      searchResults = searchResults.map((candidate) =>
        candidate.id === item.id ? mergeSearchItem(candidate, result.item) : candidate
      );
      closeAddConfirm();
      activeView = 'queue';
      await Promise.all([loadDashboard(true), loadQueue()]);
    } catch (error) {
      requestError = error instanceof Error ? error.message : 'Add failed.';
      pushNotification('Bountarr add failed', requestError);
    } finally {
      requesting = null;
    }
  }

  async function enableNotifications() {
    notificationState = await ensureNotificationPermission();
  }

  onMount(() => {
    const searchState = loadSearchState();
    preferences = loadPreferences();
    activeView = searchState.activeView;
    query = searchState.query;
    kind = searchState.kind;
    includeAvailable = searchState.includeAvailable;
    applyTheme(preferences.theme);
    initialized = true;
    if (data.config.plexConfigured && data.recentPlex.length === 0) {
      void loadRecentPlex();
    }
    void loadDashboard();
    void loadQueue();

    const dashboardInterval = window.setInterval(() => {
      void loadDashboard();
    }, 5 * 60_000);
    const queueInterval = window.setInterval(() => {
      void loadQueue();
    }, 15_000);

    return () => {
      window.clearInterval(dashboardInterval);
      window.clearInterval(queueInterval);
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

    saveSearchState({
      activeView,
      query,
      kind,
      includeAvailable
    });
  });

  $effect(() => {
    if (!initialized) {
      return;
    }

    const currentQuery = query;
    const currentKind = kind;
    const currentIncludeAvailable = includeAvailable;

    const handle = window.setTimeout(() => {
      void loadSearch(currentQuery, currentKind, currentIncludeAvailable);
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
    content="Search, add, and audit media from Radarr and Sonarr with a mobile-friendly interface."
  />
</svelte:head>

<div class="mx-auto min-h-screen max-w-5xl px-0 py-0 text-[var(--text)]">
  <main class="space-y-0">
    {#if activeView === 'search'}
      {#if data.config.plexConfigured}
        <section class="border-y border-[var(--line)] bg-[var(--surface)] px-3 py-2 sm:px-4">
          <div class="flex items-center justify-between gap-3">
            <div class="text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">
              Recently added from Plex
            </div>
            <div class="relative shrink-0">
              <button
                class="flex h-10 w-10 items-center justify-center border border-[var(--line)] bg-[var(--surface)]"
                type="button"
                aria-label={`Open ${currentViewLabel()} menu`}
                onclick={() => (viewMenuOpen = !viewMenuOpen)}
              >
                <span class="flex flex-col gap-1">
                  <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
                  <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
                  <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
                </span>
              </button>
              {#if viewMenuOpen}
                <div class="absolute right-0 top-full z-10 mt-2 w-56 border border-[var(--line)] bg-[var(--surface)] p-2 shadow-lg">
                  {#each viewOptions as option, index}
                    <button
                      class={`${index > 0 ? 'mt-1 ' : ''}block min-h-10 w-full px-3 text-left text-sm ${isActiveView(option.value) ? 'bg-[var(--surface-strong)] font-700' : ''}`}
                      type="button"
                      onclick={() => setActiveView(option.value)}
                    >
                      {option.label}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>

          {#if recentPlexError}
            <div class="mt-2 border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
              {recentPlexError}
            </div>
          {:else if recentPlexItems.length > 0}
            <div class="no-scrollbar mt-2 flex gap-3 overflow-x-auto pb-1">
              {#each recentPlexItems as item}
                <article class="min-w-72 border border-[var(--line)] bg-[var(--surface-strong)] p-3">
                  <div class="flex items-center gap-3">
                    {#if item.poster}
                      <img class="h-20 w-14 shrink-0 object-cover" src={item.poster} alt={`${item.title} poster`} />
                    {:else}
                      <div class="flex h-20 w-14 shrink-0 items-center justify-center bg-slate-200 text-[10px] uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {item.kind}
                      </div>
                    {/if}
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-base font-800">{item.title}</div>
                      <div class="mt-1 truncate text-[11px] uppercase tracking-[0.1em] text-[var(--muted)]">
                        {item.kind}{item.detail ? ` · ${item.detail}` : ''}
                      </div>
                      <div class="mt-2 truncate text-sm text-[var(--muted)]">
                        {item.plexLibraries.join(', ')}
                      </div>
                    </div>
                  </div>
                </article>
              {/each}
            </div>
          {:else}
            <div class="mt-2 text-sm text-[var(--muted)]">No recent Plex items found.</div>
          {/if}
        </section>
      {/if}

      <section class="border-b border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
        <form class="space-y-2" onsubmit={(event) => {
          event.preventDefault();
          void runSearchNow();
        }}>
          <div class="relative flex items-stretch gap-2">
            <input
              class="min-h-12 min-w-0 flex-1 border border-[var(--line)] bg-[var(--surface-strong)] px-4 pr-4 text-sm text-[var(--text)] outline-none"
              bind:value={query}
              placeholder="Search movies or shows"
            />
            {#if query.trim().length > 0}
              <button
                class="absolute right-14 top-1/2 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center border border-[var(--line)] bg-[var(--surface)] text-xs font-700"
                type="button"
                aria-label="Clear search"
                onclick={() => {
                  query = '';
                  searchResults = [];
                  searchError = null;
                }}
              >
                X
              </button>
            {/if}
            <div class="relative shrink-0">
              <button
                class="min-h-12 border border-[var(--line)] bg-[var(--surface-strong)] px-3 text-xs font-700 uppercase tracking-[0.08em]"
                type="button"
                onclick={() => (kindMenuOpen = !kindMenuOpen)}
              >
                {currentKindLabel()}
              </button>
              {#if kindMenuOpen}
                <div class="absolute right-0 top-full z-10 mt-2 w-44 border border-[var(--line)] bg-[var(--surface)] p-2 shadow-lg">
                  <button
                    class={`block min-h-9 w-full px-3 text-left text-sm ${kind === 'all' ? 'bg-[var(--surface-strong)] font-700' : ''}`}
                    type="button"
                    onclick={() => {
                      kind = 'all';
                      kindMenuOpen = false;
                    }}
                  >
                    All
                  </button>
                  <button
                    class={`mt-1 block min-h-9 w-full px-3 text-left text-sm ${kind === 'movie' ? 'bg-[var(--surface-strong)] font-700' : ''}`}
                    type="button"
                    onclick={() => {
                      kind = 'movie';
                      kindMenuOpen = false;
                    }}
                  >
                    Movies
                  </button>
                  <button
                    class={`mt-1 block min-h-9 w-full px-3 text-left text-sm ${kind === 'series' ? 'bg-[var(--surface-strong)] font-700' : ''}`}
                    type="button"
                    onclick={() => {
                      kind = 'series';
                      kindMenuOpen = false;
                    }}
                  >
                    Shows
                  </button>
                  <label class="mt-2 flex items-center gap-2 border-t border-[var(--line)] pt-2 text-sm">
                    <input
                      bind:checked={includeAvailable}
                      class="h-4 w-4"
                      type="checkbox"
                    />
                    <span>Include available</span>
                  </label>
                </div>
              {/if}
            </div>
          </div>
          <div>
            <button
              class="min-h-12 w-full border border-slate-900 bg-slate-900 px-4 text-sm font-700 text-white dark:border-white dark:bg-white dark:text-slate-950"
              type="submit"
            >
              Search
            </button>
          </div>
        </form>

        {#if latestActionMessage}
          <div class="mt-2 border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
            {latestActionMessage}
          </div>
        {/if}
      </section>
      <section class="border-b border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
        <div class="text-[11px] font-700 uppercase tracking-[0.12em] text-[var(--muted)]">Search results</div>

        {#if !data.config.configured}
          <div class="mt-3 border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            Configure Radarr or Sonarr in `.env` before searching.
          </div>
        {:else if searchError}
          <div class="mt-3 border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            {searchError}
          </div>
        {:else if query.trim().length < 2}
          <div class="mt-3 text-sm text-[var(--muted)]">Type at least two characters to search.</div>
        {:else if searchLoading}
          <div class="mt-3 text-sm text-[var(--muted)]">Searching Arr{data.config.plexConfigured ? ' and Plex' : ''}...</div>
        {:else if searchResults.length === 0}
          <div class="mt-3 text-sm text-[var(--muted)]">No results found.</div>
        {:else}
          <div class="mt-3 space-y-2">
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
                      {resultSummary(item)}
                    </div>

                    <div class="mt-2 flex flex-wrap gap-2 text-[11px] font-700 uppercase tracking-[0.08em]">
                      {#if item.inArr}
                        <span class="border border-emerald-300 bg-emerald-50 px-2 py-1 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
                          In Arr
                        </span>
                      {/if}
                      {#if item.inPlex}
                        <span class="border border-sky-300 bg-sky-50 px-2 py-1 text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
                          In Plex
                        </span>
                      {/if}
                    </div>

                    <p class="mt-3 text-sm leading-5 text-[var(--muted)]">
                      {item.overview || 'No overview available.'}
                    </p>

                    {#if item.inArr}
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
                    {/if}

                    {#if item.plexLibraries.length > 0}
                      <div class="mt-3 text-sm">
                        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Plex libraries</div>
                        <div>{item.plexLibraries.join(', ')}</div>
                      </div>
                    {/if}
                  </div>
                </div>

                {#if requestFeedback[item.id]}
                  <div class="mt-3 border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
                    {requestFeedback[item.id]}
                  </div>
                {/if}

                {#if item.canAdd}
                  <div class="mt-3">
                    <button
                      class="min-h-11 w-full border border-slate-900 bg-slate-900 px-4 text-sm font-700 text-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white dark:bg-white dark:text-slate-950"
                      type="button"
                      disabled={actionDisabled(item)}
                      onclick={() => openAddConfirm(item)}
                    >
                      {actionLabel(item)}
                    </button>
                  </div>
                {:else if item.inPlex}
                  <div class="mt-3 border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
                    Found in Plex. Add is hidden for Plex matches.
                  </div>
                {:else}
                  <div class="mt-3 border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
                    Already tracked in Arr.
                  </div>
                {/if}
              </article>
            {/each}
          </div>
        {/if}

        {#if requestError}
          <div class="mt-3 border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            {requestError}
          </div>
        {/if}
      </section>
    {:else if activeView === 'queue'}
      <section class="border-y border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-800">Active queue</h2>
            <div class="text-sm text-[var(--muted)]">
              {queue?.updatedAt ? `Updated ${new Date(queue.updatedAt).toLocaleTimeString()}` : 'Waiting for first sync'}
            </div>
          </div>
          <div class="relative shrink-0">
            <button
              class="flex h-10 w-10 items-center justify-center border border-[var(--line)] bg-[var(--surface)]"
              type="button"
              aria-label={`Open ${currentViewLabel()} menu`}
              onclick={() => (viewMenuOpen = !viewMenuOpen)}
            >
              <span class="flex flex-col gap-1">
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
              </span>
            </button>
            {#if viewMenuOpen}
              <div class="absolute right-0 top-full z-10 mt-2 w-56 border border-[var(--line)] bg-[var(--surface)] p-2 shadow-lg">
                {#each viewOptions as option, index}
                  <button
                    class={`${index > 0 ? 'mt-1 ' : ''}block min-h-10 w-full px-3 text-left text-sm ${isActiveView(option.value) ? 'bg-[var(--surface-strong)] font-700' : ''}`}
                    type="button"
                    onclick={() => setActiveView(option.value)}
                  >
                    {option.label}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        {#if queueError}
          <div class="mt-4 border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            {queueError}
          </div>
        {:else if queueLoading && !queue}
          <div class="mt-4 text-sm text-[var(--muted)]">Loading active downloads...</div>
        {:else if queue && (queue.acquisitionJobs.length > 0 || queue.items.length > 0)}
          <div class="mt-4 space-y-3">
            {#each queue.acquisitionJobs as job}
              <article class="border border-[var(--line)] bg-[var(--surface-strong)] p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-base font-800">{job.title}</div>
                    <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                      {job.sourceService} · {acquisitionStatusLabel(job.status)} · attempt {Math.min(job.attempt, job.maxRetries)}/{job.maxRetries}
                    </div>
                  </div>
                  {#if job.progress !== null}
                    <div class="text-sm font-700">{Math.round(job.progress)}%</div>
                  {/if}
                </div>

                <div class="mt-3 h-2 overflow-hidden bg-[var(--line)]">
                  <div
                    class="h-full bg-slate-900 dark:bg-white"
                    style={`width: ${job.progress ?? 0}%`}
                  ></div>
                </div>

                <div class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Release</div>
                    <div>{job.currentRelease ?? 'Waiting for selection'}</div>
                  </div>
                  <div>
                    <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Queue status</div>
                    <div>{job.queueStatus ?? 'Waiting'}</div>
                  </div>
                  <div>
                    <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Validation</div>
                    <div>{job.validationSummary ?? 'Waiting for import'}</div>
                  </div>
                  <div>
                    <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Preferred releaser</div>
                    <div>{job.preferredReleaser ?? job.selectedReleaser ?? 'Not set'}</div>
                  </div>
                </div>

                {#if job.failureReason}
                  <div class="mt-3 border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted)]">
                    {job.failureReason}
                  </div>
                {/if}
              </article>
            {/each}

            {#each queue.items as item}
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
                          {item.sourceService} · {item.status}{item.detail ? ` · ${item.detail}` : ''}
                        </div>
                      </div>
                      {#if item.progress !== null}
                        <div class="text-sm font-700">{Math.round(item.progress)}%</div>
                      {/if}
                    </div>

                    <div class="mt-3 h-2 overflow-hidden bg-[var(--line)]">
                      <div
                        class="h-full bg-slate-900 dark:bg-white"
                        style={`width: ${item.progress ?? 0}%`}
                      ></div>
                    </div>

                    <div class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Time left</div>
                        <div>{item.timeLeft ?? 'Unknown'}</div>
                      </div>
                      <div>
                        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">ETA</div>
                        <div>{item.estimatedCompletionTime ? new Date(item.estimatedCompletionTime).toLocaleString() : 'Unknown'}</div>
                      </div>
                      <div>
                        <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Downloaded</div>
                        <div>
                          {item.size !== null && item.sizeLeft !== null
                            ? `${Math.max(0, ((item.size - item.sizeLeft) / 1024 / 1024 / 1024)).toFixed(2)} GB / ${(item.size / 1024 / 1024 / 1024).toFixed(2)} GB`
                            : 'Unknown'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <div class="mt-4 text-sm text-[var(--muted)]">No active Radarr or Sonarr downloads.</div>
        {/if}
      </section>
    {:else if activeView === 'dashboard'}
      <section class="border-y border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-800">Recent audit</h2>
            <div class="text-sm text-[var(--muted)]">
              {dashboard?.updatedAt ? `Updated ${new Date(dashboard.updatedAt).toLocaleTimeString()}` : 'Waiting for first sync'}
            </div>
          </div>
          <div class="relative shrink-0">
            <button
              class="flex h-10 w-10 items-center justify-center border border-[var(--line)] bg-[var(--surface)]"
              type="button"
              aria-label={`Open ${currentViewLabel()} menu`}
              onclick={() => (viewMenuOpen = !viewMenuOpen)}
            >
              <span class="flex flex-col gap-1">
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
              </span>
            </button>
            {#if viewMenuOpen}
              <div class="absolute right-0 top-full z-10 mt-2 w-56 border border-[var(--line)] bg-[var(--surface)] p-2 shadow-lg">
                {#each viewOptions as option, index}
                  <button
                    class={`${index > 0 ? 'mt-1 ' : ''}block min-h-10 w-full px-3 text-left text-sm ${isActiveView(option.value) ? 'bg-[var(--surface-strong)] font-700' : ''}`}
                    type="button"
                    onclick={() => setActiveView(option.value)}
                  >
                    {option.label}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
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
    {:else if activeView === 'status'}
      <section class="border-y border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-800">Service status</h2>
            <div class="text-sm text-[var(--muted)]">Quick health snapshot for Arr and Plex connectivity.</div>
          </div>
          <div class="relative shrink-0">
            <button
              class="flex h-10 w-10 items-center justify-center border border-[var(--line)] bg-[var(--surface)]"
              type="button"
              aria-label={`Open ${currentViewLabel()} menu`}
              onclick={() => (viewMenuOpen = !viewMenuOpen)}
            >
              <span class="flex flex-col gap-1">
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
              </span>
            </button>
            {#if viewMenuOpen}
              <div class="absolute right-0 top-full z-10 mt-2 w-56 border border-[var(--line)] bg-[var(--surface)] p-2 shadow-lg">
                {#each viewOptions as option, index}
                  <button
                    class={`${index > 0 ? 'mt-1 ' : ''}block min-h-10 w-full px-3 text-left text-sm ${isActiveView(option.value) ? 'bg-[var(--surface-strong)] font-700' : ''}`}
                    type="button"
                    onclick={() => setActiveView(option.value)}
                  >
                    {option.label}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          <article class="border border-[var(--line)] bg-[var(--surface-strong)] p-3">
            <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Radarr</div>
            <div class="mt-2 text-lg font-800">{data.config.radarrConfigured ? 'Ready' : 'Missing'}</div>
            <div class="mt-1 text-sm text-[var(--muted)]">
              {data.config.radarrConfigured ? 'Movie lookup and add flow enabled.' : 'Set Radarr env vars to enable movie requests.'}
            </div>
          </article>
          <article class="border border-[var(--line)] bg-[var(--surface-strong)] p-3">
            <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Sonarr</div>
            <div class="mt-2 text-lg font-800">{data.config.sonarrConfigured ? 'Ready' : 'Missing'}</div>
            <div class="mt-1 text-sm text-[var(--muted)]">
              {data.config.sonarrConfigured ? 'Series lookup and audit flow enabled.' : 'Set Sonarr env vars to enable show requests.'}
            </div>
          </article>
          <article class="border border-[var(--line)] bg-[var(--surface-strong)] p-3">
            <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Plex</div>
            <div class="mt-2 text-lg font-800">{data.config.plexConfigured ? 'Ready' : 'Off'}</div>
            <div class="mt-1 text-sm text-[var(--muted)]">
              {data.config.plexConfigured
                ? `${recentPlexItems.length} recent mixed items available across Plex libraries.`
                : 'Set Plex env vars to enable library-aware Plex matching.'}
            </div>
          </article>
        </div>
      </section>
    {:else}
      <section class="border-y border-[var(--line)] bg-[var(--surface)] px-3 py-3 sm:px-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-800">Settings</h2>
            <div class="mt-1 text-sm text-[var(--muted)]">Local-only preferences for theme, language, subtitles, and notifications.</div>
          </div>
          <div class="relative shrink-0">
            <button
              class="flex h-10 w-10 items-center justify-center border border-[var(--line)] bg-[var(--surface)]"
              type="button"
              aria-label={`Open ${currentViewLabel()} menu`}
              onclick={() => (viewMenuOpen = !viewMenuOpen)}
            >
              <span class="flex flex-col gap-1">
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
                <span class="block h-[2px] w-4 bg-[var(--text)]"></span>
              </span>
            </button>
            {#if viewMenuOpen}
              <div class="absolute right-0 top-full z-10 mt-2 w-56 border border-[var(--line)] bg-[var(--surface)] p-2 shadow-lg">
                {#each viewOptions as option, index}
                  <button
                    class={`${index > 0 ? 'mt-1 ' : ''}block min-h-10 w-full px-3 text-left text-sm ${isActiveView(option.value) ? 'bg-[var(--surface-strong)] font-700' : ''}`}
                    type="button"
                    onclick={() => setActiveView(option.value)}
                  >
                    {option.label}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

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
              <div class="mt-1 text-sm text-[var(--muted)]">Prefer releases with subtitle signals and fail audit when none are present.</div>
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
      </section>
    {/if}
  </main>
</div>

{#if confirmAddItem}
  <button
    class="fixed inset-0 z-40 bg-black/45"
    type="button"
    aria-label="Close add confirmation"
    onclick={closeAddConfirm}
  ></button>
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
    <section class="w-full max-w-sm border border-[var(--line)] bg-[var(--surface)] p-4 shadow-xl">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-lg font-800">Add to Arr</div>
          <div class="mt-1 text-sm text-[var(--muted)]">
            {confirmAddItem.title}{confirmAddItem.year ? ` (${confirmAddItem.year})` : ''}
          </div>
        </div>
        <button
          class="flex h-8 w-8 items-center justify-center border border-[var(--line)] bg-[var(--surface-strong)] text-sm font-700"
          type="button"
          aria-label="Close add confirmation"
          onclick={closeAddConfirm}
        >
          X
        </button>
      </div>

      <div class="mt-4">
        <label class="block">
          <div class="mb-2 text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
            Quality profile
          </div>
          <select
            class="min-h-11 w-full border border-[var(--line)] bg-[var(--surface-strong)] px-3 text-sm outline-none"
            bind:value={confirmQualityProfileId}
          >
            {#each qualityProfileOptions(confirmAddItem) as profile}
              <option value={profile.id}>
                {profile.name}{profile.isDefault ? ' (default)' : ''}
              </option>
            {/each}
          </select>
        </label>
        <div class="mt-2 text-xs text-[var(--muted)]">
          The env-configured profile is used as the default, but you can override it for this add.
        </div>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-2">
        <button
          class="min-h-11 border border-[var(--line)] bg-[var(--surface-strong)] px-4 text-sm font-700"
          type="button"
          onclick={closeAddConfirm}
          disabled={requesting === confirmAddItem.id}
        >
          Cancel
        </button>
        <button
          class="min-h-11 border border-slate-900 bg-slate-900 px-4 text-sm font-700 text-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white dark:bg-white dark:text-slate-950"
          type="button"
          onclick={() => {
            if (confirmAddItem) {
              void submitRequest(confirmAddItem, confirmQualityProfileId);
            }
          }}
          disabled={requesting === confirmAddItem.id}
        >
          {requesting === confirmAddItem.id ? 'Adding...' : 'Confirm'}
        </button>
      </div>
    </section>
  </div>
{/if}
