<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import { formatBytes } from '$lib/client/app-ui';

let { state }: { state: AppState } = $props();

const checkedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function storageUsageLabel(totalBytes: number | null, freeBytes: number | null): string {
  if (
    totalBytes === null ||
    freeBytes === null ||
    !Number.isFinite(totalBytes) ||
    !Number.isFinite(freeBytes) ||
    totalBytes <= 0
  ) {
    return 'Unknown';
  }

  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const usedPercent = Math.round((usedBytes / totalBytes) * 100);
  return `${usedPercent}% used`;
}

function uptimeLabel(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${Math.max(0, minutes)}m`;
}
</script>

<section class="panel-shell relative px-3 py-3 sm:px-4">
  <div>
    <h2 class="text-lg font-800">System status</h2>
    <div class="text-sm text-[var(--muted)]">Operator view for service health, runtime state, and local storage details.</div>
  </div>

  <div class="mt-4 grid gap-3 sm:grid-cols-4">
    <article class="card-shell p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Radarr</div>
      <div class="mt-2 text-lg font-800">{state.config.radarrConfigured ? 'Ready' : 'Missing'}</div>
      <div class="mt-2 space-y-1 text-sm text-[var(--muted)]">
        <div>{state.config.radarrStats.qualityProfileCount} profiles</div>
        <div>{state.config.radarrStats.rootFolderCount} root folders</div>
        <div>{state.config.radarrStats.queueCount ?? 'Unknown'} queued</div>
      </div>
    </article>
    <article class="card-shell p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Sonarr</div>
      <div class="mt-2 text-lg font-800">{state.config.sonarrConfigured ? 'Ready' : 'Missing'}</div>
      <div class="mt-2 space-y-1 text-sm text-[var(--muted)]">
        <div>{state.config.sonarrStats.qualityProfileCount} profiles</div>
        <div>{state.config.sonarrStats.rootFolderCount} root folders</div>
        <div>{state.config.sonarrStats.queueCount ?? 'Unknown'} queued</div>
      </div>
    </article>
    <article class="card-shell p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Plex</div>
      <div class="mt-2 text-lg font-800">{state.config.plexConfigured ? 'Ready' : 'Off'}</div>
      <div class="mt-2 space-y-1 text-sm text-[var(--muted)]">
        <div>{state.config.plexStats.libraryCount} libraries</div>
        <div>{state.config.plexStats.movieLibraryCount} movie / {state.config.plexStats.showLibraryCount} show</div>
        <div>{state.recentPlexItems.length} recent mixed items</div>
      </div>
    </article>
    <article class="card-shell p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Server</div>
      <div class="mt-2 text-lg font-800">{state.config.runtime.healthy ? 'Healthy' : 'Needs attention'}</div>
      <div class="mt-2 space-y-1 text-sm text-[var(--muted)]">
        <div>Uptime {uptimeLabel(state.config.runtime.uptimeSeconds)}</div>
        <div>{state.config.runtime.platform} / {state.config.runtime.arch}</div>
        <div>{formatBytes(state.config.runtime.freeSpaceBytes ?? 0)} free disk</div>
      </div>
    </article>
  </div>

  <div class="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
    <article class="card-shell p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Server</div>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Host</div>
          <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{state.config.runtime.hostName}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Node</div>
          <div class="mt-1 text-base font-700">{state.config.runtime.nodeVersion}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Uptime</div>
          <div class="mt-1 text-base font-700">{uptimeLabel(state.config.runtime.uptimeSeconds)}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">PID</div>
          <div class="mt-1 text-base font-700">{state.config.runtime.processId}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Free space</div>
          <div class="mt-1 text-base font-700">{formatBytes(state.config.runtime.freeSpaceBytes ?? 0)}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Total space</div>
          <div class="mt-1 text-base font-700">{formatBytes(state.config.runtime.totalSpaceBytes ?? 0)}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Storage path</div>
          <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{state.config.runtime.storagePath}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Checked</div>
          <div class="mt-1 text-sm text-[var(--muted)]">
            {checkedAtFormatter.format(new Date(state.config.runtime.checkedAt))}
          </div>
          <div class="mt-1 text-sm text-[var(--muted)]">
            {storageUsageLabel(
              state.config.runtime.totalSpaceBytes,
              state.config.runtime.freeSpaceBytes,
            )}
          </div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">RSS memory</div>
          <div class="mt-1 text-sm text-[var(--muted)]">{formatBytes(state.config.runtime.rssBytes)}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Heap used</div>
          <div class="mt-1 text-sm text-[var(--muted)]">
            {formatBytes(state.config.runtime.heapUsedBytes)} / {formatBytes(state.config.runtime.heapTotalBytes)}
          </div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">System memory</div>
          <div class="mt-1 text-sm text-[var(--muted)]">
            {formatBytes(state.config.runtime.systemFreeMemoryBytes)} free / {formatBytes(state.config.runtime.systemTotalMemoryBytes)}
          </div>
        </div>
      </div>
    </article>
    <article class="card-shell p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Database</div>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">DB size</div>
          <div class="mt-1 text-base font-700">{formatBytes(state.config.runtime.databaseSizeBytes ?? 0)}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Checked</div>
          <div class="mt-1 text-sm text-[var(--muted)]">
            {checkedAtFormatter.format(new Date(state.config.runtime.checkedAt))}
          </div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Jobs</div>
          <div class="mt-1 text-sm text-[var(--muted)]">{state.config.runtime.databaseJobCount ?? 'Unknown'}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Attempts / events</div>
          <div class="mt-1 text-sm text-[var(--muted)]">
            {state.config.runtime.databaseAttemptCount ?? 'Unknown'} / {state.config.runtime.databaseEventCount ?? 'Unknown'}
          </div>
        </div>
        <div class="sm:col-span-2">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">DB path</div>
          <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{state.config.runtime.databasePath}</div>
        </div>
      </div>
    </article>
    <article class="card-shell p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Radarr</div>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Profiles</div>
          <div class="mt-1 text-base font-700">{state.config.radarrStats.qualityProfileCount}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Queued</div>
          <div class="mt-1 text-base font-700">{state.config.radarrStats.queueCount ?? 'Unknown'}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Root folders</div>
          <div class="mt-1 text-sm text-[var(--muted)]">{state.config.radarrStats.rootFolderCount}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Default profile</div>
          <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{state.config.radarrStats.defaultQualityProfileName ?? 'Unknown'}</div>
        </div>
        <div class="sm:col-span-2">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Primary root</div>
          <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{state.config.radarrStats.primaryRootFolderPath ?? 'Unknown'}</div>
        </div>
      </div>
    </article>
    <article class="card-shell p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Sonarr</div>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Profiles</div>
          <div class="mt-1 text-base font-700">{state.config.sonarrStats.qualityProfileCount}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Queued</div>
          <div class="mt-1 text-base font-700">{state.config.sonarrStats.queueCount ?? 'Unknown'}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Root folders</div>
          <div class="mt-1 text-sm text-[var(--muted)]">{state.config.sonarrStats.rootFolderCount}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Default profile</div>
          <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{state.config.sonarrStats.defaultQualityProfileName ?? 'Unknown'}</div>
        </div>
        <div class="sm:col-span-2">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Primary root</div>
          <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{state.config.sonarrStats.primaryRootFolderPath ?? 'Unknown'}</div>
        </div>
      </div>
    </article>
    <article class="card-shell p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Plex</div>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Libraries</div>
          <div class="mt-1 text-base font-700">{state.config.plexStats.libraryCount}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Recent mixed items</div>
          <div class="mt-1 text-base font-700">{state.recentPlexItems.length}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Movie libraries</div>
          <div class="mt-1 text-sm text-[var(--muted)]">{state.config.plexStats.movieLibraryCount}</div>
        </div>
        <div>
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Show libraries</div>
          <div class="mt-1 text-sm text-[var(--muted)]">{state.config.plexStats.showLibraryCount}</div>
        </div>
        <div class="sm:col-span-2">
          <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Library names</div>
          <div class="mt-2 flex flex-wrap gap-2">
            {#if state.config.plexStats.libraryTitles.length > 0}
              {#each state.config.plexStats.libraryTitles as title}
                <span class="max-w-full overflow-safe-text rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-sm text-[var(--muted)]">
                  {title}
                </span>
              {/each}
            {:else}
              <div class="text-sm text-[var(--muted)]">No library details available.</div>
            {/if}
          </div>
        </div>
      </div>
    </article>
    <article class="card-shell p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Runtime issues</div>
      {#if state.config.runtime.issues.length > 0}
        <ul class="mt-2 space-y-2 text-sm">
          {#each state.config.runtime.issues as issue}
            <li class="overflow-safe-text rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2">{issue}</li>
          {/each}
        </ul>
      {:else}
        <div class="mt-2 text-sm text-[var(--muted)]">No blocking runtime issues detected.</div>
      {/if}
    </article>
    <article class="card-shell p-3">
      <div class="text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">Runtime warnings</div>
      {#if state.config.runtime.warnings.length > 0}
        <ul class="mt-2 space-y-2 text-sm">
          {#each state.config.runtime.warnings as warning}
            <li class="overflow-safe-text rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-3 py-2">{warning}</li>
          {/each}
        </ul>
      {:else}
        <div class="mt-2 text-sm text-[var(--muted)]">No runtime warnings detected.</div>
      {/if}
    </article>
  </div>
</section>
