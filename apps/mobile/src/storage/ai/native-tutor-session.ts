import { Effect } from "effect";
import * as SecureStore from "expo-secure-store";
import type { AreaId } from "@recall/domain";
import { withNativeOperationStoreLane } from "../workspace/native-operation-store";

const tutorSessionKey = "recall-tutor-session-";
const sessionKey = (areaId: string, scope?: string) =>
  `${tutorSessionKey}${scope ? `${scope}-` : ""}${areaId}`.replaceAll(":", "-");
const tutorSessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type NativeTutorSessionStoreFailure = { readonly _tag: "NativeTutorSessionStoreFailure" };

export function readNativeTutorSessionId(
  areaId: AreaId,
  scope?: string,
): Effect.Effect<string | null, NativeTutorSessionStoreFailure> {
  return Effect.tryPromise({
    try: async () => {
      const value = await SecureStore.getItemAsync(sessionKey(areaId, scope));
      return value && tutorSessionIdPattern.test(value) ? value : null;
    },
    catch: () => ({ _tag: "NativeTutorSessionStoreFailure" }) as const,
  });
}

export function writeNativeTutorSessionId(
  areaId: AreaId,
  sessionId: string,
  mayWrite: () => boolean = () => true,
  scope?: string,
): Effect.Effect<void, NativeTutorSessionStoreFailure> {
  return withNativeOperationStoreLane(
    Effect.suspend(() =>
      mayWrite()
        ? Effect.tryPromise({
            try: () => SecureStore.setItemAsync(sessionKey(areaId, scope), sessionId),
            catch: () => ({ _tag: "NativeTutorSessionStoreFailure" }) as const,
          })
        : Effect.fail({ _tag: "NativeTutorSessionStoreFailure" } as const),
    ),
  );
}

export function clearNativeTutorSessionIds(
  areaIds: readonly string[],
): Effect.Effect<void, NativeTutorSessionStoreFailure> {
  return withNativeOperationStoreLane(
    Effect.gen(function* () {
      const results = yield* Effect.forEach(
        [...new Set(areaIds)],
        (areaId) =>
          Effect.either(
            Effect.tryPromise({
              try: () => SecureStore.deleteItemAsync(sessionKey(areaId)),
              catch: () => ({ _tag: "NativeTutorSessionStoreFailure" }) as const,
            }),
          ),
        { concurrency: "unbounded" },
      );
      if (results.some((result) => result._tag === "Left"))
        return yield* Effect.fail({ _tag: "NativeTutorSessionStoreFailure" } as const);
    }),
  );
}
