<script lang="ts">
import type { Snippet } from 'svelte';

let {
  closeLabel = 'Close dialog',
  closeDisabled = false,
  children,
  footer,
  onClose,
  size = 'narrow',
  subtitle = null,
  title,
}: {
  closeLabel?: string;
  closeDisabled?: boolean;
  children?: Snippet;
  footer?: Snippet;
  onClose: () => void;
  size?: 'narrow' | 'wide';
  subtitle?: string | null;
  title: string;
} = $props();
</script>

<button
  class="app-overlay__backdrop"
  type="button"
  aria-label={closeLabel}
  disabled={closeDisabled}
  onclick={() => onClose()}
></button>

<div class="app-overlay__frame">
  <div
    class={`floating-shell app-overlay__panel ${size === 'wide' ? 'app-overlay__panel--wide' : 'app-overlay__panel--narrow'}`}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <header class="app-overlay__header">
      <div class="min-w-0">
        <div class="overflow-safe-text text-lg font-800">{title}</div>
        {#if subtitle}
          <div class="mt-1 overflow-safe-text text-sm text-[var(--muted)]">{subtitle}</div>
        {/if}
      </div>
      <button
        class="control-shell flex h-9 w-9 shrink-0 items-center justify-center text-sm font-700 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        aria-label={closeLabel}
        disabled={closeDisabled}
        onclick={() => onClose()}
      >
        X
      </button>
    </header>

    <div class="app-overlay__body">
      {@render children?.()}
    </div>

    <footer class="app-overlay__footer">
      {@render footer?.()}
    </footer>
  </div>
</div>
