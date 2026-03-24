import { useEffect } from 'react';

export interface KeyboardShortcutHandlers {
  onAddNode?: () => void;
  onDeleteSelected?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onExportCsv?: () => void;
  onEscape?: () => void;
  onSearchOpen?: () => void;
  onCycleNodes?: () => void;
}

export function useKeyboardShortcuts(
  isActive: boolean,
  handlers: KeyboardShortcutHandlers
) {
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const mod = e.metaKey || e.ctrlKey;

      if (e.key === 'z' && mod && !e.shiftKey) {
        e.preventDefault();
        handlers.onUndo?.();
      } else if ((e.key === 'z' && mod && e.shiftKey) || (e.key === 'y' && mod)) {
        e.preventDefault();
        handlers.onRedo?.();
      } else if (e.key === 'e' && mod) {
        e.preventDefault();
        handlers.onExportCsv?.();
      } else if (e.key === 'k' && mod) {
        e.preventDefault();
        handlers.onSearchOpen?.();
      } else if (e.key === 'n' || e.key === 'N') {
        if (!mod) {
          e.preventDefault();
          handlers.onAddNode?.();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handlers.onDeleteSelected?.();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handlers.onEscape?.();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        handlers.onCycleNodes?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, handlers]);
}
