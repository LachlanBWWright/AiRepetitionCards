import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Effect, Either } from "effect";

// CI's debug-key APK must include JS and start without Metro. Modify only generated native code.
const gradlePath = fileURLToPath(new URL("../android/app/build.gradle", import.meta.url));
const marker = "// Recall standalone local preview";
const prepared = await Effect.runPromise(
  Effect.either(
    Effect.gen(function* () {
      const source = yield* Effect.tryPromise({
        try: () => readFile(gradlePath, "utf8"),
        catch: () => ({ _tag: "GeneratedAndroidProjectMissing" }),
      });
      if (source.includes(marker)) return;
      const reactBlocks = [...source.matchAll(/^react\s*\{\s*$/gm)];
      if (reactBlocks.length !== 1)
        return yield* Effect.fail({ _tag: "GeneratedAndroidProjectUnsupported" });
      const updated = source.replace(/^react\s*\{\s*$/m, "react {\n    debuggableVariants = []");
      yield* Effect.tryPromise({
        try: () =>
          writeFile(
            gradlePath,
            `${updated}\n${marker}\nandroid {\n    buildTypes {\n        debug {\n            debuggable false\n        }\n    }\n}\n`,
          ),
        catch: () => ({ _tag: "GeneratedAndroidProjectWriteFailed" }),
      });
    }),
  ),
);
if (Either.isLeft(prepared)) {
  console.error(`Could not prepare standalone Android preview: ${prepared.left._tag}`);
  process.exitCode = 1;
}
