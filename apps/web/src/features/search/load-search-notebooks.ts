import { Effect } from "effect";
import type { Workspace } from "@recall/domain";
import type { WorkspaceSearchNotebookLoadResult } from "@recall/application";
import { createBrowserKnowledgeNotebookStore } from "@/lib/knowledge-notebook-store";

/** Explicit namespaces prevent indexing another ChatGPT account's private notebooks. */
export function loadBrowserWorkspaceSearchNotebooks(
  workspace: Workspace,
  namespaces: readonly string[] = ["hosted", "hosted:card-refinements"],
): Effect.Effect<WorkspaceSearchNotebookLoadResult> {
  return Effect.gen(function* () {
    const records = yield* Effect.forEach(
      workspace.areas.flatMap((area) =>
        [...new Set(namespaces)].map((namespace) => ({ areaId: area.id, namespace })),
      ),
      ({ areaId, namespace }) =>
        Effect.either(createBrowserKnowledgeNotebookStore(namespace, areaId).read()).pipe(
          Effect.map((result) => ({ namespace, result })),
        ),
      { concurrency: 1 },
    );
    return {
      notebooks: records.flatMap(({ namespace, result }) =>
        result._tag === "Right" && result.right ? [{ namespace, notebook: result.right }] : [],
      ),
      unreadableCount: records.filter(({ result }) => result._tag === "Left").length,
    };
  });
}
