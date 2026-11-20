import { NativeButton } from "../../ui/NativeButton";
import { View } from "react-native";
import { Effect, Either } from "effect";
import { shareKnowledgeNotebook } from "../../../storage/interchange/native-interchange";
import type { NativeNotebookModel } from "./useNativeKnowledgeNotebookModel";
export function NativeKnowledgeNotebookSettings({
  model,
}: {
  readonly model: NativeNotebookModel;
}) {
  const { busy, notebook, mounted, setNotice, clearNotebook } = model;
  if (!notebook) return null;
  function exportNotebook() {
    if (!notebook) return;
    void Effect.runPromise(Effect.either(shareKnowledgeNotebook(notebook))).then((result) => {
      if (mounted.current)
        setNotice(
          Either.isRight(result)
            ? "Notebook JSON shared. Keep it private; it contains learning history."
            : "Notebook export is unavailable.",
        );
    });
  }
  return (
    <View className="gap-4">
      <NativeButton disabled={busy} onPress={exportNotebook} label="Export notebook" />
      <NativeButton disabled={busy} onPress={clearNotebook} label="Clear notebook" />
    </View>
  );
}
