import { Effect, Either } from "effect";
import * as Crypto from "expo-crypto";
import { workspaceDuplicateCandidates } from "@recall/application";
import { identifyObjectiveGaps } from "@recall/ai-core";
import { NativeTutorPanel } from "../../components/tutor/practice/NativeTutorPanel";
import { nativeChatGPTAuth } from "../../storage/auth/native-chatgpt-auth";
import { createNativeChatGPTTutorStore } from "../../storage/ai/native-chatgpt-tutor-store";
import { writeNativeTutorSessionId } from "../../storage/ai/native-tutor-session";
import type { AppModel } from "../useAppController";
export function AppTutorPanel({ model }: { readonly model: AppModel }) {
  const {
    activePublishingArea,
    tutorActivity,
    tutorScope,
    activeArea,
    chatGPT,
    workspace,
    searchTarget,
    workspaceLifetime,
    operationGeneration,
    cacheWritable,
    now,
    tutorApi,
    nativeTutorSessionId,
    chatGPTClientId,
    setChatGPTSession,
    tutorLifetime,
    setNativeTutorSessionIds,
    approveTutorProposal,
    startStudy,
  } = model;
  return activePublishingArea && Either.isRight(activePublishingArea) ? (
    <NativeTutorPanel
      initialActivity={tutorActivity}
      key={`${tutorScope}:${activeArea?.id ?? "no-area"}:${tutorActivity ?? "practice"}`}
      storageScope={chatGPT.tutorMode === "chatgpt" ? tutorScope : undefined}
      area={activePublishingArea.right}
      duplicateCandidates={workspace ? workspaceDuplicateCandidates(workspace) : []}
      {...(searchTarget && searchTarget.areaId === activeArea?.id
        ? { searchTarget: searchTarget.target }
        : {})}
      reviewEvents={workspace?.reviewEvents ?? []}
      mayWrite={() =>
        !workspaceLifetime.isBlocked() &&
        workspaceLifetime.generation() === operationGeneration &&
        cacheWritable
      }
      objectiveGaps={
        activeArea
          ? identifyObjectiveGaps(activeArea, workspace?.reviewEvents ?? [], new Date(now))
          : []
      }
      api={tutorApi}
      createId={() => Crypto.randomUUID()}
      initialSessionId={nativeTutorSessionId}
      onSessionIdChange={(sessionId) => {
        if (
          !activeArea ||
          workspaceLifetime.isBlocked() ||
          workspaceLifetime.generation() !== operationGeneration
        )
          return;
        if (chatGPT.tutorMode === "chatgpt" && chatGPTClientId) {
          const epoch = nativeChatGPTAuth.epoch();
          setChatGPTSession({ scope: tutorScope, areaId: activeArea.id, id: sessionId });
          const store = createNativeChatGPTTutorStore(
            chatGPTClientId,
            activeArea.id,
            () =>
              !workspaceLifetime.isBlocked() &&
              workspaceLifetime.generation() === operationGeneration &&
              nativeChatGPTAuth.epoch() === epoch &&
              !tutorLifetime.lifetime.isBlocked(),
          );
          void Effect.runPromise(Effect.either(store.write([["active-session", sessionId]])));
          return;
        }
        setNativeTutorSessionIds((current) => ({ ...current, [activeArea.id]: sessionId }));
        void Effect.runPromise(
          Effect.either(
            writeNativeTutorSessionId(
              activeArea.id,
              sessionId,
              () =>
                !workspaceLifetime.isBlocked() &&
                workspaceLifetime.generation() === operationGeneration,
            ),
          ),
        );
      }}
      onApproveProposal={approveTutorProposal}
      onStartReview={() => {
        if (activeArea) startStudy(activeArea.id);
      }}
    />
  ) : null;
}
