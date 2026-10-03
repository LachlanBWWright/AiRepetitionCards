import { retainReviewDeletionContent } from "./review-deletion-retention";
import { Effect, Schema } from "effect";
import {
  AreaIdSchema,
  CardIdSchema,
  ClozeContentSchema,
  MediaReferenceSchema,
  ObjectiveIdSchema,
  WorkspaceSchema,
  type LearningArea,
  type StudyCard,
  type Workspace,
} from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { renderCloze } from "./cloze";
import { authoredTagsValid, tagsUnchanged } from "./tag-input";

export const CardContentSchema = Schema.Struct({
  kind: Schema.Union(Schema.Literal("basic"), Schema.Literal("cloze")),
  front: Schema.String,
  back: Schema.String,
  cloze: Schema.optional(ClozeContentSchema),
  objectiveIds: Schema.Array(ObjectiveIdSchema),
  tags: Schema.Array(Schema.String),
  media: Schema.Array(MediaReferenceSchema),
});
export const SaveCardSchema = Schema.Struct({
  areaId: AreaIdSchema,
  cardId: CardIdSchema,
  content: CardContentSchema,
});
export const DeleteCardSchema = Schema.Struct({ areaId: AreaIdSchema, cardId: CardIdSchema });
export type CardContent = typeof CardContentSchema.Type;
export type CardManagementFailure = {
  readonly _tag: "CardManagementFailure";
  readonly reason: "invalid-input" | "area-missing" | "card-missing" | "duplicate-card";
  readonly message: string;
};
const failure = (
  reason: CardManagementFailure["reason"],
  message: string,
): CardManagementFailure => ({ _tag: "CardManagementFailure", reason, message });
const decodeWorkspace = (input: unknown) =>
  Schema.decodeUnknown(WorkspaceSchema)(input).pipe(
    Effect.mapError(() => failure("invalid-input", "This workspace contains invalid data.")),
  );

function prepareContent(area: LearningArea, input: CardContent, previous?: StudyCard) {
  return Effect.gen(function* () {
    const tags = input.tags;
    if (!tagsUnchanged(tags, previous?.tags ?? []) && !authoredTagsValid(tags)) {
      return yield* Effect.fail(
        failure("invalid-input", "Use up to 100 nonblank tags, each at most 80 characters long."),
      );
    }
    if (input.media.length > 20) {
      return yield* Effect.fail(
        failure(
          "invalid-input",
          "A card can have up to 20 attachments. Remove one before adding another.",
        ),
      );
    }
    if (new Set(input.media.map((reference) => reference.id)).size !== input.media.length) {
      return yield* Effect.fail(failure("invalid-input", "Choose each attachment only once."));
    }
    const objectiveIds = [...new Set(input.objectiveIds)];
    const available = new Set((area.objectives ?? []).map((objective) => objective.id));
    if (objectiveIds.some((id) => !available.has(id))) {
      return yield* Effect.fail(
        failure("invalid-input", "A selected learning objective no longer exists."),
      );
    }
    const objectives = (area.objectives ?? []).filter((objective) =>
      objectiveIds.includes(objective.id),
    );
    const rendered =
      input.kind === "cloze"
        ? yield* renderCloze(input.cloze?.text, input.cloze?.deletionIndex).pipe(
            Effect.mapError(() =>
              failure(
                "invalid-input",
                "Use a valid deletion such as {{c1::ATP::energy molecule}} and select an index present in the text.",
              ),
            ),
          )
        : undefined;
    const front = rendered?.front ?? input.front.trim();
    const back = rendered?.back ?? input.back.trim();
    if (!front || !back) {
      return yield* Effect.fail(failure("invalid-input", "Write both a question and an answer."));
    }
    return {
      front,
      back,
      cloze: rendered ? { text: rendered.text, deletionIndex: rendered.deletionIndex } : undefined,
      objectiveIds: objectives.map((objective) => objective.id),
      objective:
        objectives.map((objective) => objective.title).join(" · ") ||
        ((area.objectives?.length ?? 0) === 0 ? previous?.objective : undefined) ||
        "My learning goals",
      tags,
      media: input.media,
    };
  });
}

