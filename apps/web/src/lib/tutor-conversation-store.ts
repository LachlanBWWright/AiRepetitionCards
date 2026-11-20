import { Effect } from "effect";
import { createTutorConversationStore } from "@recall/application";
import {
  coordinateLocalWrite,
  localWritesBlocked,
} from "@/features/workspace/local-write-coordinator";
const conflict = {
  message:
    "This conversation changed in another tab. Reopen it before saving; your open messages remain available.",
};
const failure = {
  message:
    "The conversation could not be saved on this device. Your open messages remain available.",
};

export function createBrowserTutorConversationStore(scope: string, areaId: string) {
  const key = `recall-tutor-conversation:${JSON.stringify([scope, areaId])}`;
  const guarded = <A>(operation: () => A) =>
    coordinateLocalWrite(
      Effect.tryPromise({
        try: () => window.navigator.locks.request(key, () => operation()),
        catch: () => failure,
      }),
      () => failure,
    );
  return createTutorConversationStore(scope, areaId, {
    read: guarded(() => window.localStorage.getItem(key)),
    commit: (expected, next) =>
      guarded(() => {
        if (localWritesBlocked()) return false;
        if (window.localStorage.getItem(key) !== expected) return false;
        if (next === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, next);
        return true;
      }).pipe(Effect.flatMap((saved) => (saved ? Effect.void : Effect.fail(conflict)))),
  });
}
