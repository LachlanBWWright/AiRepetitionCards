import {
  RestoreCardVersionSchema,
  restoreCardVersion,
  cardVersionRestoresAsCopy,
} from "../card-history";
import {
  AreaIdSchema,
  AssessmentIdSchema,
  SchedulerSettingsSchema,
  WorkspaceSchema,
  type AreaId,
  type Workspace,
} from "@recall/domain";
import { Effect, Schema } from "effect";
import { authoringFailure, failure } from "./workspace-authoring-validation";
export { refinementCardContent } from "./workspace-authoring-validation";
export type { WorkspaceAuthoringFailure } from "./workspace-authoring-validation";
import type { WorkspaceAuthoringFailure } from "./workspace-authoring-validation";
import { newSchedule } from "@recall/scheduler";
import { captureCardVersion } from "../card-history";
import { authoredTagsValid } from "./tag-input";
import { AreaDetailsSchema, deleteLearningArea, saveLearningArea } from "./area-management";
import { AreaSettingsSchema, updateAreaSettings } from "./area-settings";
import { updateSchedulerSettings } from "../review/scheduler-settings";
import {
  DeleteCardSchema,
  CardContentSchema,
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
  Schema.Struct({
    kind: Schema.Literal("create-cards"),
    areaId: AreaIdSchema,
    cards: Schema.Array(
      Schema.Struct({ cardId: AssessmentIdSchema, content: CardContentSchema }),
    ).pipe(Schema.minItems(1), Schema.maxItems(5)),
  }),
  Schema.Struct({ kind: Schema.Literal("update-card"), ...SaveCardSchema.fields }),
  Schema.Struct({ kind: Schema.Literal("delete-card"), ...DeleteCardSchema.fields }),
  Schema.Struct({
    kind: Schema.Literal("bulk-tag-cards"),
    areaId: AreaIdSchema,
    cardIds: Schema.Array(AssessmentIdSchema).pipe(Schema.minItems(1), Schema.maxItems(500)),
    tags: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("bulk-delete-cards"),
    areaId: AreaIdSchema,
    cardIds: Schema.Array(AssessmentIdSchema).pipe(Schema.minItems(1), Schema.maxItems(500)),
  }),
  Schema.Struct({
    kind: Schema.Literal("bulk-move-cards"),
    areaId: AreaIdSchema,
    targetAreaId: AreaIdSchema,
    cards: Schema.Array(
      Schema.Struct({ cardId: AssessmentIdSchema, newCardId: AssessmentIdSchema }),
    ).pipe(Schema.minItems(1), Schema.maxItems(500)),
  }),
  Schema.Struct({ kind: Schema.Literal("restore-card"), ...RestoreCardVersionSchema.fields }),
  Schema.Struct({
    kind: Schema.Literal("replace-card"),
    ...DeleteCardSchema.fields,
    cards: Schema.Array(
      Schema.Struct({ cardId: AssessmentIdSchema, content: CardContentSchema }),
    ).pipe(Schema.minItems(1), Schema.maxItems(5)),
  }),
  Schema.Struct({
    kind: Schema.Literal("update-area-settings"),
    areaId: AreaIdSchema,
    settings: AreaSettingsSchema,
  }),
);
export type WorkspaceAuthoringCommand = typeof WorkspaceAuthoringCommandSchema.Type;
export type WorkspaceAuthoringResult = {
  readonly workspace: Workspace;
  readonly selectedAreaId?: AreaId;
  readonly message: string;
};

export { workspaceAuthoringBaseline } from "./workspace-authoring-baseline";
import { workspaceAuthoringBaseline } from "./workspace-authoring-baseline";

function updateCardTags(
  workspace: Workspace,
  area: Workspace["areas"][number],
  cardId: string,
  tags: readonly string[],
): Workspace {
  return {
    ...workspace,
    areas: workspace.areas.map((item) =>
      item.id === area.id
        ? {
            ...item,
            cards: item.cards.map((entry) =>
              entry.id === cardId ? { ...entry, tags: [...tags] } : entry,
            ),
          }
        : item,
    ),
  };
}

function cardsMovedToArea(
  source: Workspace["areas"][number],
  target: Workspace["areas"][number],
  moves: readonly {
    readonly cardId: Workspace["areas"][number]["cards"][number]["id"];
    readonly newCardId: Workspace["areas"][number]["cards"][number]["id"];
  }[],
  schedule: Workspace["areas"][number]["cards"][number]["schedule"],
) {
  return moves.flatMap((move) => {
    const original = source.cards.find((card) => card.id === move.cardId);
    if (!original) return [];
    const titles = (source.objectives ?? [])
      .filter(
        (objective) =>
          original.objectiveIds?.includes(objective.id) || original.objective === objective.title,
      )
      .map((objective) => objective.title);
    const objectives = (target.objectives ?? []).filter((objective) =>
      titles.includes(objective.title),
    );
    return [
      {
        ...original,
        id: move.newCardId,
        schedule,
        objectiveIds: objectives.map((objective) => objective.id),
        objective: objectives.map((objective) => objective.title).join(" · ") || original.objective,
      },
    ];
  });
}

const rejectBulkTagOverflow = () =>
  Effect.fail(
    failure("invalid-input", "A selected card would exceed the tag limits. No cards were changed."),
  );
const rejectBulkMoveTarget = () =>
  Effect.fail(
    failure("invalid-input", "Choose a different deck with room for all selected cards."),
  );
const rejectUsedDestinationId = () =>
  Effect.fail(
    failure("invalid-input", "A destination card identifier has already been used. Try again."),
  );
