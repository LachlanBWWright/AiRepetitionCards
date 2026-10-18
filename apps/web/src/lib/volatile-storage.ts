/** Storage-shaped, tab-lifetime memory for UI workflows that need keyed state. */
const values = new Map<string, string>();
const desktopStorage = () =>
  typeof window === "undefined" || !window.recallDesktop ? undefined : window.localStorage;

export const volatileStorage = {
  get length() {
    return desktopStorage()?.length ?? values.size;
  },
  getItem(key: string) {
    return desktopStorage()?.getItem(key) ?? values.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    const storage = desktopStorage();
    if (storage) storage.setItem(key, value);
    else values.set(key, value);
  },
  removeItem(key: string) {
    const storage = desktopStorage();
    if (storage) storage.removeItem(key);
    else values.delete(key);
  },
  clear() {
    values.clear();
    const storage =
      typeof window === "undefined" ? undefined : (desktopStorage() ?? window.localStorage);
    if (storage) {
      const privatePrefixes = [
        "recall-tutor-session:",
        "recall-chatgpt-tutor:",
        "recall-chatgpt-proposal-session:",
        "recall-chatgpt-welcome:",
        "recall-knowledge-notebook:",
        "recall-library-notes:",
        "recall-library-notes-durable:",
        "recall-release-draft:",
        "recall-local-ai-usage",
        "recall-daily-reminders",
        "recall-pending-publication:",
        "recall-pending-fork:",
      ];
      for (const key of [
        ...Array.from({ length: storage.length }, (_, index) => storage.key(index)),
      ])
        if (key && privatePrefixes.some((prefix) => key.startsWith(prefix)))
          storage.removeItem(key);
      try {
        window.dispatchEvent(new Event("recall-library-notes-durable-change"));
      } catch {
        // Erasure has completed; subscribers can refresh on their next render.
      }
    }
  },
  key(index: number) {
    return desktopStorage()?.key(index) ?? [...values.keys()][index] ?? null;
  },
};
