import { Effect } from "effect";
import type { Workspace } from "@recall/domain";
import type { WorkspaceSearchNotebookLoadResult } from "@recall/application";
import { readNativeKnowledgeNotebook } from "./native-knowledge-notebook-store";

/** Only notebooks belonging to areas in the captured current workspace are read. */
export function loadNativeWorkspaceSearchNotebooks(
  workspace: Workspace,
): Effect.Effect<WorkspaceSearchNotebookLoadResult> {
  return Effect.gen(function* () {
    const records = yield* Effect.forEach(
      workspace.areas.flatMap((area) =>
        ["knowledge-notebook", "knowledge-notebook:card-refinements"].map((namespace) => ({
          areaId: area.id,
          namespace,
        })),
      ),
      ({ areaId, namespace }) =>
        Effect.either(readNativeKnowledgeNotebook(areaId, namespace)).pipe(
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
