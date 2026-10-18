import "server-only";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Effect, Schema } from "effect";
import {
  CodingExecutionSchema,
  CodingPayloadSchema,
  type ActivityResponse,
  type LearningActivity,
} from "@recall/domain";
import type { ActivityFailure } from "@recall/application";
const failure = (message: string): ActivityFailure => ({
  _tag: "ActivityFailure",
  reason: "assessment-unavailable",
  message,
});
// The trusted harness stays outside the VM. No host objects or functions enter learner code.
export const codingHarness = String.raw`
const vm = require('node:vm');
const {isDeepStrictEqual} = require('node:util');
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{input+=chunk;if(input.length>200000)process.exit(2);});
process.stdin.on('end',()=>{
  const request=JSON.parse(input);
  const failures=[];let passed=0;
  for(let index=0;index<request.tests.length;index++){
    const test=request.tests[index];
    try{
      const context=vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false},microtaskMode:"afterEvaluate"});
      new vm.Script('Object.freeze(JSON); Object.defineProperty(globalThis, "JSON", {value:JSON,writable:false,configurable:false});').runInContext(context,{timeout:500});
      new vm.Script('"use strict";\n'+request.source).runInContext(context,{timeout:500,microtaskMode:'afterEvaluate'});
      const encoded=new vm.Script('JSON.stringify(solve(...'+JSON.stringify(test.input)+'))').runInContext(context,{timeout:500});
      const actual=JSON.parse(encoded);
      if(isDeepStrictEqual(actual,test.expected))passed++;else failures.push('Test '+(index+1)+': returned the wrong value.');
    }catch(error){failures.push('Test '+(index+1)+': could not complete. '+String(error).slice(0,300));}
  }
  process.stdout.write(JSON.stringify({passed,total:request.tests.length,failures}));
});
`;
function command(
  args: readonly string[],
  input = "",
  limit = 65_536,
): Effect.Effect<string, ActivityFailure> {
  return Effect.tryPromise({
    try: (signal) =>
      new Promise<{ readonly ok: boolean; readonly output: string }>((resolve) => {
        const child = spawn("docker", [...args], { stdio: ["pipe", "pipe", "pipe"] });
        let output = "";
        let stderr = "";
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          signal.removeEventListener("abort", abort);
          resolve({ ok, output: ok ? output : stderr });
        };
        const abort = () => {
          child.kill("SIGKILL");
          finish(false);
        };
        signal.addEventListener("abort", abort, { once: true });
        child.stdout.on("data", (chunk: unknown) => {
          if (Buffer.isBuffer(chunk)) {
            output += chunk.toString("utf8");
            if (Buffer.byteLength(output) > limit) abort();
          }
        });
        child.stderr.on("data", (chunk: unknown) => {
          if (Buffer.isBuffer(chunk)) stderr = (stderr + chunk.toString("utf8")).slice(0, 2000);
        });
        child.on("error", () => {
          finish(false);
        });
        child.on("close", (code) => {
          finish(code === 0);
        });
        child.stdin.on("error", () => {
          finish(false);
        });
        child.stdin.end(input);
      }),
    catch: () => failure("Code execution is unavailable. Your solution is retained."),
  }).pipe(
    Effect.flatMap((result) =>
      result.ok
        ? Effect.succeed(result.output)
        : Effect.fail(
            failure(
              "Code could not run within the resource limits. Check your solution or retry the runner.",
            ),
          ),
    ),
  );
}
export function executeCodingActivity(activity: LearningActivity, response: ActivityResponse) {
  return Effect.gen(function* () {
    const payload = yield* Schema.decodeUnknown(CodingPayloadSchema)(activity.payload).pipe(
      Effect.mapError(() =>
        failure("This coding activity needs JavaScript tests. Edit it before running."),
      ),
    );
    const source = response.answers[0];
    if (!source?.trim())
      return yield* Effect.fail(failure("Write a solve function before running tests."));
    const name = `recall-code-${randomUUID()}`;
    const image = process.env.RECALL_CODE_IMAGE ?? "recall-code-runner:1";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/@:-]*$/.test(image))
      return yield* Effect.fail(failure("The code runner image is not configured correctly."));
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
        "--memory=128m",
        "--memory-swap=128m",
        "--cpus=0.5",
        "--user=65534:65534",
        "--ulimit=nofile=64:64",
        "--ulimit=cpu=10:10",
        image,
        "node",
        "--max-old-space-size=64",
        "-e",
        codingHarness,
      ],
      JSON.stringify({ source, tests: payload.tests }),
    ).pipe(
      Effect.timeoutFail({
        duration: "15 seconds",
        onTimeout: () => failure("Code execution timed out. Your solution is retained."),
      }),
      Effect.ensuring(
        command(["rm", "-f", name], "", 4096).pipe(Effect.timeout("5 seconds"), Effect.ignore),
      ),
    );
    return yield* Schema.decodeUnknown(Schema.parseJson(CodingExecutionSchema))(output).pipe(
      Effect.mapError(() => failure("The code runner returned an invalid result.")),
    );
  });
}