/** Author a card using caller-supplied identity and time; no platform or provider dependencies. */
export function createStudyCard(workspaceInput: unknown, commandInput: unknown, now: Date) {
  return Effect.gen(function* () {
    const workspace = yield* decodeWorkspace(workspaceInput);
    const command = yield* Schema.decodeUnknown(SaveCardSchema)(commandInput).pipe(
      Effect.mapError(() => failure("invalid-input", "Check this card's content and attachments.")),
    );
    const area = workspace.areas.find((candidate) => candidate.id === command.areaId);
    if (!area)
      return yield* Effect.fail(failure("area-missing", "This knowledge area no longer exists."));
    if (
      workspace.areas.some((candidate) =>
        candidate.cards.some((card) => card.id === command.cardId),
      ) ||
      workspace.retainedReviewAreas?.some((area) =>
        area.cards.some((card) => card.id === command.cardId),
      ) ||
      workspace.deletedCards?.some((card) => card.cardId === command.cardId) ||
      workspace.reviewEvents?.some((event) => event.cardId === command.cardId)
    ) {
      return yield* Effect.fail(failure("duplicate-card", "This card ID has already been used."));
    }
    if (area.cards.length >= 500) {
      return yield* Effect.fail(
        failure(
          "invalid-input",
          "A Knowledge Area can have up to 500 cards. Create another area to continue.",
        ),
      );
    }
    if (!Number.isFinite(now.getTime())) {
      return yield* Effect.fail(failure("invalid-input", "The card's creation time is invalid."));
    }
    const content = yield* prepareContent(area, command.content);
    const schedule = yield* Effect.try({
      try: () => newSchedule(now),
      catch: () => failure("invalid-input", "This card's schedule could not be created."),
    });
    const card: StudyCard = { id: command.cardId, ...content, origin: "authored", schedule };
    return {
      ...workspace,
      areas: workspace.areas.map((candidate) =>
        candidate.id === area.id ? { ...candidate, cards: [...candidate.cards, card] } : candidate,
      ),
    } satisfies Workspace;
  });
}

/** Edit content while retaining identity, schedule, origin and source lineage. */
export function updateStudyCard(workspaceInput: unknown, commandInput: unknown) {
  return Effect.gen(function* () {
    const workspace = yield* decodeWorkspace(workspaceInput);
    const command = yield* Schema.decodeUnknown(SaveCardSchema)(commandInput).pipe(
      Effect.mapError(() => failure("invalid-input", "Check this card's content and attachments.")),
    );
    const area = workspace.areas.find((candidate) => candidate.id === command.areaId);
    if (!area)
      return yield* Effect.fail(failure("area-missing", "This knowledge area no longer exists."));
    const card = area.cards.find((candidate) => candidate.id === command.cardId);
    if (!card) return yield* Effect.fail(failure("card-missing", "This card no longer exists."));
    const content = yield* prepareContent(area, command.content, card);
    return {
      ...workspace,
      areas: workspace.areas.map((candidate) =>
        candidate.id === area.id
          ? {
              ...candidate,
              cards: candidate.cards.map((item) =>
                item.id === card.id ? { ...item, ...content } : item,
              ),
            }
          : candidate,
      ),
    } satisfies Workspace;
  });
}

/** Remove active content and retain append-only reviews and a sync deletion tombstone. */
export function deleteStudyCard(workspaceInput: unknown, commandInput: unknown) {
  return Effect.gen(function* () {
    const workspace = yield* decodeWorkspace(workspaceInput);
    const command = yield* Schema.decodeUnknown(DeleteCardSchema)(commandInput).pipe(
      Effect.mapError(() => failure("invalid-input", "This card could not be identified.")),
    );
    const area = workspace.areas.find((candidate) => candidate.id === command.areaId);
    if (
      workspace.deletedCards?.some(
        (item) => item.areaId === command.areaId && item.cardId === command.cardId,
      ) &&
      !area?.cards.some((card) => card.id === command.cardId)
    )
      return workspace;
    if (!area)
      return yield* Effect.fail(failure("area-missing", "This knowledge area no longer exists."));
    if (!area.cards.some((card) => card.id === command.cardId)) {
      return yield* Effect.fail(failure("card-missing", "This card no longer exists."));
    }
    const next = {
      ...workspace,
      deletedCards: [
        ...(workspace.deletedCards ?? []).filter(
          (item) => item.areaId !== area.id || item.cardId !== command.cardId,
        ),
        { areaId: area.id, cardId: command.cardId },
      ],
      areas: workspace.areas.map((candidate) =>
        candidate.id === area.id
          ? { ...candidate, cards: candidate.cards.filter((card) => card.id !== command.cardId) }
          : candidate,
      ),
    } satisfies Workspace;
    return yield* retainReviewDeletionContent(next, area, [command.cardId]).pipe(
      Effect.mapError(() =>
        failure("invalid-input", "The deleted review content could not be retained safely."),
      ),
    );
  });
}
