import { useEffect } from "react";

/** Workspace commands never intercept typing, modified shortcuts, or an open overlay. */
export function useWorkspaceShortcut(key: string, enabled: boolean, onAction: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const handle = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== key.toLowerCase()
      )
        return;
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, button, a, [contenteditable], [role="textbox"], [role="combobox"]',
        )
      )
        return;
      event.preventDefault();
      onAction();
    };
    window.addEventListener("keydown", handle);
    return () => {
      window.removeEventListener("keydown", handle);
    };
  }, [key, enabled, onAction]);
}
