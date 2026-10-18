import { Effect, Either } from "effect";
import {
  readReleaseBaseline,
  type PublishingApi,
  type ReleaseDraftStore,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { deckSharingApi } from "@/lib/deck-sharing-api";

type BaselineDependencies = {
  readonly area: KnowledgeArea;
  readonly releaseStore: ReleaseDraftStore;
  readonly transport: PublishingApi;
  readonly setPreviousReleaseRecord: (record: {
    readonly areaId: string;
    readonly value: KnowledgeArea;
  }) => void;
};

export function readPreviousReleaseBaseline({
  area,
  releaseStore,
  transport,
  setPreviousReleaseRecord,
}: BaselineDependencies) {
  return Effect.either(readReleaseBaseline(releaseStore, area.id)).pipe(
    Effect.tap((saved) =>
      Effect.sync(() => {
        if (Either.isRight(saved) && saved.right)
          setPreviousReleaseRecord({ areaId: area.id, value: saved.right });
      }),
    ),
    Effect.flatMap(() => Effect.either(deckSharingApi.read(area.id))),
    Effect.flatMap((detail) => {
      if (Either.isLeft(detail) || !detail.right.canManage) return Effect.void;
      return Effect.either(transport.read(detail.right.deck.latestVersionId)).pipe(
        Effect.tap((version) =>
          Effect.sync(() => {
            const content = Either.isRight(version) ? version.right.version.content : null;
            if (content?.id === area.id)
              setPreviousReleaseRecord({ areaId: area.id, value: content });
          }),
        ),
      );
    }),
  );
}
