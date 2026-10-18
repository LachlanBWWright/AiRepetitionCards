import { Either, Effect, Schema } from "effect";
import { isSupportedMediaContent } from "@recall/application";
import { MediaReferenceSchema } from "@recall/domain";
import type { StoredMediaAsset } from "@recall/local-store";
import type { Dispatch, SetStateAction } from "react";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";
import type { CounterAccess, RefAccess } from "../RefAccess";

type Dependencies = {
  readonly editor: Editor | null;
  readonly disabled: boolean;
  readonly saveActive: RefAccess<boolean>;
  readonly pickerToken: RefAccess<number | null>;
  readonly editorGeneration: CounterAccess;
  readonly mounted: RefAccess<boolean>;
  readonly onPickAttachment:
    (() => Effect.Effect<StoredMediaAsset | null, { readonly message: string }>) | undefined;
  readonly setPicking: Dispatch<SetStateAction<boolean>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly setEditor: Dispatch<SetStateAction<Editor | null>>;
};

export function createAttachmentPicker(dependencies: Dependencies) {
  const {
    editor,
    disabled,
    saveActive,
    pickerToken,
    editorGeneration,
    mounted,
    onPickAttachment,
    setPicking,
    setMessage,
    setEditor,
  } = dependencies;

  return async function pickAttachment(): Promise<void> {
    if (
      disabled ||
      saveActive.get() ||
      pickerToken.get() !== null ||
      !onPickAttachment ||
      editor?.kind !== "card"
    )
      return;
    if (editor.content.media.length >= 20) {
      setMessage("A card can have up to 20 attachments. Remove one before adding another.");
      return;
    }
    const generation = editorGeneration.get();
    pickerToken.set(generation);
    setPicking(true);
    setMessage(null);
    const result = await Effect.runPromise(Effect.either(onPickAttachment()));
    if (!mounted.get() || editorGeneration.get() !== generation || pickerToken.get() !== generation)
      return;
    pickerToken.set(null);
    setPicking(false);
    if (Either.isLeft(result)) {
      setMessage(result.left.message);
      return;
    }
    const asset = result.right;
    if (!asset) return;
    const reference = Schema.decodeUnknownEither(MediaReferenceSchema)(asset.reference);
    if (
      Either.isLeft(reference) ||
      asset.bytes.byteLength !== asset.reference.byteLength ||
      !isSupportedMediaContent(asset.bytes, asset.reference.mimeType)
    ) {
      setMessage("Choose a supported image or audio file smaller than 20 MB.");
      return;
    }
    setEditor((current) => {
      if (current?.kind !== "card" || current.id !== editor.id) return current;
      if (current.content.media.some((item) => item.id === asset.reference.id)) return current;
      return {
        ...current,
        content: { ...current.content, media: [...current.content.media, asset.reference] },
        stagedAssets: [...current.stagedAssets, asset],
      };
    });
  };
}
