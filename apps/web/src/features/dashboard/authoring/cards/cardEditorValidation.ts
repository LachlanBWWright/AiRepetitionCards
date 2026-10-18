type CardDraft = {
  readonly kind: "basic" | "cloze";
  readonly front: string;
  readonly back: string;
  readonly hasClozePreview: boolean;
};

export function canSaveCardDraft(draft: CardDraft): boolean {
  return draft.kind === "cloze"
    ? draft.hasClozePreview
    : Boolean(draft.front.trim() && draft.back.trim());
}
