<script lang="ts">
import type { AppState } from '$lib/client/app-state.svelte';
import OverlayDialog from '$lib/components/app/OverlayDialog.svelte';
import SearchFiltersPanel from '$lib/components/app/SearchFiltersPanel.svelte';

let { state }: { state: AppState } = $props();
</script>

{#if state.kindMenuOpen && state.usesFullscreenDialogs}
  <OverlayDialog
    closeLabel="Close search filters"
    onClose={() => state.closeKindMenu()}
    size="wide"
    title="Search filters"
    subtitle="Choose kind, availability, sort, and order."
  >
    {#snippet children()}
      <SearchFiltersPanel {state} />
    {/snippet}
  </OverlayDialog>
{/if}
