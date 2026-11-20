import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect, Schema } from "effect";
import {
  createActivityServices,
  LuaInvocationSchema,
  LUA_RUNTIME_VERSION,
} from "@recall/application";
import { emptyActivityLibrary, type ActivityLibrary, type LearningActivity } from "@recall/domain";
import { LearningActivitiesPanel } from "../LearningActivitiesPanel";

// Deterministic UI fixtures; real executor containment is checked separately.
const services = createActivityServices((request) => {
  if (request.path.endsWith("/lua"))
    return Schema.decodeUnknown(LuaInvocationSchema)(request.body).pipe(
      Effect.mapError(() => ({
        _tag: "ActivityFailure" as const,
        reason: "invalid-input" as const,
        message: "Invalid fixture invocation",
      })),
      Effect.map((input) => {
        const count = typeof input.state === "number" ? input.state : 0;
        const view = {
          text: `Count: ${String(count)}`,
          buttons: [{ id: "increment", label: "Add one" }],
        };
        const assessment = {
          complete: count >= 3,
          score: count === 3 ? 1 : 0,
          feedback: "Aim for exactly three.",
        };
        const value =
          input.operation === "init"
            ? 0
            : input.operation === "update"
              ? count + 1
              : input.operation === "view"
                ? view
                : assessment;
        return { status: 200, body: { value, runtimeVersion: LUA_RUNTIME_VERSION } };
      }),
    );
  const mode =
    typeof request.body === "object" && request.body !== null && "executionMode" in request.body
      ? request.body.executionMode
      : "submit";
  const total = mode === "run" ? 1 : 2;
  return Effect.succeed({
    status: 200,
    body: {
      passed: total,
      total,
      failures: [],
      status: "passed",
      diagnostics: [],
      stdout: "",
      runtimeMs: 1,
    },
  });
});
function Journey({ kind }: { readonly kind: "coding" | "lua" }) {
  const activity: LearningActivity = {
    id: `fixture-${kind}`,
    areaId: "fixture-area",
    pluginId: `recall.${kind}`,
    pluginVersion: 1,
    revision: 1,
    title: kind === "lua" ? "Count to three" : "Add two numbers",
    objectiveIds: ["fixture-objective"],
    fallback: "Explain your solution aloud.",
    payload:
      kind === "lua"
        ? { script: "return {}", configuration: {}, seed: 1 }
        : {
            prompts: ["Add two integers."],
            reference: "Return a + b.",
            rubric: "Return the sum.",
            language: "javascript",
            starterCode: "function solve(a, b) { return a + b; }",
            tests: [
              { input: [1, 2], expected: 3 },
              { input: [-1, 1], expected: 0 },
            ],
            exampleTests: [{ input: [1, 2], expected: 3 }],
          },
  };
  const [library, setLibrary] = useState<ActivityLibrary>({
    ...emptyActivityLibrary,
    activities: [activity],
  });
  return (
    <>
      <LearningActivitiesPanel
        areaId="fixture-area"
        library={library}
        initialActivityId={activity.id}
        objectives={[{ id: "fixture-objective", title: "Practice" }]}
        services={services}
        createId={() => crypto.randomUUID()}
        onSave={(next) => {
          setLibrary(next);
          return Promise.resolve(true);
        }}
      />
      <p>Accepted attempts: {library.attempts.length}</p>
    </>
  );
}
const meta = { title: "Learning Activities/Assessment journey", component: Journey } satisfies Meta<
  typeof Journey
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Coding: Story = { args: { kind: "coding" } };
export const Lua: Story = { args: { kind: "lua" } };
