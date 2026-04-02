type DismissHandler = () => void;

export function dismissable(node: HTMLElement, onDismiss: DismissHandler) {
  const handlePointerDown = (event: PointerEvent) => {
    if (!node.contains(event.target as Node | null)) {
      onDismiss();
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onDismiss();
    }
  };

  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('keydown', handleKeyDown);

  return {
    destroy() {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    },
  };
}
