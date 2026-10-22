"use client";

import { useState } from "react";
import { Effect, Either } from "effect";
import type { LearningArea, Workspace } from "@recall/domain";
import { searchStudyCards, prepareManualSchedulingCommand } from "@recall/application";
import { useStudyCommand, type StudyCommandSave } from "./use-study-command";
export function useManualScheduling({
  workspace,
  area,
  now,
  save,
  createId,
  dueInput,
}: {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly now: number;
  readonly save: StudyCommandSave | undefined;
  readonly createId: () => Effect.Effect<string, { readonly message: string }>;
  readonly dueInput: "local" | "zoned";
}) {
  const [query, setQuery] = useState("");
  const [due, setDue] = useState("");
  const [position, setPosition] = useState("0");
  const [error, setError] = useState("");
  const controls = useStudyCommand(workspace, save);
  const matches = Effect.runSync(Effect.either(searchStudyCards(workspace, query, now, area.id)));
  const cards = Either.isRight(matches) ? matches.right.map(({ card }) => card) : [];
  const apply = (action: "due" | "reset" | "reposition") => {
    const program = Effect.gen(function* () {
      const operationId = yield* createId();
      const timestamp = Date.parse(due);
      if (
        action === "due" &&
        (!Number.isFinite(timestamp) ||
          (dueInput === "zoned" && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(due)))
      )
        return yield* Effect.fail({
          message:
            dueInput === "zoned"
              ? "Choose a valid due date with an explicit time zone."
              : "Choose a valid date and time.",
        });
      return yield* prepareManualSchedulingCommand({
        kind: "administer-cards",
        areaId: area.id,
        cardIds: cards.map((card) => card.id),
        operationId,
        action,
        ...(action === "due" ? { due: new Date(timestamp).toISOString() } : {}),
        ...(action === "reposition" ? { position } : {}),
      });
    });
    const command = Effect.runSync(Effect.either(program));
    if (Either.isLeft(command)) {
      setError(command.left.message);
      return;
    }
    setError("");
    controls.commit(command.right, "Scheduling updated. Answer history is preserved.");
  };
  return {
    query,
    setQuery,
    due,
    setDue,
    position,
    setPosition,
    error,
    controls,
    matches,
    cards,
    apply,
  };
}
