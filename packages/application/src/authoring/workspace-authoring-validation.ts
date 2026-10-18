import { CardProposalSchema } from "@recall/ai-core";
import { createObjectiveId } from "@recall/domain";
import { Effect, Schema } from "effect";
import { expandCloze } from "./cloze";
import type { CardContent } from "./card-management";

export type WorkspaceAuthoringFailure = {
  readonly _tag: "WorkspaceAuthoringFailure";
  readonly reason: "invalid-input" | "stale-content" | "authoring-rejected";
  readonly message: string;
};
export const failure = (
  reason: WorkspaceAuthoringFailure["reason"],
  message: string,
): WorkspaceAuthoringFailure => ({ _tag: "WorkspaceAuthoringFailure", reason, message });

/** Convert validated AI text to authored content, preserving caller-selected metadata. */
export function refinementCardContent(
  input: unknown,
  metadata: Pick<CardContent, "tags" | "media" | "objectiveIds">,
): Effect.Effect<CardContent, WorkspaceAuthoringFailure> {
  return Effect.gen(function* () {
    const card = yield* Schema.decodeUnknown(CardProposalSchema)(input).pipe(
      Effect.mapError(() => failure("invalid-input", "The proposed card could not be validated.")),
    );
    const cloze = card.front.includes("{{c")
      ? yield* expandCloze(card.front).pipe(
          Effect.mapError(() => failure("invalid-input", "The proposed cloze syntax is invalid.")),
        )
      : [];
    if (cloze.length > 1)
      return yield* Effect.fail(
        failure("invalid-input", "Use one deletion number per proposed cloze card."),
      );
    const first = cloze[0];
    return {
      ...metadata,
      objectiveIds: card.objectiveId
        ? [createObjectiveId(card.objectiveId)]
        : metadata.objectiveIds,
      kind: first ? "cloze" : "basic",
      front: first?.front ?? card.front,
      back: first?.back ?? card.back,
      ...(first ? { cloze: { text: first.text, deletionIndex: first.deletionIndex } } : {}),
    };
  });
}

export function authoringFailure(error: unknown): WorkspaceAuthoringFailure {
  if (error !== null && typeof error === "object") {
    if ("message" in error && typeof error.message === "string")
      return failure("authoring-rejected", error.message);
    if ("_tag" in error)
      switch (error._tag) {
        case "AreaNotFound":
          return failure("authoring-rejected", "This knowledge area no longer exists.");
        case "AreaIdentityAlreadyUsed":
          return failure(
            "authoring-rejected",
            "This area identity has already been used. Create a fresh area instead.",
          );
        case "AreaDetailsInvalid":
          return failure(
            "authoring-rejected",
            "Give the area a title of up to 80 characters and a valid color.",
          );
      }
  }
  return failure(
    "authoring-rejected",
    "This change could not be validated. Your existing workspace remains available.",
  );
}
