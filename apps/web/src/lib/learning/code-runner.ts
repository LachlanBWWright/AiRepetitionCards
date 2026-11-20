import "server-only";
import { randomUUID } from "node:crypto";
import { Effect, Schema } from "effect";
import {
  CodingExecutionSchema,
  CodingPayloadSchema,
  type ActivityResponse,
  type LearningActivity,
} from "@recall/domain";
import { runBoundedDockerCommand as command } from "./bounded-docker-command";
import type { ActivityFailure } from "@recall/application";
const failure = (message: string): ActivityFailure => ({
  _tag: "ActivityFailure",
  reason: "assessment-unavailable",
  message,
});
export function executeCodingActivity(
  activity: LearningActivity,
  response: ActivityResponse,
  mode: "run" | "submit" = "submit",
) {
  return Effect.gen(function* () {
    const payload = yield* Schema.decodeUnknown(CodingPayloadSchema)(activity.payload).pipe(
      Effect.mapError(() =>
        failure("This coding activity needs valid JSON tests. Edit it before running."),
      ),
    );
    const source = response.answers[0];
    if (!source?.trim() || source.length > 40_000)
      return yield* Effect.fail(failure("Write a solve function before running tests."));
    const name = `recall-code-${randomUUID()}`;
    const image = process.env.RECALL_CODE_IMAGE ?? "recall-code-runner:2";
    if (image.length > 200 || !/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]*$/.test(image))
      return yield* Effect.fail(failure("The code runner image is not configured correctly."));
    const tests =
      mode === "run" && payload.exampleTests?.length ? payload.exampleTests : payload.tests;
    const input = JSON.stringify({ source, language: payload.language, tests });
    if (Buffer.byteLength(input) > 200_000)
      return yield* Effect.fail(failure("The code execution request is too large."));
    const output = yield* command(
      [
        "run",
        "--pull=never",
        "--rm",
        "--name",
        name,
        "-i",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=32",
        "--memory=512m",
        "--memory-swap=512m",
        "--tmpfs=/tmp:rw,exec,nosuid,nodev,size=64m,mode=1777",
        "--cpus=0.5",
        "--user=65534:65534",
        "--ulimit=nofile=64:64",
        "--ulimit=cpu=25:25",
        image,
        "python3",
        "-I",
        "/runner/runner.py",
      ],
      input,
    ).pipe(
      Effect.timeoutFail({
        duration: "30 seconds",
        onTimeout: () => failure("Code execution timed out. Your solution is retained."),
      }),
      Effect.ensuring(
        command(["rm", "-f", name], "", 4096).pipe(Effect.timeout("5 seconds"), Effect.ignore),
      ),
    );
    return yield* Schema.decodeUnknown(Schema.parseJson(CodingExecutionSchema))(output).pipe(
      Effect.mapError(() => failure("The code runner returned an invalid result.")),
      Effect.filterOrFail(
        (result) => result.total === tests.length,
        () => failure("The code runner returned an invalid test count."),
      ),
    );
  });
}
