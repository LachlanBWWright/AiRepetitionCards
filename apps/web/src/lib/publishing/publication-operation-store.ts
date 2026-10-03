import { Effect } from "effect";
import { encodePublicationShareToken, type PublicationOperationStore } from "@recall/application";
import { coordinateLocalWrite } from "@/features/workspace/local-write-coordinator";
const key = (id: string) => `recall-pending-publication:${id.toLowerCase()}`;
const failure = () => ({ _tag: "PublicationForkOperationFailure" }) as const;
export const browserPublicationOperationStore: PublicationOperationStore = {
  coordinate: (id, operation) =>
    Effect.tryPromise({
      try: async () =>
        await navigator.locks.request(
          `recall-publication-intent:${id.toLowerCase()}`,
          { mode: "exclusive" },
          () => Effect.runPromise(Effect.either(operation)),
        ),
      catch: failure,
    }).pipe(Effect.flatMap((result) => result)),
  read: (id) =>
    coordinateLocalWrite(
      Effect.try({ try: () => localStorage.getItem(key(id)), catch: failure }),
      failure,
    ),
  write: (id, value) =>
    coordinateLocalWrite(
      Effect.try({ try: () => localStorage.setItem(key(id), value), catch: failure }),
      failure,
    ),
  clear: (id) =>
    coordinateLocalWrite(
      Effect.try({ try: () => localStorage.removeItem(key(id)), catch: failure }),
      failure,
    ),
};
export function createPublicationShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return encodePublicationShareToken(bytes);
}
