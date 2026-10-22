import { Effect, Either, Schema } from "effect";
import {
  WorkspaceSchema,
  emptyActivityLibrary,
  type ActivityLibrary,
  type ActivityJson,
  type LearningArea,
  type Workspace,
} from "@recall/domain";
import { fromKnowledgeArea } from "../knowledge-area-interchange";
import { expandCloze } from "../../authoring/cloze";
import {
  type ImportedPortableDeckPackage,
  type PortableDeckAcceptanceFailure,
  type PortableDeckRestoreCheck,
  type AcceptedPortableDeck,
} from "./portable-deck-package-shared";

/** Private history keeps its original append-only identities. Only accept it into a workspace where none collide. */
export function checkPortableDeckPrivateRestore(
  imported: ImportedPortableDeckPackage,
  workspace: Workspace,
): PortableDeckRestoreCheck {
  if (imported.privacy !== "private") return { accepted: false, reason: "public-package" };
  const history = imported.privateHistory;
  if (!history) return { accepted: false, reason: "private-history-missing" };
  const allAreas = [...workspace.areas, ...(workspace.retainedReviewAreas ?? [])];
  const existingAreaIds = new Set([
    ...allAreas.map((area) => area.id),
    ...(workspace.deletedAreas ?? []).map((area) => area.areaId),
  ]);
  const existingCardIds = new Set([
    ...allAreas.flatMap((area) => area.cards.map((card) => card.id)),
    ...(workspace.deletedCards ?? []).map((item) => item.cardId),
    ...(workspace.cardVersions ?? []).map((item) => item.cardId),
  ]);
  const existingObjectiveIds = new Set<string>([
    ...allAreas.flatMap((area) => (area.objectives ?? []).map((item) => item.id)),
    ...(workspace.cardVersions ?? []).flatMap((version) => [
      ...(version.area.objectives ?? []).map((item) => item.id),
      ...(version.card.objectiveIds ?? []),
    ]),
  ]);
  const existingReviewIds = new Set((workspace.reviewEvents ?? []).map((event) => event.id));
  const existingVersionIds = new Set((workspace.cardVersions ?? []).map((version) => version.id));
  const existingActivityIds = new Set(
    workspace.activityLibrary?.activities.map((item) => item.id) ?? [],
  );
  const existingAttemptIds = new Set(
    workspace.activityLibrary?.attempts.map((item) => item.id) ?? [],
  );
  const existingDraftIds = new Set(workspace.activityLibrary?.drafts?.map((item) => item.id) ?? []);
  const existingEditorDraftIds = new Set(
    workspace.activityLibrary?.editorDrafts?.map((item) => item.id) ?? [],
  );
  const incomingEvents = history.reviewEvents;
  const incomingVersions = history.cardVersions;
  const incomingActivities = history.activityLibrary.activities;
  const snapshotActivities = [
    ...history.activityLibrary.attempts.map((item) => item.activity),
    ...(history.activityLibrary.drafts ?? []).map((item) => item.activity),
    ...(history.activityLibrary.editorDrafts ?? []).flatMap((item) =>
      item.editing ? [item.editing] : [],
    ),
  ];
  const historicalObjectiveIds = [
    ...incomingVersions.flatMap((version) => [
      ...(version.area.objectives ?? []).map((item) => item.id),
      ...(version.card.objectiveIds ?? []),
    ]),
    ...snapshotActivities.flatMap((activity) => activity.objectiveIds),
  ];
  const incomingAttempts = history.activityLibrary.attempts;
  const incomingDrafts = history.activityLibrary.drafts ?? [];
  const incomingEditorDrafts = history.activityLibrary.editorDrafts ?? [];
  const deckCardIds = new Set<string>(imported.knowledgeArea.cards.map((card) => card.id));
  const eventIds = new Set(incomingEvents.map((event) => event.id));
  const corrections = history.reviewCorrections ?? [],
    undoStates = history.reviewUndoStates ?? [],
    adjustments = history.scheduleAdjustments ?? [];
  const referencesValid =
    corrections.every((item) => eventIds.has(item.eventId)) &&
    undoStates.every((item) => eventIds.has(item.eventId)) &&
    adjustments.every(
      (item) =>
        deckCardIds.has(item.cardId) &&
        (item.afterReviewEventId === null || eventIds.has(item.afterReviewEventId)),
    ) &&
    incomingEvents.every((event) => deckCardIds.has(event.cardId)) &&
    incomingVersions.every(
      (version) => deckCardIds.has(version.cardId) && version.card.id === version.cardId,
    ) &&
    incomingActivities.every((activity) => activity.areaId === imported.knowledgeArea.id) &&
    snapshotActivities.every((activity) => activity.areaId === imported.knowledgeArea.id);
  const collisions =
    corrections.some((item) =>
      workspace.reviewCorrections?.some((existing) => existing.id === item.id),
    ) ||
    adjustments.some((item) =>
      workspace.scheduleAdjustments?.some((existing) => existing.id === item.id),
    ) ||
    new Set(corrections.map((item) => item.id)).size !== corrections.length ||
    new Set(undoStates.map((item) => item.eventId)).size !== undoStates.length ||
    new Set(adjustments.map((item) => item.id)).size !== adjustments.length ||
    existingAreaIds.has(imported.knowledgeArea.id) ||
    imported.knowledgeArea.cards.some((card) => existingCardIds.has(card.id)) ||
    imported.knowledgeArea.objectives.some((item) => existingObjectiveIds.has(item.id)) ||
    historicalObjectiveIds.some((id) => existingObjectiveIds.has(id)) ||
    incomingEvents.some((event) => existingReviewIds.has(event.id)) ||
    incomingVersions.some((version) => existingVersionIds.has(version.id)) ||
    [...incomingActivities, ...snapshotActivities].some((item) =>
      existingActivityIds.has(item.id),
    ) ||
    incomingAttempts.some((item) => existingAttemptIds.has(item.id)) ||
    incomingDrafts.some((item) => existingDraftIds.has(item.id)) ||
    incomingEditorDrafts.some((item) => existingEditorDraftIds.has(item.id)) ||
    new Set(incomingEvents.map((item) => item.id)).size !== incomingEvents.length ||
    new Set(incomingVersions.map((item) => item.id)).size !== incomingVersions.length;
  return referencesValid && !collisions
    ? { accepted: true }
    : { accepted: false, reason: collisions ? "identity-collision" : "invalid-private-history" };
}

