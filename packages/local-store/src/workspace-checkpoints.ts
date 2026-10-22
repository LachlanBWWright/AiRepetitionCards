import { Effect, Schema } from "effect";
import { parseWorkspaceJson } from "@recall/domain";
import type { LocalStoreFailure, WorkspaceStore } from "./index";

export const WorkspaceCheckpointSchema = Schema.Struct({
  createdAt: Schema.String.pipe(Schema.filter((value) => Number.isFinite(Date.parse(value)))),
  serializedWorkspace: Schema.String,
});
export const WorkspaceCheckpointsSchema = Schema.Array(WorkspaceCheckpointSchema);
export type WorkspaceCheckpoint = typeof WorkspaceCheckpointSchema.Type;
export type WorkspaceCheckpointStore = {
  readonly read: Effect.Effect<readonly WorkspaceCheckpoint[], LocalStoreFailure>;
  readonly write: (
    entries: readonly WorkspaceCheckpoint[],
  ) => Effect.Effect<void, LocalStoreFailure>;
  readonly durable: boolean;
};
const interval = 30 * 60 * 1000;
/** Keep twelve recent checkpoints, seven daily and four weekly recovery points. */
export function retainedWorkspaceCheckpoints(
  entries: readonly WorkspaceCheckpoint[],
): readonly WorkspaceCheckpoint[] {
  const sorted = [...entries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const retained = new Map(sorted.slice(0, 12).map((entry) => [entry.createdAt, entry]));
  const days = new Set<string>();
  const weeks = new Set<number>();
  for (const entry of sorted) {
    const day = entry.createdAt.slice(0, 10);
    const week = Math.floor(Date.parse(entry.createdAt) / (7 * 86400000));
    if (!days.has(day) && days.size < 7) {
      days.add(day);
      retained.set(entry.createdAt, entry);
    }
    if (!weeks.has(week) && weeks.size < 4) {
      weeks.add(week);
      retained.set(entry.createdAt, entry);
    }
  }
  return [...retained.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
/** The host must hold its existing write lane around this entire operation. */
export function withWorkspaceCheckpoints(
  store: WorkspaceStore,
  checkpoints: WorkspaceCheckpointStore,
  now: () => Date,
): WorkspaceStore {
  return {
    ...store,
    checkpoints,
    write: (serializedWorkspace) =>
      Effect.gen(function* () {
        const entries = yield* checkpoints.read;
        const time = now();
        if (!Number.isFinite(time.getTime()))
          return yield* Effect.fail({ _tag: "LocalStoreFailure", operation: "write" } as const);
        const latest = entries.reduce(
          (value, entry) => Math.max(value, Date.parse(entry.createdAt)),
          0,
        );
        if (!entries.length || time.getTime() - latest >= interval) {
          const previous = yield* store.read;
          const candidate = previous ?? serializedWorkspace;
          const decoded = yield* Effect.either(parseWorkspaceJson(candidate));
          if (decoded._tag === "Right")
            yield* checkpoints.write(
              retainedWorkspaceCheckpoints([
                ...entries,
                { createdAt: time.toISOString(), serializedWorkspace: candidate },
              ]),
            );
        }
        yield* store.write(serializedWorkspace);
      }),
    clear: Effect.gen(function* () {
      yield* checkpoints.write([]);
      yield* store.clear;
    }),
  };
}
