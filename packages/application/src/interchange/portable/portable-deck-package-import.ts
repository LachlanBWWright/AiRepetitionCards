import { unzipSync, type UnzipFileInfo } from "fflate";
import { Effect, Either, Schema } from "effect";
import { KnowledgeAreaSchema, MediaReferenceSchema } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import { isSupportedMediaContent } from "../knowledge-area-package";
import { hasSafeZipExpansion } from "../zip-safety";
import {
  MAX_PORTABLE_DECK_PACKAGE_BYTES,
  ManifestSchema,
  PrivateHistorySchema,
  digest,
  fail,
  maxExpandedBytes,
  maxFiles,
  parseJson,
  pathFor,
  referencedMedia,
  safePath,
  validKnowledgeArea,
  type ImportedPortableDeckPackage,
  type PortableDeckPackageFailure,
} from "./portable-deck-package-shared";

/** Parses an untrusted archive into an approval preview. The caller must remap identities when accepting it. */
export function importPortableDeckPackage(
  input: unknown,
): Effect.Effect<ImportedPortableDeckPackage, PortableDeckPackageFailure> {
  return Effect.gen(function* () {
    if (!(input instanceof Uint8Array) || input.byteLength > MAX_PORTABLE_DECK_PACKAGE_BYTES)
      return yield* Effect.fail(fail("limits-exceeded"));
    const entries = yield* Effect.try({
      try: () => {
        const result: UnzipFileInfo[] = [];
        unzipSync(input, {
          filter: (entry) => {
            if (result.length <= maxFiles) result.push(entry);
            return false;
          },
        });
        return result;
      },
      catch: () => fail("invalid-package"),
    });
    if (!hasSafeZipExpansion(entries, { maxFiles, maxExpandedBytes }))
      return yield* Effect.fail(fail("limits-exceeded"));
    const seen = new Set<string>();
    let count = 0;
    let expanded = 0;
    const archiveState = { rejected: false };
    const files = yield* Effect.try({
      try: () =>
        unzipSync(input, {
          filter: (entry) => {
            count += 1;
            expanded += entry.originalSize;
            const duplicate = seen.has(entry.name);
            if (!safePath(entry.name) || duplicate) archiveState.rejected = true;
            seen.add(entry.name);
            if (count > maxFiles || expanded > maxExpandedBytes) archiveState.rejected = true;
            return (
              safePath(entry.name) &&
              !duplicate &&
              count <= maxFiles &&
              expanded <= maxExpandedBytes
            );
          },
        }),
      catch: () => fail("invalid-package"),
    });
    if (archiveState.rejected) return yield* Effect.fail(fail("limits-exceeded"));
    const manifestBytes = files["manifest.json"];
    const areaBytes = files["knowledge-area.json"];
    const indexBytes = files["media/index.json"];
    if (!manifestBytes || !areaBytes || !indexBytes)
      return yield* Effect.fail(fail("invalid-package"));
    const manifestValue = yield* Effect.try({
      try: () => parseJson(manifestBytes),
      catch: () => fail("invalid-package"),
    });
    const manifestResult = Schema.decodeUnknownEither(ManifestSchema)(manifestValue);
    if (Either.isLeft(manifestResult)) return yield* Effect.fail(fail("invalid-package"));
    const manifest = manifestResult.right;
    const allowed = new Set([
      "manifest.json",
      "knowledge-area.json",
      "media/index.json",
      ...(manifest.privacy === "private" ? ["private-history.json"] : []),
    ]);
    if (
      Object.keys(files).some(
        (path) =>
          !allowed.has(path) &&
          !/^media\/[a-f0-9]{64}\.(jpg|png|gif|webp|mp3|ogg|wav|m4a|webm)$/.test(path),
      )
    )
      return yield* Effect.fail(fail("invalid-package"));
    if (manifest.privacy === "private" && !files["private-history.json"])
      return yield* Effect.fail(fail("invalid-package"));
    if (manifest.privacy === "public" && files["private-history.json"])
      return yield* Effect.fail(fail("invalid-package"));
    const expected = new Map(manifest.files.map((file) => [file.path, file.sha256]));
    if (expected.size !== manifest.files.length || expected.size !== Object.keys(files).length - 1)
      return yield* Effect.fail(fail("invalid-package"));
    for (const [path, hash] of expected) {
      const file = files[path];
      if (!file || digest(file) !== hash) return yield* Effect.fail(fail("invalid-package"));
    }
    const areaValue = yield* Effect.try({
      try: () => parseJson(areaBytes),
      catch: () => fail("invalid-package"),
    });
    const areaResult = Schema.decodeUnknownEither(KnowledgeAreaSchema)(areaValue);
    if (Either.isLeft(areaResult) || !validKnowledgeArea(areaResult.right))
      return yield* Effect.fail(fail("invalid-package"));
    const indexValue = yield* Effect.try({
      try: () => parseJson(indexBytes),
      catch: () => fail("invalid-package"),
    });
    const refsResult = Schema.decodeUnknownEither(Schema.Array(MediaReferenceSchema))(indexValue);
    if (
      Either.isLeft(refsResult) ||
      JSON.stringify(refsResult.right) !== JSON.stringify(manifest.media)
    )
      return yield* Effect.fail(fail("invalid-package"));
    let history: unknown;
    if (manifest.privacy === "private") {
      const historyBytes = files["private-history.json"];
      if (!historyBytes) return yield* Effect.fail(fail("invalid-package"));
      history = yield* Effect.try({
        try: () => parseJson(historyBytes),
        catch: () => fail("invalid-package"),
      });
    }
    const historyResult =
      history === undefined ? undefined : Schema.decodeUnknownEither(PrivateHistorySchema)(history);
    if (historyResult && Either.isLeft(historyResult))
      return yield* Effect.fail(fail("invalid-package"));
    const refs = referencedMedia(
      areaResult.right,
      historyResult && Either.isRight(historyResult) ? historyResult.right.cardVersions : [],
    );
    if (!refs) return yield* Effect.fail(fail("invalid-package"));
    if (JSON.stringify(refs) !== JSON.stringify(manifest.media))
      return yield* Effect.fail(fail("invalid-package"));
    const exactPaths = new Set([
      "manifest.json",
      "knowledge-area.json",
      "media/index.json",
      ...(manifest.privacy === "private" ? ["private-history.json"] : []),
      ...refs.map(pathFor),
    ]);
    if (
      exactPaths.size !== Object.keys(files).length ||
      Object.keys(files).some((path) => !exactPaths.has(path)) ||
      manifest.files.some((file) => !exactPaths.has(file.path))
    )
      return yield* Effect.fail(fail("invalid-package"));
    const media: StoredMediaAsset[] = [];
    for (const reference of refs) {
      const bytes = files[pathFor(reference)];
      if (
        !bytes ||
        bytes.byteLength !== reference.byteLength ||
        digest(bytes) !== reference.id ||
        !isSupportedMediaContent(bytes, reference.mimeType)
      )
        return yield* Effect.fail(fail("media-mismatch"));
      media.push({ reference, bytes });
    }
    if (historyResult && Either.isRight(historyResult)) {
      const value = historyResult.right;
      const cardIds = new Set<string>(areaResult.right.cards.map((card) => card.id));
      const objectiveIds = new Set<string>(
        areaResult.right.objectives.map((objective) => objective.id),
      );
      const eventsById = new Map(value.reviewEvents.map((event) => [event.id, event]));
      const currentObjectives = new Set<string>(
        (value.currentArea.objectives ?? []).map((item) => item.id),
      );
      const cardsMatchCurrent = areaResult.right.cards.every((content) => {
        const card = value.currentArea.cards.find((item) => item.id === content.id);
        if (!card) return false;
        if (content.kind === "basic")
          return card.front === content.front && card.back === content.back;
        return Boolean(
          card.cloze &&
          card.cloze.text === content.text &&
          (content.deletionIndex === undefined ||
            card.cloze.deletionIndex === content.deletionIndex),
        );
      });
      if (
        value.currentArea.id !== areaResult.right.id ||
        value.currentArea.cards.length !== cardIds.size ||
        value.currentArea.cards.some((card) => !cardIds.has(card.id)) ||
        (currentObjectives.size > 0 &&
          (currentObjectives.size !== objectiveIds.size ||
            [...objectiveIds].some((id) => !currentObjectives.has(id)))) ||
        !cardsMatchCurrent ||
        value.reviewEvents.some((event) => !cardIds.has(event.cardId)) ||
        value.reviewEvents.some(
          (event) =>
            event.baseReviewEventId != null &&
            (!eventsById.has(event.baseReviewEventId) ||
              eventsById.get(event.baseReviewEventId)?.cardId !== event.cardId),
        ) ||
        value.cardVersions.some((version) => !cardIds.has(version.cardId)) ||
        value.activityLibrary.activities.some((item) => item.areaId !== areaResult.right.id) ||
        value.activityLibrary.attempts.some(
          (item) => item.activity.areaId !== areaResult.right.id,
        ) ||
        (value.activityLibrary.drafts ?? []).some(
          (item) => item.activity.areaId !== areaResult.right.id,
        ) ||
        (value.activityLibrary.editorDrafts ?? []).some(
          (item) =>
            item.areaId !== areaResult.right.id ||
            (item.editing?.areaId !== undefined && item.editing.areaId !== areaResult.right.id),
        )
      )
        return yield* Effect.fail(fail("invalid-package"));
    }
    return {
      knowledgeArea: areaResult.right,
      media,
      privacy: manifest.privacy,
      ...(historyResult && Either.isRight(historyResult)
        ? { privateHistory: historyResult.right }
        : {}),
    };
  });
}
