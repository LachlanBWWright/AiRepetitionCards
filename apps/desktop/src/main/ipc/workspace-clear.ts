import type { DatabaseSync } from "node:sqlite";
import { Effect, Either } from "effect";

/** Keep recovery data intact unless clearing the workspace also succeeds. */
export function clearDesktopWorkspace(database: DatabaseSync): boolean {
  const state = { active: false };
  const result = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => {
          database.exec("SAVEPOINT workspace_clear");
          state.active = true;
          database.prepare("DELETE FROM workspace_checkpoints").run();
          database.prepare("DELETE FROM workspace_checkpoint_chunks").run();
          database.prepare("DELETE FROM local_workspace WHERE id = 1").run();
          database.prepare("DELETE FROM local_workspace_chunks").run();
          database.exec("RELEASE workspace_clear");
          state.active = false;
        },
        catch: () => ({ _tag: "WorkspaceClearFailure" }) as const,
      }),
    ),
  );
  if (Either.isRight(result)) return true;
  if (state.active)
    Effect.runSync(
      Effect.try({
        try: () => {
          database.exec("ROLLBACK TO workspace_clear; RELEASE workspace_clear");
        },
        catch: () => ({ _tag: "WorkspaceClearRollbackFailure" }) as const,
      }).pipe(Effect.ignore),
    );
  return false;
}
