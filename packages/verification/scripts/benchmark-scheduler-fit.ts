import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Effect, Either } from "effect";
import { benchmarkSchedulerFit } from "@recall/scheduler";
const path = process.argv[2];
if (!path) {
  process.stderr.write(
    "Provide a JSON file containing events, referenceName and independently fitted referenceWeights. No study data is changed.\n",
  );
  process.exitCode = 1;
} else {
  const result = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: () => readFile(path, "utf8"),
        catch: () => ({ message: "The benchmark input file could not be read." }),
      }).pipe(
        Effect.flatMap((raw) =>
          Effect.try({
            try: (): unknown => JSON.parse(raw),
            catch: () => ({ message: "The benchmark input is not valid JSON." }),
          }),
        ),
        Effect.flatMap((value) => benchmarkSchedulerFit(value, () => performance.now())),
      ),
    ),
  );
  if (Either.isLeft(result)) {
    process.stderr.write(
      "Scheduler benchmark failed: provide sufficient validated history and compatible reference weights.\n",
    );
    process.exitCode = 1;
  } else process.stdout.write(`${JSON.stringify(result.right, null, 2)}\n`);
}
