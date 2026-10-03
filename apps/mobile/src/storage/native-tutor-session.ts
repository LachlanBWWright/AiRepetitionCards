import { Effect } from "effect";
import * as SecureStore from "expo-secure-store";
import type { AreaId } from "@recall/domain";
import { withNativeOperationStoreLane } from "./native-operation-store";

const tutorSessionKey = "recall-tutor-session:";
const tutorSessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type NativeTutorSessionStoreFailure = { readonly _tag: "NativeTutorSessionStoreFailure" };

export function readNativeTutorSessionId(
  areaId: AreaId,
): Effect.Effect<string | null, NativeTutorSessionStoreFailure> {
  return Effect.tryPromise({
    try: async () => {
      const value = await SecureStore.getItemAsync(`${tutorSessionKey}${areaId}`);
      return value && tutorSessionIdPattern.test(value) ? value : null;
    },
    catch: () => ({ _tag: "NativeTutorSessionStoreFailure" }) as const,
  });
}

export function writeNativeTutorSessionId(
  areaId: AreaId,
  sessionId: string,
  mayWrite: () => boolean = () => true,
): Effect.Effect<void, NativeTutorSessionStoreFailure> {
  return withNativeOperationStoreLane(
    Effect.suspend(() =>
      mayWrite()
        ? Effect.tryPromise({
            try: () => SecureStore.setItemAsync(`${tutorSessionKey}${areaId}`, sessionId),
            catch: () => ({ _tag: "NativeTutorSessionStoreFailure" }) as const,
          })
        : Effect.fail({ _tag: "NativeTutorSessionStoreFailure" } as const),
    ),
  );
}

export function clearNativeTutorSessionIds(
  areaIds: readonly AreaId[],
): Effect.Effect<void, NativeTutorSessionStoreFailure> {
  return withNativeOperationStoreLane(
    Effect.gen(function* () {
      const results = yield* Effect.forEach(
        [...new Set(areaIds)],
        (areaId) =>
          Effect.either(
            Effect.tryPromise({
              try: () => SecureStore.deleteItemAsync(`${tutorSessionKey}${areaId}`),
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
