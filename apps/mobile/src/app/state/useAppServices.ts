import { useMemo } from "react";
import { Effect, Either, Schema } from "effect";
import { toKnowledgeArea } from "@recall/application";
import { dueNow } from "./workspace-utils";
import { supabaseAuthClient } from "../../storage/auth/supabase-auth";
import { makeNativeDeckSharingApi } from "../../storage/publishing/native-deck-sharing-api";
import { createNativeActivityServices } from "../../storage/workspace/native-activity-services";
import { useNativeCardMedia } from "../../hooks/use-native-card-media";
import { createNativeWorkspaceLifetime } from "../../storage/workspace/native-workspace-lifetime";
import { createNativeChatGPTTutor } from "../../storage/ai/native-chatgpt-tutor";
import { makeNativeTutorApi } from "../../storage/ai/native-tutor-api";
import type { AppBaseState } from "./useAppBaseState";
export function useAppServices(
  base: Pick<
    AppBaseState,
    | "accountUserId"
    | "workspace"
    | "activeAreaId"
    | "chatGPT"
    | "nativeTutorSessionIds"
    | "chatGPTSession"
    | "workspaceLifetime"
    | "operationGeneration"
    | "libraryNotes"
    | "now"
    | "mediaStore"
    | "mediaRevision"
  >,
) {
  const {
    accountUserId,
    workspace,
    activeAreaId,
    chatGPT,
    nativeTutorSessionIds,
    chatGPTSession,
    workspaceLifetime,
    operationGeneration,
    libraryNotes,
    now,
    mediaStore,
    mediaRevision,
  } = base;
  const hostedTutorApi = useMemo(() => {
    const apiUrl = process.env.EXPO_PUBLIC_RECALL_API_URL ?? "";
    if (!apiUrl.trim() || !supabaseAuthClient) return null;
    return makeNativeTutorApi(
      apiUrl,
      async () => {
        const client = supabaseAuthClient;
        if (!client) return null;
        const result = await Effect.runPromise(
          Effect.either(
            Effect.tryPromise({
              try: () => client.auth.getSession(),
              catch: () => ({ _tag: "TutorSessionReadError" }) as const,
            }),
          ),
        );
        if (Either.isLeft(result)) return null;
        const session = result.right.data.session;
        const owner = Schema.decodeUnknownEither(Schema.UUID)(session?.user.id);
        return Either.isRight(owner) && owner.right === accountUserId
          ? (session?.access_token ?? null)
          : null;
      },
      () => accountUserId,
    );
  }, [accountUserId]);
  const deckSharingApi = useMemo(() => {
    const apiUrl = process.env.EXPO_PUBLIC_RECALL_API_URL ?? "";
    if (!apiUrl.trim()) return null;
    const owner = accountUserId;
    return makeNativeDeckSharingApi(
      apiUrl,
      async () => {
        const authClient = supabaseAuthClient;
        if (!owner || !authClient) return null;
        const result = await Effect.runPromise(
          Effect.either(
            Effect.tryPromise({
              try: () => authClient.auth.getSession(),
              catch: () => ({ _tag: "DeckSharingSessionReadFailure" }) as const,
            }),
          ),
        );
        if (Either.isLeft(result)) return null;
        const session = result.right.data.session;
        const user = Schema.decodeUnknownEither(Schema.UUID)(session?.user.id);
        return Either.isRight(user) && user.right === owner
          ? (session?.access_token ?? null)
          : null;
      },
      owner ?? undefined,
    );
  }, [accountUserId]);
  const activityServices = useMemo(() => {
    const url =
      process.env.EXPO_PUBLIC_RECALL_ACTIVITY_API_URL ??
      process.env.EXPO_PUBLIC_RECALL_API_URL ??
      "";
    if (!url.trim() || !supabaseAuthClient || !accountUserId) return null;
    const owner = accountUserId;
    return createNativeActivityServices(
      url,
      async () => {
        const client = supabaseAuthClient;
        if (!client) return null;
        const result = await client.auth.getSession();
        return result.data.session?.user.id === owner ? result.data.session.access_token : null;
      },
      owner,
    );
  }, [accountUserId]);
  const activeArea =
    workspace?.areas.find((area) => area.id === activeAreaId) ?? workspace?.areas[0];
  const activeTutorAreaId = activeArea?.id ?? null;
  const chatGPTClientId = chatGPT.status.activeClientId;
  const chatGPTReady = chatGPT.status.accounts.some(
    (account) => account.clientId === chatGPTClientId && account.signedIn && account.planEnabled,
  );
  const tutorScope =
    chatGPT.tutorMode === "chatgpt"
      ? `chatgpt:${chatGPTClientId ?? "disconnected"}`
      : `hosted:${accountUserId ?? "disconnected"}`;
  const tutorLifetime = useMemo(
    () => ({
      scope: tutorScope,
      model: chatGPT.model,
      epoch: chatGPT.connectionEpoch,
      lifetime: createNativeWorkspaceLifetime(),
    }),
    [tutorScope, chatGPT.model, chatGPT.connectionEpoch],
  );
  const nativeTutorSessionId =
    chatGPT.tutorMode === "hosted"
      ? activeArea
        ? (nativeTutorSessionIds[activeArea.id] ?? null)
        : null
      : chatGPTSession?.scope === tutorScope && chatGPTSession.areaId === activeTutorAreaId
        ? chatGPTSession.id
        : null;
  const localTutorApi = useMemo(() => {
    if (!chatGPTClientId || !chatGPTReady || !chatGPT.model || !activeTutorAreaId) return null;
    return createNativeChatGPTTutor(
      chatGPTClientId,
      chatGPT.model,
      activeTutorAreaId,
      () =>
        !workspaceLifetime.isBlocked() &&
        workspaceLifetime.generation() === operationGeneration &&
        !tutorLifetime.lifetime.isBlocked(),
    );
  }, [
    chatGPTClientId,
    chatGPTReady,
    chatGPT.model,
    activeTutorAreaId,
    operationGeneration,
    workspaceLifetime,
    tutorLifetime,
  ]);
  const tutorApi = chatGPT.tutorMode === "chatgpt" ? localTutorApi : hostedTutorApi;
  const activeKnowledgeArea = activeArea
    ? Effect.runSync(Effect.either(toKnowledgeArea(activeArea, false, true)))
    : null;
  const activePublishingArea = activeArea
    ? Effect.runSync(
        Effect.either(
          toKnowledgeArea(activeArea, true, true).pipe(
            Effect.map((document) => ({
              ...document,
              activities: (libraryNotes.notes.activityLibrary?.activities ?? []).filter(
                (activity) => activity.areaId === activeArea.id && !activity.archived,
              ),
            })),
          ),
        ),
      )
    : null;
  const dueCards = useMemo(
    () => activeArea?.cards.filter((card) => dueNow(card, now)) ?? [],
    [activeArea, now],
  );
  const card = dueCards[0];
  const [mediaUris, setMediaUris] = useNativeCardMedia(mediaStore, card, mediaRevision);
  return {
    hostedTutorApi,
    deckSharingApi,
    activityServices,
    activeArea,
    activeTutorAreaId,
    chatGPTClientId,
    chatGPTReady,
    tutorScope,
    tutorLifetime,
    nativeTutorSessionId,
    localTutorApi,
    tutorApi,
    activeKnowledgeArea,
    activePublishingArea,
    dueCards,
    card,
    mediaUris,
    setMediaUris,
  } as const;
}
export type AppServices = ReturnType<typeof useAppServices>;
