import { useEffect, useRef } from "react";
import { Either, Schema } from "effect";
import { NoteAuthoringDraftSchema, type NoteAuthoringDraft } from "@recall/application";
import type { StoredMediaAsset } from "@recall/local-store";
import type { NoteDraftPort } from "./note-authoring-ports";

export function useNoteDraftRetention(
  port: NoteDraftPort | undefined,
  draft: NoteAuthoringDraft,
  assets: readonly StoredMediaAsset[],
  dirty: boolean,
) {
  const written = useRef("");
  const encoded = JSON.stringify(draft);
  useEffect(() => {
    if (!port || !dirty || written.current === encoded) return;
    const decoded = Schema.decodeUnknownEither(NoteAuthoringDraftSchema)(draft);
    if (Either.isLeft(decoded)) return;
    written.current = encoded;
    port.retain(decoded.right, assets);
  }, [port, draft, assets, dirty, encoded]);
}
