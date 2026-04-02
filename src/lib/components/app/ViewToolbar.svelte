<script lang="ts">
import type { AppView } from '$lib/shared/types';

type ToolbarOption = {
  value: AppView;
  label: string;
  title: string;
  icon: 'search' | 'queue' | 'audit' | 'status' | 'settings';
};

const toolbarOptions: ToolbarOption[] = [
  { value: 'search', label: 'Search', title: 'Search', icon: 'search' },
  { value: 'queue', label: 'Queue', title: 'Queue', icon: 'queue' },
  { value: 'dashboard', label: 'Audit', title: 'Audit Queue', icon: 'audit' },
  { value: 'status', label: 'Status', title: 'Service Status', icon: 'status' },
  { value: 'settings', label: 'Settings', title: 'Settings', icon: 'settings' },
];

let {
  activeView,
  onSelect,
}: {
  activeView: AppView;
  onSelect: (view: AppView) => void;
} = $props();
</script>

<nav
  class="floating-shell fixed left-1/2 top-0 z-50 w-[calc(100%-1rem)] max-w-3xl -translate-x-1/2 px-2 py-2 sm:w-[calc(100%-1.5rem)]"
  aria-label="Primary navigation"
>
  <div class="grid grid-cols-5 gap-2">
    {#each toolbarOptions as option}
      <button
        class={`toolbar-button min-h-14 px-2 py-2 ${activeView === option.value ? 'toolbar-button-active' : ''}`}
        type="button"
        aria-label={option.title}
        title={option.title}
        onclick={() => onSelect(option.value)}
      >
        <span class="toolbar-glyph" aria-hidden="true">
          {#if option.icon === 'search'}
            <svg viewBox="0 0 24 24" class="h-5 w-5 fill-none stroke-current stroke-2">
              <circle cx="11" cy="11" r="6"></circle>
              <path d="m16 16 4.5 4.5"></path>
            </svg>
          {:else if option.icon === 'queue'}
            <svg viewBox="0 0 24 24" class="h-5 w-5 fill-none stroke-current stroke-2">
              <rect x="4" y="5" width="16" height="4" rx="1.5"></rect>
              <rect x="4" y="10" width="16" height="4" rx="1.5"></rect>
              <rect x="4" y="15" width="10" height="4" rx="1.5"></rect>
            </svg>
          {:else if option.icon === 'audit'}
            <svg viewBox="0 0 24 24" class="h-5 w-5 fill-none stroke-current stroke-2">
              <path d="M6 12h12"></path>
              <path d="M12 6v12"></path>
              <circle cx="12" cy="12" r="7"></circle>
            </svg>
          {:else if option.icon === 'status'}
            <svg viewBox="0 0 24 24" class="h-5 w-5 fill-none stroke-current stroke-2">
              <path d="M5 12h3l2-4 4 8 2-4h3"></path>
              <path d="M4 12a8 8 0 1 1 16 0"></path>
            </svg>
          {:else}
            <svg viewBox="0 0 24 24" class="h-5 w-5 fill-none stroke-current stroke-2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 3.5v2.2"></path>
              <path d="M12 18.3v2.2"></path>
              <path d="m5.9 5.9 1.6 1.6"></path>
              <path d="m16.5 16.5 1.6 1.6"></path>
              <path d="M3.5 12h2.2"></path>
              <path d="M18.3 12h2.2"></path>
              <path d="m5.9 18.1 1.6-1.6"></path>
              <path d="m16.5 7.5 1.6-1.6"></path>
            </svg>
          {/if}
        </span>
        <span class="toolbar-label">{option.label}</span>
      </button>
    {/each}
  </div>
</nav>
