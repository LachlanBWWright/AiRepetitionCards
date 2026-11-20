import { useMemo, useState } from "react";
import { Effect, Either } from "effect";
import { createAssessmentId } from "@recall/domain";
import {
  applyWorkspaceAuthoringCommand,
  type WorkspaceAuthoringCommand,
} from "@recall/application";
import { api, initial, now, original } from "./fixtures";
export type RepairScenario = "default" | "duplicates" | "error" | "slow" | "readonly";
export function useReviewRepairPreview(scenario: RepairScenario) {
  const [workspace, setWorkspace] = useState(() =>
    scenario === "duplicates"
      ? {
          ...initial,
          areas: initial.areas.map((area) => ({
            ...area,
            cards: [
              ...area.cards,
              {
                ...original,
                id: createAssessmentId("existing-prerequisite"),
                front: "What do mitochondria produce?",
                back: "ATP through cellular respiration.",
              },
            ],
          })),
        }
      : initial,
  );
  const [paused, setPaused] = useState(false);
  const previewApi = useMemo(
    () => ({
      ...api,
      request: (input: Parameters<typeof api.request>[0]) =>
        scenario === "error"
          ? Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" } as const)
          : api.request(input).pipe(Effect.delay(scenario === "slow" ? "1500 millis" : "0 millis")),
    }),
    [scenario],
  );
  const save = (command: WorkspaceAuthoringCommand, baseline?: string) =>
    applyWorkspaceAuthoringCommand(workspace, command, now, baseline).pipe(
      Effect.tap(({ workspace: next }) =>
        Effect.sync(() => {
          setWorkspace(next);
        }),
      ),
      Effect.mapError((error) => ({ message: error.message })),
    );
  const nativeSave = async (command: WorkspaceAuthoringCommand, baseline?: string) => {
    const result = await Effect.runPromise(Effect.either(save(command, baseline)));
    return Either.isRight(result)
      ? { ok: true, message: "Saved." }
      : { ok: false, message: result.left.message };
  };
  return {
    workspace,
    area: workspace.areas[0],
    paused,
    setPaused,
    api: previewApi,
    save,
    nativeSave,
    original,
  };
}
