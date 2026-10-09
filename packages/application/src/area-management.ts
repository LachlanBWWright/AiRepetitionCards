import { captureCardVersion } from "./card-history";
import { retainReviewDeletionContent } from "./review-deletion-retention";
import { AreaIdSchema, WorkspaceSchema, type LearningArea, type Workspace } from "@recall/domain";
import { Effect, Schema } from "effect";

export const AreaDetailsSchema = Schema.Struct({
  mode: Schema.Union(Schema.Literal("create"), Schema.Literal("edit")),
  id: AreaIdSchema,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  color: Schema.String.pipe(Schema.pattern(/^#[0-9a-fA-F]{6}$/)),
});

export type AreaManagementFailure =
  | { readonly _tag: "AreaWorkspaceInvalid" }
  | { readonly _tag: "AreaDetailsInvalid" }
  | { readonly _tag: "AreaNotFound" }
  | { readonly _tag: "AreaIdentityAlreadyUsed" };

function decodeWorkspace(input: unknown): Effect.Effect<Workspace, AreaManagementFailure> {
  return Schema.decodeUnknown(WorkspaceSchema)(input).pipe(
    Effect.mapError(() => ({ _tag: "AreaWorkspaceInvalid" }) as const),
    Effect.flatMap((workspace) =>
      new Set(workspace.areas.map((area) => area.id)).size === workspace.areas.length
        ? Effect.succeed(workspace)
        : Effect.fail({ _tag: "AreaWorkspaceInvalid" } as const),
    ),
  );
}

/** Create an empty area or change its name/color while retaining all private learner state. */
export function saveLearningArea(
  workspaceInput: unknown,
  commandInput: unknown,
): Effect.Effect<Workspace, AreaManagementFailure> {
  return Effect.gen(function* () {
    const workspace = yield* decodeWorkspace(workspaceInput);
    const command = yield* Schema.decodeUnknown(AreaDetailsSchema)(commandInput).pipe(
      Effect.mapError(() => ({ _tag: "AreaDetailsInvalid" }) as const),
    );
    const title = command.title.trim();
    if (!title) return yield* Effect.fail({ _tag: "AreaDetailsInvalid" } as const);
    const existing = workspace.areas.find((area) => area.id === command.id);
    if (command.mode === "edit") {
      if (!existing) return yield* Effect.fail({ _tag: "AreaNotFound" } as const);
      return {
        ...workspace,
        areas: workspace.areas.map((area) =>
          area.id === command.id ? { ...area, title, color: command.color } : area,
        ),
      };
    }
    if (
      existing ||
      workspace.retainedReviewAreas?.some((area) => area.id === command.id) ||
      workspace.deletedAreas?.some((area) => area.areaId === command.id) ||
      workspace.reviewEvents?.some((event) => event.areaId === command.id) ||
      workspace.syncContentHashes?.[command.id]
    )
      return yield* Effect.fail({ _tag: "AreaIdentityAlreadyUsed" } as const);
    const area: LearningArea = { id: command.id, title, color: command.color, cards: [] };
    return { ...workspace, areas: [...workspace.areas, area] };
  });
}

export type AreaDeletionResult = {
  readonly workspace: Workspace;
  readonly removedArea: LearningArea;
  readonly requiresSync: boolean;
};

/** Delete active content; append-only reviews and their pending/conflict identities remain private. */
export function deleteLearningArea(
  workspaceInput: unknown,
  areaIdInput: unknown,
  now: Date = new Date(),
): Effect.Effect<AreaDeletionResult, AreaManagementFailure> {
  return Effect.gen(function* () {
    const workspace = yield* decodeWorkspace(workspaceInput);
    const areaId = yield* Schema.decodeUnknown(AreaIdSchema)(areaIdInput).pipe(
      Effect.mapError(() => ({ _tag: "AreaDetailsInvalid" }) as const),
    );
    const removedArea = workspace.areas.find((area) => area.id === areaId);
    if (!removedArea) {
      const retained = workspace.retainedReviewAreas?.find((area) => area.id === areaId);
      if (retained && workspace.deletedAreas?.some((area) => area.areaId === areaId))
        return { workspace, removedArea: retained, requiresSync: true };
      return yield* Effect.fail({ _tag: "AreaNotFound" } as const);
    }
    if (!Number.isFinite(now.getTime()))
      return yield* Effect.fail({ _tag: "AreaDetailsInvalid" } as const);
    const captured = removedArea.cards.reduce(
      (current, card) => captureCardVersion(current, removedArea, card, "delete", now),
      workspace,
    );
    const baseContentHash = workspace.syncContentHashes?.[areaId];
    const deletedAreas = [
      ...(workspace.deletedAreas ?? []).filter((area) => area.areaId !== areaId),
      { areaId, ...(baseContentHash ? { baseContentHash } : {}) },
    ];
    const retainedWorkspace = yield* retainReviewDeletionContent(
      {
        ...captured,
        areas: workspace.areas.filter((area) => area.id !== areaId),
        deletedCards: (workspace.deletedCards ?? []).filter((card) => card.areaId !== areaId),
        deletedAreas,
      },
      removedArea,
      removedArea.cards.map((card) => card.id),
    ).pipe(Effect.mapError(() => ({ _tag: "AreaWorkspaceInvalid" }) as const));
    return { removedArea, requiresSync: true, workspace: retainedWorkspace };
  });
}
