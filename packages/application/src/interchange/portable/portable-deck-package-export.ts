import { zipSync } from "fflate";
import { Effect, Either, Schema } from "effect";
import { KnowledgeAreaSchema, LearningAreaSchema, type KnowledgeArea } from "@recall/domain";
import type { MediaStore } from "@recall/local-store";
import { isSupportedMediaContent } from "../knowledge-area-package";
import {
  MAX_PORTABLE_DECK_PACKAGE_BYTES,
  PrivateHistorySchema,
  digest,
  fail,
  jsonBytes,
  maxExpandedBytes,
  maxFiles,
  pathFor,
  referencedMedia,
  validKnowledgeArea,
  type PortableDeckPackageFailure,
  type PortableDeckPrivateHistoryInput,
} from "./portable-deck-package-shared";

/** Public-safe is the default. The optional attachment contains only this deck's explicit private history. */
export function exportPortableDeckPackage(
  area: KnowledgeArea,
  mediaStore: MediaStore,
  privateHistory?: PortableDeckPrivateHistoryInput,
): Effect.Effect<Uint8Array, PortableDeckPackageFailure> {
  return Effect.gen(function* () {
    const validatedArea = Schema.decodeUnknownEither(KnowledgeAreaSchema)(area);
    if (Either.isLeft(validatedArea) || !validKnowledgeArea(validatedArea.right))
      return yield* Effect.fail(fail("invalid-package"));
    const validatedCurrentArea = privateHistory
      ? Schema.decodeUnknownEither(LearningAreaSchema)(privateHistory.currentArea)
      : undefined;
    if (validatedCurrentArea && Either.isLeft(validatedCurrentArea))
      return yield* Effect.fail(fail("invalid-package"));
    if (
      privateHistory &&
      (!validatedCurrentArea ||
        Either.isLeft(validatedCurrentArea) ||
        validatedCurrentArea.right.id !== validatedArea.right.id ||
        validatedCurrentArea.right.cards.length !== validatedArea.right.cards.length ||
        validatedCurrentArea.right.cards.some(
          (card, index) => card.id !== validatedArea.right.cards[index]?.id,
        ) ||
        (validatedCurrentArea.right.objectives ?? []).some(
          (objective) => !validatedArea.right.objectives.some((item) => item.id === objective.id),
        ))
    )
      return yield* Effect.fail(fail("invalid-package"));
    const privateEvents = (privateHistory?.reviewEvents ?? []).filter(
      (event) => event.areaId === area.id && area.cards.some((card) => card.id === event.cardId),
    );
    const privateEventIds = new Set(privateEvents.map((event) => event.id));
    const historyInput = privateHistory
      ? {
          version: 1 as const,
          currentArea:
            validatedCurrentArea && Either.isRight(validatedCurrentArea)
              ? validatedCurrentArea.right
              : privateHistory.currentArea,
          reviewEvents: privateEvents.map((event) => ({
            id: event.id,
            areaId: event.areaId,
            cardId: event.cardId,
            ratedAt: event.ratedAt,
            rating: event.rating,
            schedulerFamily: event.schedulerFamily,
            schedulerVersion: event.schedulerVersion,
            ...(event.baseReviewEventId === null
              ? { baseReviewEventId: null }
              : event.baseReviewEventId && privateEventIds.has(event.baseReviewEventId)
                ? { baseReviewEventId: event.baseReviewEventId }
                : {}),
            ...(event.reviewedAtDevice ? { reviewedAtDevice: event.reviewedAtDevice } : {}),
            ...(event.effectiveReviewedAt
              ? { effectiveReviewedAt: event.effectiveReviewedAt }
              : {}),
            ...(event.elapsedMs !== undefined ? { elapsedMs: event.elapsedMs } : {}),
            ...(event.schedulerParameterSetId !== undefined
              ? { schedulerParameterSetId: event.schedulerParameterSetId }
              : {}),
            ...(event.previousStateHash !== undefined
              ? { previousStateHash: event.previousStateHash }
              : {}),
          })),
          cardVersions: [...(privateHistory.cardVersions ?? [])].filter(
            (version) =>
              version.areaId === area.id && area.cards.some((card) => card.id === version.cardId),
          ),
          activityLibrary: {
            version: 1 as const,
            activities: [...(privateHistory.activityLibrary?.activities ?? [])].filter(
              (activity) => activity.areaId === area.id,
            ),
            attempts: [...(privateHistory.activityLibrary?.attempts ?? [])].filter(
              (attempt) => attempt.activity.areaId === area.id,
            ),
            drafts: [...(privateHistory.activityLibrary?.drafts ?? [])].filter(
              (draft) => draft.activity.areaId === area.id,
            ),
            editorDrafts: [...(privateHistory.activityLibrary?.editorDrafts ?? [])].filter(
              (draft) =>
                draft.areaId === area.id && (!draft.editing || draft.editing.areaId === area.id),
            ),
          },
        }
      : undefined;
    const historyResult = historyInput
      ? Schema.decodeUnknownEither(PrivateHistorySchema)(historyInput)
      : undefined;
    if (historyResult && Either.isLeft(historyResult))
      return yield* Effect.fail(fail("invalid-package"));
    const history =
      historyResult && Either.isRight(historyResult) ? historyResult.right : undefined;
    const refs = referencedMedia(validatedArea.right, history?.cardVersions);
    if (!refs) return yield* Effect.fail(fail("invalid-package"));
    const files: Record<string, Uint8Array> = {};
    const content: Record<string, Uint8Array> = {
      "knowledge-area.json": jsonBytes(validatedArea.right),
      "media/index.json": jsonBytes(refs),
    };
    if (history) content["private-history.json"] = jsonBytes(history);
    Object.assign(files, content);
    const manifestFiles = Object.entries(content).map(([path, bytes]) => ({
      path,
      sha256: digest(bytes),
    }));
    let expanded = Object.values(content).reduce((sum, bytes) => sum + bytes.byteLength, 0);
    if (refs.length + Object.keys(content).length + 1 > maxFiles || expanded > maxExpandedBytes)
      return yield* Effect.fail(fail("limits-exceeded"));
    for (const reference of refs) {
      const asset = yield* mediaStore
        .get(reference.id)
        .pipe(Effect.mapError(() => fail("media-unavailable")));
      if (
        !asset ||
        asset.reference.mimeType !== reference.mimeType ||
        asset.bytes.byteLength !== reference.byteLength ||
        digest(asset.bytes) !== reference.id ||
        !isSupportedMediaContent(asset.bytes, reference.mimeType)
      )
        return yield* Effect.fail(fail("media-unavailable"));
      expanded += asset.bytes.byteLength;
      if (expanded > maxExpandedBytes) return yield* Effect.fail(fail("limits-exceeded"));
      files[pathFor(reference)] = asset.bytes;
      manifestFiles.push({ path: pathFor(reference), sha256: reference.id });
    }
    const manifest = jsonBytes({
      formatVersion: 1,
      privacy: history ? "private" : "public",
      files: manifestFiles,
      media: refs,
    });
    if (expanded + manifest.byteLength > maxExpandedBytes)
      return yield* Effect.fail(fail("limits-exceeded"));
    files["manifest.json"] = manifest;
    const archive = yield* Effect.try({
      try: () => zipSync(files, { level: 6 }),
      catch: () => fail("invalid-package"),
    });
    if (archive.byteLength > MAX_PORTABLE_DECK_PACKAGE_BYTES)
      return yield* Effect.fail(fail("limits-exceeded"));
    return archive;
  });
}
