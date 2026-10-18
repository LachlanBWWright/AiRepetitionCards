import { useEffect } from "react";
import { Effect, Either } from "effect";
import { createNativeChatGPTTutorStore } from "../../storage/ai/native-chatgpt-tutor-store";
import { readNativeTutorSessionId } from "../../storage/ai/native-tutor-session";
import type { AppCoreState } from "../useAppController";

export function useAppStorageEffects(
  model: Pick<
    AppCoreState,
    | "chatGPT"
    | "chatGPTClientId"
    | "activeTutorAreaId"
    | "setChatGPTSession"
    | "tutorScope"
    | "operationGeneration"
    | "workspaceLifetime"
    | "setNativeTutorSessionIds"
  >,
) {
  const {
    chatGPT,
    chatGPTClientId,
    activeTutorAreaId,
    setChatGPTSession,
    tutorScope,
    operationGeneration,
    workspaceLifetime,
    setNativeTutorSessionIds,
  } = model;
  useEffect(() => {
    if (chatGPT.tutorMode !== "chatgpt" || !chatGPTClientId || !activeTutorAreaId) return;
    let mounted = true;
    const isMounted = () => mounted;
    const store = createNativeChatGPTTutorStore(chatGPTClientId, activeTutorAreaId, () => false);
    void Effect.runPromise(Effect.either(store.read("active-session"))).then((result) => {
      if (isMounted() && Either.isRight(result))
        setChatGPTSession({ scope: tutorScope, areaId: activeTutorAreaId, id: result.right });
    });
    return () => {
      mounted = false;
    };
  }, [
    chatGPT.tutorMode,
    chatGPTClientId,
    activeTutorAreaId,
    tutorScope,
    operationGeneration,
    setChatGPTSession,
  ]);
  useEffect(() => {
    if (!activeTutorAreaId) return;
    let mounted = true;
    const isMounted = () => mounted;
    const generation = workspaceLifetime.generation();
    void Effect.runPromise(Effect.either(readNativeTutorSessionId(activeTutorAreaId))).then(
      (result) => {
        if (
          !isMounted() ||
          Either.isLeft(result) ||
          workspaceLifetime.isBlocked() ||
          workspaceLifetime.generation() !== generation
        )
          return;
        setNativeTutorSessionIds((current) => ({
          ...current,
          [activeTutorAreaId]: result.right,
        }));
      },
    );
    return () => {
      mounted = false;
    };
  }, [activeTutorAreaId, operationGeneration, workspaceLifetime, setNativeTutorSessionIds]);
}
