import { Alert } from "react-native";
import { Effect, Either } from "effect";
import { clearNativeKnowledgeNotebooks } from "../../../storage/ai/native-knowledge-notebook-store";
import type { NativeNotebookState } from "./useNativeKnowledgeNotebookState";
export function createNativeKnowledgeNotebookClearAction(context: NativeNotebookState) {
  const {
    runAction,
    area,
    mayWrite,
    storageNamespace,
    setNotebook,
    setUnsaved,
    setLoadFailed,
    setNotice,
  } = context;
  function clearNotebook() {
    Alert.alert("Clear this notebook?", "Approved cards and review history will stay saved.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear notebook",
        style: "destructive",
        onPress: () => {
          void runAction(async (isCurrent) => {
            const result = await Effect.runPromise(
              Effect.either(clearNativeKnowledgeNotebooks([area.id], mayWrite, storageNamespace)),
            );
            if (!isCurrent()) return;
            if (Either.isRight(result)) {
              setNotebook(null);
              setUnsaved(null);
              setLoadFailed(false);
              setNotice(
                "This private notebook was cleared. Saved cards and review history remain.",
              );
            } else setNotice("The notebook could not be cleared.");
          });
        },
      },
    ]);
  }
  return { clearNotebook } as const;
}
