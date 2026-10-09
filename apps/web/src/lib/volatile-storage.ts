/** Storage-shaped, tab-lifetime memory for UI workflows that need keyed state. */
const values = new Map<string, string>();
const desktopStorage = () =>
  typeof window === "undefined" ? undefined : window.recallDesktop && window.localStorage;

export const volatileStorage = {
  get length() {
    return desktopStorage()?.length ?? values.size;
  },
  getItem(key: string) {
    return desktopStorage()?.getItem(key) ?? values.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    const storage = desktopStorage();
    if (storage) storage.setItem(key, String(value));
    else values.set(key, String(value));
  },
  removeItem(key: string) {
    const storage = desktopStorage();
    if (storage) storage.removeItem(key);
    else values.delete(key);
  },
  clear() {
    const storage = desktopStorage();
    if (!storage) values.clear();
    else {
      const privatePrefixes = [
        "recall-tutor-session:",
        "recall-chatgpt-tutor:",
        "recall-chatgpt-proposal-session:",
        "recall-chatgpt-welcome:",
        "recall-knowledge-notebook:",
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
    }
  },
  key(index: number) {
    return desktopStorage()?.key(index) ?? [...values.keys()][index] ?? null;
  },
};