const rejectBulkScheduleFailure = () =>
  failure("invalid-input", "New review schedules could not be created. No cards were moved.");

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
          command.kind === "bulk-tag-cards" ||
            command.kind === "bulk-move-cards" ||
            command.kind === "bulk-delete-cards"
            ? "Some selected cards changed. No new bulk changes were applied. Cancel the action, review the selection, then try again."
            : "This content changed while you were editing. Reopen it to review the latest version before saving.",
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
      case "bulk-tag-cards":
      case "bulk-delete-cards":
      case "bulk-move-cards": {
        const area = workspace.areas.find((item) => item.id === areaId);
        const ids =
          command.kind === "bulk-move-cards"
            ? command.cards.map((item) => item.cardId)
            : command.cardIds;
        if (
          !area ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => !area.cards.some((card) => card.id === id)) ||
          !Number.isFinite(now.getTime())
        )
          return yield* Effect.fail(
            failure(
              "authoring-rejected",
              "The selection changed. Review the selected cards before trying again.",
            ),
          );
        let next = workspace;
        if (command.kind === "bulk-tag-cards") {
          if (!authoredTagsValid(command.tags))
            return yield* Effect.fail(
              failure(
                "invalid-input",
                "Use up to 100 nonblank tags of at most 80 characters each.",
              ),
            );
          for (const card of area.cards.filter((item) => ids.includes(item.id))) {
            const tags = [...new Set([...(card.tags ?? []), ...command.tags])];
            if (!authoredTagsValid(tags)) return yield* rejectBulkTagOverflow();
            if (JSON.stringify(tags) === JSON.stringify(card.tags ?? [])) continue;
            next = captureCardVersion(next, area, card, "edit", now);
            next = updateCardTags(next, area, card.id, tags);
          }
        } else {
          if (command.kind === "bulk-move-cards") {
            const target = next.areas.find((item) => item.id === command.targetAreaId);
            if (
              !target ||
              target.id === area.id ||
              target.cards.length + ids.length > 500 ||
              new Set(command.cards.map((item) => item.newCardId)).size !== ids.length
            )
              return yield* rejectBulkMoveTarget();
            const used = new Set([
              ...workspace.areas.flatMap((item) => item.cards.map((card) => card.id)),
              ...(workspace.retainedReviewAreas ?? []).flatMap((item) =>
                item.cards.map((card) => card.id),
              ),
              ...(workspace.deletedCards ?? []).map((item) => item.cardId),
              ...(workspace.cardVersions ?? []).map((item) => item.cardId),
              ...(workspace.reviewEvents ?? []).map((item) => item.cardId),
            ]);
            if (command.cards.some((item) => used.has(item.newCardId)))
              return yield* rejectUsedDestinationId();
            const schedule = yield* Effect.try({
              try: () => newSchedule(now),
              catch: rejectBulkScheduleFailure,
            });
            const moved = cardsMovedToArea(area, target, command.cards, schedule);
            next = {
              ...next,
              areas: next.areas.map((item) =>
                item.id === target.id ? { ...item, cards: [...item.cards, ...moved] } : item,
              ),
            };
          }
          for (const cardId of ids)
            next = yield* deleteStudyCard(next, { areaId, cardId }, now).pipe(
              Effect.mapError(authoringFailure),
            );
        }
        return {
          workspace: next,
          selectedAreaId: areaId,
          message:
            command.kind === "bulk-tag-cards"
              ? "Tags added to selected cards."
              : command.kind === "bulk-delete-cards"
                ? "Selected cards deleted. History is preserved; recover them in Deleted cards."
                : "Cards moved with fresh schedules. Original history is preserved in Deleted cards.",
        };
      }
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
        const result = yield* deleteLearningArea(workspace, areaId, now).pipe(
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
      case "create-cards": {
        let next = workspace;
        for (const card of command.cards) {
          next = yield* createStudyCard(next, { ...card, areaId }, now).pipe(
            Effect.mapError(authoringFailure),
          );
        }
        return {
          workspace: next,
          selectedAreaId: areaId,
          message: "Cards created with fresh schedules.",
        };
      }
      case "restore-card": {
        const next = yield* restoreCardVersion(workspace, command, now).pipe(
          Effect.mapError(authoringFailure),
        );
        const copied = cardVersionRestoresAsCopy(workspace, command.areaId, command.cardId);
        const selectedAreaId = next.cardVersions?.at(-1)?.areaId;
        return {
          workspace: next,
          ...(selectedAreaId ? { selectedAreaId } : {}),
          message: copied
            ? "Card recovered as a new copy with a fresh schedule. Original review history is preserved."
            : "Card version restored. Review history is preserved.",
        };
      }
      case "update-card": {
        const next = yield* updateStudyCard(workspace, command, now).pipe(
          Effect.mapError(authoringFailure),
        );
        return { workspace: next, selectedAreaId: areaId, message: "Card updated." };
      }
      case "delete-card": {
        const next = yield* deleteStudyCard(workspace, command, now).pipe(
          Effect.mapError(authoringFailure),
        );
        return {
          workspace: next,
          selectedAreaId: areaId,
          message: "Card deleted. Review history is preserved.",
        };
      }
      case "replace-card": {
        // Compose against an immutable snapshot; callers persist only the complete result.
        let next = yield* deleteStudyCard(workspace, command, now, "replace").pipe(
          Effect.mapError(authoringFailure),
        );
        for (const replacement of command.cards) {
          next = yield* createStudyCard(next, { ...replacement, areaId }, now).pipe(
            Effect.mapError(authoringFailure),
          );
        }
        return {
          workspace: next,
          selectedAreaId: areaId,
          message:
            "Replacement cards created with fresh schedules. Original review history is preserved.",
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
