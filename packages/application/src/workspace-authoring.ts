import {
  RestoreCardVersionSchema,
  restoreCardVersion,
  cardVersionRestoresAsCopy,
} from "./card-history";
import {
  AreaIdSchema,
  AssessmentIdSchema,
  SchedulerSettingsSchema,
  WorkspaceSchema,
  type AreaId,
  type Workspace,
} from "@recall/domain";
import { Effect, Schema } from "effect";
import { newSchedule } from "@recall/scheduler";
import { captureCardVersion } from "./card-history";
import { authoredTagsValid } from "./tag-input";
import { CardProposalSchema } from "@recall/ai-core";
import { createObjectiveId } from "@recall/domain";
import { expandCloze } from "./cloze";
import { AreaDetailsSchema, deleteLearningArea, saveLearningArea } from "./area-management";
import { AreaSettingsSchema, updateAreaSettings } from "./area-settings";
import { updateSchedulerSettings } from "./scheduler-settings";
import {
  DeleteCardSchema,
  CardContentSchema,
  type CardContent,
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
  if (
    command.kind === "create-card" ||
    command.kind === "create-cards" ||
    (command.kind === "save-area" && command.mode === "create")
  )
    return undefined;
  const areaId = command.kind === "save-area" ? command.id : command.areaId;
  const area = workspace.areas.find((item) => item.id === areaId);
  if (
    command.kind === "bulk-tag-cards" ||
    command.kind === "bulk-delete-cards" ||
    command.kind === "bulk-move-cards"
  ) {
    const ids =
      command.kind === "bulk-move-cards"
        ? command.cards.map((card) => card.cardId)
        : command.cardIds;
    const target =
      command.kind === "bulk-move-cards"
        ? workspace.areas.find((item) => item.id === command.targetAreaId)
        : undefined;
    return JSON.stringify(
      canonical({
        owner: workspace.syncOwnerId ?? null,
        area: area ? { id: area.id, objectives: area.objectives ?? [] } : null,
        cards: [...new Set(ids)].sort().map((id) => {
          const card = area?.cards.find((item) => item.id === id);
          return card ? authoredCard(card) : null;
        }),
        target: target ? { id: target.id, objectives: target.objectives ?? [] } : null,
      }),
    );
  }
  if (command.kind === "restore-card") {
    const card = area?.cards.find((card) => card.id === command.cardId);
    return JSON.stringify(
      canonical({
        syncOwnerId: workspace.syncOwnerId ?? null,
        restoresAsCopy: cardVersionRestoresAsCopy(workspace, command.areaId, command.cardId),
        card: card ? authoredCard(card) : null,
        area: area ? { ...area, cards: undefined } : null,
        version:
          workspace.cardVersions?.find((version) => version.id === command.versionId) ?? null,
        deletedCards: workspace.deletedCards ?? [],
        deletedAreas: workspace.deletedAreas ?? [],
      }),
    );
  }
  if (!area) return JSON.stringify(null);
  if (
    command.kind === "update-card" ||
    command.kind === "delete-card" ||
    command.kind === "replace-card"
  ) {
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
            if (!authoredTagsValid(tags))
              return yield* Effect.fail(
                failure(
                  "invalid-input",
                  "A selected card would exceed the tag limits. No cards were changed.",
                ),
              );
            if (JSON.stringify(tags) === JSON.stringify(card.tags ?? [])) continue;
            next = captureCardVersion(next, area, card, "edit", now);
            next = {
              ...next,
              areas: next.areas.map((item) =>
                item.id === area.id
                  ? {
                      ...item,
                      cards: item.cards.map((entry) =>
                        entry.id === card.id ? { ...entry, tags } : entry,
                      ),
                    }
                  : item,
              ),
            };
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
              return yield* Effect.fail(
                failure(
                  "invalid-input",
                  "Choose a different deck with room for all selected cards.",
                ),
              );
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
              return yield* Effect.fail(
                failure(
                  "invalid-input",
                  "A destination card identifier has already been used. Try again.",
                ),
              );
            const schedule = yield* Effect.try({
              try: () => newSchedule(now),
              catch: () =>
                failure(
                  "invalid-input",
                  "New review schedules could not be created. No cards were moved.",
                ),
            });
            const moved = command.cards.flatMap((item) => {
              const original = area.cards.find((card) => card.id === item.cardId);
              if (!original) return [];
              const titles = (area.objectives ?? [])
                .filter(
                  (objective) =>
                    original.objectiveIds?.includes(objective.id) ||
                    original.objective === objective.title,
                )
                .map((objective) => objective.title);
              const objectives = (target.objectives ?? []).filter((objective) =>
                titles.includes(objective.title),
              );
              return [
                {
                  ...original,
                  id: item.newCardId,
                  schedule,
                  objectiveIds: objectives.map((objective) => objective.id),
                  objective:
                    objectives.map((objective) => objective.title).join(" · ") ||
                    original.objective,
                },
              ];
            });
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
