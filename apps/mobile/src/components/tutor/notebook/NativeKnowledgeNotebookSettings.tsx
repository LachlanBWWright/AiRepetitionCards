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
  const { showSettings, busy, notebook, mounted, setNotice, clearNotebook } = model;
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
    <View className={showSettings ? "gap-[11px]" : "hidden"}>
      <NativeButton
        disabled={busy}
        onPress={exportNotebook}
        label="Export notebook"
        className={
          "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
        }
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
      <NativeButton
        disabled={busy}
        onPress={clearNotebook}
        label="Clear notebook"
        className={
          "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
        }
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
    </View>
  );
}
