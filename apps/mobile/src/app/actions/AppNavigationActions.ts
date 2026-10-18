import { Effect, Either } from "effect";
import { NativeAppTab as AppTab } from "../../navigation";
import type { AppCoreState } from "../useAppController";
import type { createAppInterchangeActions } from "./AppInterchangeActions";
export function createAppNavigationActions(
  model: Pick<
    AppCoreState & ReturnType<typeof createAppInterchangeActions>,
    | "reviewPending"
    | "workspaceLifetime"
    | "setActiveAreaId"
    | "setStudySession"
    | "setShowAnswer"
    | "setMediaUris"
    | "setNow"
    | "setActiveTab"
    | "setSubjectMode"
    | "setReviewAll"
    | "importingCards"
    | "setImportingCards"
    | "importKnowledgeArea"
    | "setMessage"
    | "setShowImportChoices"
    | "transferPending"
    | "setTransferPending"
  >,
) {
  const {
    reviewPending,
    workspaceLifetime,
    setActiveAreaId,
    setStudySession,
    setShowAnswer,
    setMediaUris,
    setNow,
    setActiveTab,
    setSubjectMode,
    setReviewAll,
    importingCards,
    setImportingCards,
    importKnowledgeArea,
    setMessage,
    setShowImportChoices,
    transferPending,
    setTransferPending,
  } = model;
  function startStudy(areaId: string) {
    if (reviewPending || workspaceLifetime.isBlocked()) return;
    setActiveAreaId(areaId);
    setStudySession((current) => (current?.areaId === areaId ? current : { areaId, events: [] }));
    setShowAnswer(false);
    setMediaUris({});
    setNow(Date.now());
    setReviewAll(false);
    setSubjectMode("review");
    setActiveTab(AppTab.Library);
  }
  async function importCards(format?: "csv" | "tsv") {
    if (importingCards) return;
    setImportingCards(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => importKnowledgeArea(format),
          catch: () => ({ _tag: "NativeCardImportUnavailable" }) as const,
        }),
      ),
    );
    setMessage(Either.isRight(result) ? result.right : "Cards could not be imported. Try again.");
    setImportingCards(false);
    if (Either.isRight(result) && result.right.includes("imported.")) setShowImportChoices(false);
  }
  async function runLibraryTransfer(action: () => Promise<string>) {
    if (transferPending) return;
    setTransferPending(true);
    const outcome = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: action,
          catch: () => ({
            message: "The file action couldn’t finish. Your workspace is unchanged. Try again.",
          }),
        }),
      ),
    );
    setMessage(Either.isRight(outcome) ? outcome.right : outcome.left.message);
    setTransferPending(false);
  }
  return { startStudy, importCards, runLibraryTransfer } as const;
}
