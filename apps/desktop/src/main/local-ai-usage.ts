import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Schema } from "effect";
import { LocalAiUsageStateSchema, emptyLocalAiUsageState } from "@recall/application";

export type LocalAiUsageStorageFailure = { readonly _tag: "LocalAiUsageStorageUnavailable" };
const unavailable = (): LocalAiUsageStorageFailure => ({ _tag: "LocalAiUsageStorageUnavailable" });
type State = typeof LocalAiUsageStateSchema.Type;
function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** The ChatGPT main-process queue owns serialization; this adapter makes no cross-process claim. */
export function createLocalAiUsageStore(path: string) {
  let observed = false;
  const read = (): Effect.Effect<State, LocalAiUsageStorageFailure> =>
    Effect.gen(function* () {
      const raw = yield* Effect.tryPromise({
        try: () => readFile(path, "utf8"),
        catch: (error) => error,
      }).pipe(
        Effect.catchAll((error) =>
          !observed && missing(error) ? Effect.succeed(null) : Effect.fail(unavailable()),
        ),
      );
      if (raw === null) return emptyLocalAiUsageState();
      observed = true;
      if (Buffer.byteLength(raw, "utf8") > 20_000_000) return yield* Effect.fail(unavailable());
      const input = yield* Effect.try({ try: (): unknown => JSON.parse(raw), catch: unavailable });
      return yield* Schema.decodeUnknown(LocalAiUsageStateSchema)(input).pipe(
        Effect.mapError(unavailable),
      );
    });
  const write = (input: unknown): Effect.Effect<void, LocalAiUsageStorageFailure> =>
    Effect.gen(function* () {
      const state = yield* Schema.decodeUnknown(LocalAiUsageStateSchema)(input).pipe(
        Effect.mapError(unavailable),
      );
      const serialized = JSON.stringify(state);
      if (Buffer.byteLength(serialized, "utf8") > 20_000_000)
        return yield* Effect.fail(unavailable());
      const temp = `${path}.${randomUUID()}.tmp`;
      yield* Effect.tryPromise({
        try: async () => {
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          await chmod(dirname(path), 0o700);
          const file = await open(temp, "wx", 0o600);
          try {
            await file.writeFile(serialized, "utf8");
            await file.sync();
          } finally {
            await file.close();
          }
          await rename(temp, path);
          observed = true;
        },
        catch: unavailable,
      }).pipe(
        Effect.ensuring(
          Effect.tryPromise({ try: () => unlink(temp), catch: unavailable }).pipe(Effect.ignore),
        ),
      );
    });
  return { read, write };
}
