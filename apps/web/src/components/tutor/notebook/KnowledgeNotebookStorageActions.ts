import { Effect, Either, Schema } from "effect";
import { KnowledgeNotebookSchema } from "@recall/application";
import type { KnowledgeNotebookState } from "./useKnowledgeNotebookState";
export function createKnowledgeNotebookStorageActions(
  model: Pick<
    KnowledgeNotebookState,
    | "working"
    | "setBusy"
    | "alive"
    | "store"
    | "setMessage"
    | "publish"
    | "setGoal"
    | "setDrafts"
    | "setUnsaved"
    | "setLoaded"
    | "current"
    | "demo"
    | "setClearConfirm"
  >,
) {
  const {
    working,
    setBusy,
    alive,
    store,
    setMessage,
    publish,
    setGoal,
    setDrafts,
    setUnsaved,
    setLoaded,
    current,
    demo,
    setClearConfirm,
  } = model;
  function reloadNotebook() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const epoch = alive.current;
    void Effect.runPromise(Effect.either(store.read())).then((result) => {
      if (epoch !== alive.current) return;
      if (Either.isLeft(result)) setMessage(result.left.message);
      else {
        publish(result.right);
        setGoal(result.right?.goal ?? "");
        setDrafts({});
        setUnsaved(false);
        setLoaded(true);
        setMessage(null);
      }
      working.current = false;
      setBusy(false);
    });
  }
  function exportNotebook() {
    if (!current.current) return;
    const decoded = Schema.decodeUnknownEither(KnowledgeNotebookSchema)(current.current);
    if (Either.isLeft(decoded)) {
      setMessage(
        "This notebook could not be validated for export. Its saved record remains untouched.",
      );
      return;
    }
    const exported = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(decoded.right, null, 2)], { type: "application/json" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "recall-private-knowledge-notebook.json";
            link.click();
            URL.revokeObjectURL(url);
          },
          catch: () => ({
            message: "The notebook could not be exported. Your evidence remains available.",
          }),
        }),
      ),
    );
    if (Either.isLeft(exported)) setMessage(exported.left.message);
  }
  function clear() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const epoch = alive.current;
    void Effect.runPromise(Effect.either(demo ? Effect.void : store.clear())).then((result) => {
      if (epoch !== alive.current) return;
      if (Either.isLeft(result)) setMessage(result.left.message);
      else {
        publish(null);
        setDrafts({});
        setGoal("");
        setClearConfirm(false);
        setUnsaved(false);
      }
      working.current = false;
      setBusy(false);
    });
  }
  return { reloadNotebook, exportNotebook, clear } as const;
}