/** Converts an approved preview into a copy in the current workspace and validates the result. */
export function acceptPortableDeckImport(input: {
  readonly imported: ImportedPortableDeckPackage;
  readonly workspace: Workspace;
  readonly color: string;
  readonly createId: () => string;
  readonly now: Date;
  readonly restorePrivateHistory: boolean;
}): Effect.Effect<AcceptedPortableDeck, PortableDeckAcceptanceFailure> {
  return Effect.gen(function* () {
    const restorePrivate = input.restorePrivateHistory;
    if (
      restorePrivate &&
      !checkPortableDeckPrivateRestore(input.imported, input.workspace).accepted
    )
      return yield* Effect.fail({
        _tag: "PortableDeckAcceptanceFailure",
        reason: "private-restore-rejected",
      } as const);
    const preserveIds = restorePrivate;
    const occupied = new Set<string>([
      ...input.workspace.areas.map((area) => area.id),
      ...(input.workspace.retainedReviewAreas ?? []).map((area) => area.id),
      ...(input.workspace.deletedAreas ?? []).map((area) => area.areaId),
      ...input.workspace.areas.flatMap((area) => area.cards.map((card) => card.id)),
      ...(input.workspace.retainedReviewAreas ?? []).flatMap((area) =>
        area.cards.map((card) => card.id),
      ),
      ...(input.workspace.deletedCards ?? []).map((item) => item.cardId),
      ...input.workspace.areas.flatMap((area) =>
        (area.objectives ?? []).map((objective) => objective.id),
      ),
      ...(input.workspace.retainedReviewAreas ?? []).flatMap((area) =>
        (area.objectives ?? []).map((objective) => objective.id),
      ),
      ...(input.workspace.reviewEvents ?? []).map((event) => event.id),
      ...(input.workspace.cardVersions ?? []).map((version) => version.id),
      ...(input.workspace.cardVersions ?? []).flatMap((version) => [
        version.area.id,
        version.card.id,
        ...(version.area.objectives ?? []).map((objective) => objective.id),
        ...(version.card.objectiveIds ?? []),
      ]),
      ...(input.workspace.activityLibrary?.activities ?? []).map((item) => item.id),
      ...(input.workspace.activityLibrary?.attempts ?? []).map((item) => item.id),
      ...(input.workspace.activityLibrary?.attempts ?? []).map((item) => item.activity.id),
      ...(input.workspace.activityLibrary?.drafts ?? []).map((item) => item.id),
      ...(input.workspace.activityLibrary?.drafts ?? []).map((item) => item.activity.id),
      ...(input.workspace.activityLibrary?.editorDrafts ?? []).map((item) => item.id),
      ...(input.workspace.activityLibrary?.editorDrafts ?? []).flatMap((item) =>
        item.editing ? [item.editing.id] : [],
      ),
    ]);
    const idFailures = new Set<string>();
    const createUniqueId = () => {
      let candidate = "";
      for (let index = 0; index < 100; index += 1) {
        candidate = input.createId();
        if (candidate.length > 0 && !occupied.has(candidate)) {
          occupied.add(candidate);
          return candidate;
        }
      }
      idFailures.add("collision");
      return candidate;
    };
    const convertedArea = yield* fromKnowledgeArea(
      input.imported.knowledgeArea,
      input.color,
      preserveIds,
      createUniqueId,
      input.now,
      true,
    ).pipe(
      Effect.mapError((): PortableDeckAcceptanceFailure => ({
        _tag: "PortableDeckAcceptanceFailure",
        reason: "invalid-deck",
      })),
    );
    if (idFailures.has("collision"))
      return yield* Effect.fail({
        _tag: "PortableDeckAcceptanceFailure",
        reason: "invalid-deck",
      } as const);
    const privateHistory = restorePrivate ? input.imported.privateHistory : undefined;
    const privateSchedules = new Map(
      (privateHistory?.currentArea.cards ?? []).map((card) => [card.id, card.schedule]),
    );
    const area: LearningArea = privateHistory
      ? {
          ...convertedArea,
          cards: convertedArea.cards.map((card) => ({
            ...card,
            schedule: privateSchedules.get(card.id) ?? card.schedule,
          })),
        }
      : convertedArea;
    const oldLibrary = input.workspace.activityLibrary ?? emptyActivityLibrary;
    const portableActivities = restorePrivate
      ? []
      : (input.imported.knowledgeArea.activities ?? []);
    const objectiveIds = new Map<string, string>(
      input.imported.knowledgeArea.objectives.map((objective, index) => [
        objective.id,
        area.objectives?.[index]?.id ?? objective.id,
      ]),
    );
    const cardIds = new Map<string, readonly string[]>();
    let cardOffset = 0;
    for (const card of input.imported.knowledgeArea.cards) {
      let outputCount = 1;
      if (card.kind === "cloze" && card.deletionIndex === undefined) {
        outputCount = (yield* expandCloze(card.text).pipe(
          Effect.mapError((): PortableDeckAcceptanceFailure => ({
            _tag: "PortableDeckAcceptanceFailure",
            reason: "invalid-deck",
          })),
        )).length;
      }
      cardIds.set(
        card.id,
        area.cards.slice(cardOffset, cardOffset + outputCount).map((item) => item.id),
      );
      cardOffset += outputCount;
    }
    const isActivityArray = (value: ActivityJson): value is readonly ActivityJson[] =>
      Array.isArray(value);
    const isStringArray = (value: ActivityJson): value is readonly string[] =>
      Array.isArray(value) && value.every((item) => typeof item === "string");
    const remapActivityJson = (value: ActivityJson): ActivityJson => {
      if (isActivityArray(value)) return value.map(remapActivityJson);
      if (typeof value !== "object" || value === null) return value;
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]): [string, ActivityJson] => {
          if (key === "cardId" && typeof entry === "string")
            return [key, cardIds.get(entry)?.[0] ?? entry];
          if (key === "cardIds" && isStringArray(entry)) {
            const mapped = entry.flatMap((item) =>
              typeof item === "string" ? [...(cardIds.get(item) ?? [item])] : [item],
            );
            return [key, mapped];
          }
          return [key, remapActivityJson(entry)];
        }),
      );
    };
    const isActivityObject = (
      value: ActivityJson,
    ): value is Readonly<Record<string, ActivityJson>> =>
      typeof value === "object" && value !== null && !Array.isArray(value);
    const remapActivityPayload = (
      value: Readonly<Record<string, ActivityJson>>,
    ): Readonly<Record<string, ActivityJson>> => {
      const remapped = remapActivityJson(value);
      if (isActivityObject(remapped)) return remapped;
      return value;
    };
    const activities = preserveIds
      ? []
      : portableActivities.map((activity) => ({
          ...activity,
          id: createUniqueId(),
          sourceId: activity.sourceId ?? activity.id,
          areaId: area.id,
          objectiveIds: activity.objectiveIds.map((id) => objectiveIds.get(id) ?? id),
          ...(activity.pluginId.startsWith("recall.")
            ? { payload: remapActivityPayload(activity.payload) }
            : {}),
        }));
    if (idFailures.has("collision"))
      return yield* Effect.fail({
        _tag: "PortableDeckAcceptanceFailure",
        reason: "invalid-deck",
      } as const);
    const nextLibrary: ActivityLibrary = {
      version: 1,
      activities: [
        ...oldLibrary.activities,
        ...activities,
        ...(privateHistory?.activityLibrary.activities ?? []),
      ],
      attempts: [...oldLibrary.attempts, ...(privateHistory?.activityLibrary.attempts ?? [])],
      ...(oldLibrary.drafts || privateHistory?.activityLibrary.drafts
        ? {
            drafts: [
              ...(oldLibrary.drafts ?? []),
              ...(privateHistory?.activityLibrary.drafts ?? []),
            ],
          }
        : {}),
      ...(oldLibrary.editorDrafts || privateHistory?.activityLibrary.editorDrafts
        ? {
            editorDrafts: [
              ...(oldLibrary.editorDrafts ?? []),
              ...(privateHistory?.activityLibrary.editorDrafts ?? []),
            ],
          }
        : {}),
    };
    const nextWorkspace: Workspace = {
      ...input.workspace,
      areas: [...input.workspace.areas, area],
      activityLibrary: nextLibrary,
      ...(privateHistory
        ? {
            reviewEvents: [...(input.workspace.reviewEvents ?? []), ...privateHistory.reviewEvents],
            reviewCorrections: [
              ...(input.workspace.reviewCorrections ?? []),
              ...(privateHistory.reviewCorrections ?? []),
            ],
            reviewUndoStates: [
              ...(input.workspace.reviewUndoStates ?? []),
              ...(privateHistory.reviewUndoStates ?? []),
            ],
            scheduleAdjustments: [
              ...(input.workspace.scheduleAdjustments ?? []),
              ...(privateHistory.scheduleAdjustments ?? []),
            ],
            cardVersions: [...(input.workspace.cardVersions ?? []), ...privateHistory.cardVersions],
          }
        : {}),
    };
    const validatedWorkspace = Schema.decodeUnknownEither(WorkspaceSchema)(nextWorkspace);
    if (Either.isLeft(validatedWorkspace))
      return yield* Effect.fail({
        _tag: "PortableDeckAcceptanceFailure",
        reason: "invalid-deck",
      } as const);
    return { workspace: validatedWorkspace.right, area: area, media: input.imported.media };
  });
}
