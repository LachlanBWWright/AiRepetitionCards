type AISelection = { readonly model: string };
export const defaultSelection: AISelection = { model: "" };
let selection = defaultSelection;
const listeners = new Set<() => void>();

// Shared UI preference only. Credentials remain in the Electron main process.
export function subscribeSelection(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const readSelection = () => selection;
export function setModel(value: string | ((current: string) => string)) {
  selection = { model: typeof value === "function" ? value(selection.model) : value };
  listeners.forEach((listener) => {
    listener();
  });
}
