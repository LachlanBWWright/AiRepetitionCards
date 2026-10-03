import {
  AreaIdSchema,
  SchedulerSettingsSchema,
  WorkspaceSchema,
  type AreaId,
  type Workspace,
} from "@recall/domain";
import { Effect, Schema } from "effect";
import { AreaDetailsSchema, deleteLearningArea, saveLearningArea } from "./area-management";
import { AreaSettingsSchema, updateAreaSettings } from "./area-settings";
import { updateSchedulerSettings } from "./scheduler-settings";
import {
  DeleteCardSchema,
  SaveCardSchema,
  createStudyCard,
  deleteStudyCard,
  updateStudyCard,
} from "./card-management";

export const WorkspaceAuthoringCommandSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("update-scheduler-settings"),
    settings: SchedulerSettingsSchema,
  }),
  Schema.Struct({ kind: Schema.Literal("save-area"), ...AreaDetailsSchema.fields }),
  Schema.Struct({ kind: Schema.Literal("delete-area"), areaId: AreaIdSchema }),
  Schema.Struct({ kind: Schema.Literal("create-card"), ...SaveCardSchema.fields }),
  Schema.Struct({ kind: Schema.Literal("update-card"), ...SaveCardSchema.fields }),
  Schema.Struct({ kind: Schema.Literal("delete-card"), ...DeleteCardSchema.fields }),
  Schema.Struct({
    kind: Schema.Literal("update-area-settings"),
    areaId: AreaIdSchema,
    settings: AreaSettingsSchema,
  }),
);
export type WorkspaceAuthoringCommand = typeof WorkspaceAuthoringCommandSchema.Type;
export type WorkspaceAuthoringFailure = {
  readonly _tag: "WorkspaceAuthoringFailure";
  readonly reason: "invalid-input" | "stale-content" | "authoring-rejected";
  readonly message: string;
};
export type WorkspaceAuthoringResult = {
  readonly workspace: Workspace;
  readonly selectedAreaId?: AreaId;
  readonly message: string;
};
const failure = (
  reason: WorkspaceAuthoringFailure["reason"],
  message: string,
): WorkspaceAuthoringFailure => ({ _tag: "WorkspaceAuthoringFailure", reason, message });

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => canonical(item));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
function authoredCard(card: Workspace["areas"][number]["cards"][number]): unknown {
  return Object.fromEntries(Object.entries(card).filter(([key]) => key !== "schedule"));
}
/** Content baseline deliberately excludes derived scheduling and append-only review changes. */
export function workspaceAuthoringBaseline(
  workspace: Workspace,
  command: WorkspaceAuthoringCommand,
): string | undefined {
  if (command.kind === "update-scheduler-settings")
    return JSON.stringify(canonical(workspace.schedulerSettings ?? { requestRetention: 0.9 }));
  if (command.kind === "create-card" || (command.kind === "save-area" && command.mode === "create"))
    return undefined;
  const areaId = command.kind === "save-area" ? command.id : command.areaId;
  const area = workspace.areas.find((item) => item.id === areaId);
  if (!area) return JSON.stringify(null);
  if (command.kind === "update-card" || command.kind === "delete-card") {
    const card = area.cards.find((item) => item.id === command.cardId);
    return JSON.stringify(
      canonical({ card: card ? authoredCard(card) : null, objectives: area.objectives ?? [] }),
    );
  }
  return JSON.stringify(canonical({ ...area, cards: area.cards.map(authoredCard) }));
}

function authoringFailure(error: unknown): WorkspaceAuthoringFailure {
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

/** Apply validated authoring to the caller's latest workspace; persistence is a platform port. */
export function applyWorkspaceAuthoringCommand(
  workspaceInput: unknown,
  commandInput: unknown,
  now: Date,
  expectedBaseline?: string,
): Effect.Effect<WorkspaceAuthoringResult, WorkspaceAuthoringFailure> {
  return Effect.gen(function* () {
    const workspace = yield* Schema.decodeUnknown(WorkspaceSchema)(workspaceInput).pipe(
      Effect.mapError(() => failure("invalid-input", "This workspace contains invalid data.")),
    );
    const command = yield* Schema.decodeUnknown(WorkspaceAuthoringCommandSchema)(commandInput).pipe(
      Effect.mapError(() =>
        failure("invalid-input", "Check this change's content and identifiers."),
      ),
    );
    if (
      expectedBaseline !== undefined &&
      workspaceAuthoringBaseline(workspace, command) !== expectedBaseline
    )
      return yield* Effect.fail(
        failure(
          "stale-content",
          "This content changed while you were editing. Reopen it to review the latest version before saving.",
        ),
      );
    if (command.kind === "update-scheduler-settings") {
      const next = yield* updateSchedulerSettings(workspace, command.settings).pipe(
        Effect.mapError(authoringFailure),
      );
      return { workspace: next, message: "Target retention saved for future reviews." };
    }
    const areaId = command.kind === "save-area" ? command.id : command.areaId;
    switch (command.kind) {
      case "save-area": {
        const next = yield* saveLearningArea(workspace, command).pipe(
          Effect.mapError(authoringFailure),
        );
        return {
          workspace: next,
          selectedAreaId: areaId,
          message:
            command.mode === "create" ? "Knowledge area created." : "Knowledge area updated.",
        };
      }
      case "delete-area": {
        const result = yield* deleteLearningArea(workspace, areaId).pipe(
          Effect.mapError(authoringFailure),
        );
        const selectedAreaId = result.workspace.areas[0]?.id;
        return {
          workspace: result.workspace,
          ...(selectedAreaId ? { selectedAreaId } : {}),
          message: "Knowledge area deleted. Review history is preserved.",
        };
      }
      case "create-card": {
        const next = yield* createStudyCard(workspace, command, now).pipe(
          Effect.mapError(authoringFailure),
        );
        return { workspace: next, selectedAreaId: areaId, message: "Card created." };
      }
      case "update-card": {
        const next = yield* updateStudyCard(workspace, command).pipe(
          Effect.mapError(authoringFailure),
        );
        return { workspace: next, selectedAreaId: areaId, message: "Card updated." };
      }
      case "delete-card": {
        const next = yield* deleteStudyCard(workspace, command).pipe(
          Effect.mapError(authoringFailure),
        );
        return {
          workspace: next,
          selectedAreaId: areaId,
          message: "Card deleted. Review history is preserved.",
        };
      }
      case "update-area-settings": {
        const area = workspace.areas.find((item) => item.id === areaId);
        if (!area)
          return yield* Effect.fail(
            failure("authoring-rejected", "This knowledge area no longer exists."),
          );
        const updated = yield* updateAreaSettings(area, command.settings).pipe(
          Effect.mapError(authoringFailure),
        );
        return {
          workspace: {
            ...workspace,
            areas: workspace.areas.map((item) => (item.id === areaId ? updated : item)),
          },
          selectedAreaId: areaId,
          message: "Area settings saved.",
        };
      }
    }
  });
}
