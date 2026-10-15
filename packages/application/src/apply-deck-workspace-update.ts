import { Effect, Either, Schema } from "effect";
import {
  KnowledgeAreaSchema,
  WorkspaceSchema,
  type Assessment,
  type KnowledgeArea,
  type LearningArea,
  type Workspace,
} from "@recall/domain";
import { fromKnowledgeArea, toKnowledgeArea } from "./knowledge-area-interchange";
import { captureCardVersion } from "./card-history";
import { publicationContentHash } from "./publication-content-hash";
import { retainPublishedActivityDefinitions } from "./published-activity-library";

export type ApplyDeckWorkspaceUpdateFailure = {
  readonly _tag: "ApplyDeckWorkspaceUpdateFailure";
  readonly reason:
    | "invalid-input"
    | "area-missing"
    | "lineage-mismatch"
    | "stale-content"
    | "identity-collision"
    | "invalid-update";
};

const failure = (
  reason: ApplyDeckWorkspaceUpdateFailure["reason"],
): ApplyDeckWorkspaceUpdateFailure => ({
  _tag: "ApplyDeckWorkspaceUpdateFailure",
  reason,
});

const CommandSchema = Schema.Struct({
  workspace: WorkspaceSchema,
  updatedArea: KnowledgeAreaSchema,
  newVersionId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  advanceBaseline: Schema.optional(Schema.Boolean),
  expectedCurrentAreaContentFingerprint: Schema.optional(
    Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/i)),
  ),
});

const cardContent = (card: Assessment): string => {
  const content = Object.fromEntries(Object.entries(card).filter(([key]) => key !== "schedule"));
  return JSON.stringify(content);
};

function mergeWorkspaceArea(
  workspace: Workspace,
  current: LearningArea,
  proposed: LearningArea,
  now: Date,
): Workspace {
  const beforeById = new Map(current.cards.map((card) => [card.id, card]));
  const proposedCards: Assessment[] = proposed.cards.map((card) => {
    const before = beforeById.get(card.id);
    return before ? { ...card, schedule: before.schedule } : card;
  });
  let next = workspace;
  const retainedReviewAreas = [...(workspace.retainedReviewAreas ?? [])];
  const deletedCards = [...(workspace.deletedCards ?? [])];
  for (const previous of current.cards) {
    const replacement = proposedCards.find((card) => card.id === previous.id);
    if (replacement && cardContent(replacement) === cardContent(previous)) continue;
    next = captureCardVersion(next, current, previous, replacement ? "replace" : "delete", now);
    if (!replacement) {
      if (!deletedCards.some((item) => item.areaId === current.id && item.cardId === previous.id)) {
        deletedCards.push({ areaId: current.id, cardId: previous.id });
      }
      const hasReviewHistory = (workspace.reviewEvents ?? []).some(
        (event) => event.areaId === current.id && event.cardId === previous.id,
      );
      if (hasReviewHistory) {
        const retained = retainedReviewAreas.find((area) => area.id === current.id);
        if (retained) {
          if (!retained.cards.some((card) => card.id === previous.id)) {
            const index = retainedReviewAreas.indexOf(retained);
            retainedReviewAreas[index] = { ...retained, cards: [...retained.cards, previous] };
          }
        } else {
          retainedReviewAreas.push({ ...current, cards: [previous] });
        }
      }
    }
  }
  const updated: LearningArea = { ...proposed, cards: proposedCards };
  return {
    ...next,
    areas: workspace.areas.map((area) => (area.id === current.id ? updated : area)),
    ...(retainedReviewAreas.length > 0 || workspace.retainedReviewAreas !== undefined
      ? { retainedReviewAreas }
      : {}),
    ...(deletedCards.length > 0 || workspace.deletedCards !== undefined ? { deletedCards } : {}),
  };
}

/** Applies a reviewed deck update to one personal area, keeping private schedules and review history. */
export function applyDeckWorkspaceUpdate(
  input: unknown,
  now: Date,
  createId: () => string,
): Effect.Effect<Workspace, ApplyDeckWorkspaceUpdateFailure> {
  return Effect.gen(function* () {
    const command = yield* Schema.decodeUnknown(CommandSchema)(input).pipe(
      Effect.mapError(() => failure("invalid-input")),
    );
    if (!Number.isFinite(now.getTime())) return yield* Effect.fail(failure("invalid-input"));
    const current = command.workspace.areas.find((area) => area.id === command.updatedArea.id);
    if (!current) return yield* Effect.fail(failure("area-missing"));
    if (
      current.sourceId !== command.updatedArea.sourceId ||
      current.id === command.updatedArea.sourceId ||
      !current.forkedFromVersionId
    )
      return yield* Effect.fail(failure("lineage-mismatch"));

    if (command.expectedCurrentAreaContentFingerprint !== undefined) {
      const portable = yield* toKnowledgeArea(current, true, true).pipe(
        Effect.mapError(() => failure("invalid-input")),
      );
      if (
        publicationContentHash(portable) !==
        command.expectedCurrentAreaContentFingerprint.toLowerCase()
      ) {
        return yield* Effect.fail(failure("stale-content"));
      }
    }

    const updatedDocument: KnowledgeArea =
      command.advanceBaseline === true
        ? { ...command.updatedArea, forkedFromVersionId: command.newVersionId }
        : { ...command.updatedArea, forkedFromVersionId: current.forkedFromVersionId };
    const converted = yield* Effect.either(
      fromKnowledgeArea(updatedDocument, current.color, true, createId, now, true),
    );
    if (Either.isLeft(converted)) return yield* Effect.fail(failure("invalid-update"));
    const proposed = converted.right;
    const historicalCardIds = new Set([
      ...command.workspace.areas.flatMap((area) => area.cards.map((card) => card.id)),
      ...(command.workspace.deletedCards ?? []).map((item) => item.cardId),
      ...(command.workspace.reviewEvents ?? []).map((event) => event.cardId),
      ...(command.workspace.cardVersions ?? []).map((version) => version.cardId),
      ...(command.workspace.retainedReviewAreas ?? []).flatMap((area) =>
        area.cards.map((card) => card.id),
      ),
    ]);
    const currentCardIds = new Set(current.cards.map((card) => card.id));
    if (
      proposed.cards.some((card) => !currentCardIds.has(card.id) && historicalCardIds.has(card.id))
    ) {
      return yield* Effect.fail(failure("identity-collision"));
    }
    const merged = mergeWorkspaceArea(command.workspace, current, proposed, now);
    const retained = yield* retainPublishedActivityDefinitions(merged, updatedDocument, {
      replaceArea: updatedDocument.activities !== undefined,
    }).pipe(Effect.mapError(() => failure("invalid-update")));
    const validated = Schema.decodeUnknownEither(WorkspaceSchema)(retained);
    if (Either.isLeft(validated)) return yield* Effect.fail(failure("invalid-update"));
    return validated.right;
  });
}
