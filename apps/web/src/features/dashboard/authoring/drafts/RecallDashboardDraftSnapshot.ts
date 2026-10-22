import { formatTagInput, type LibraryDraft } from "@recall/application";
import type { ReviewPresentation, ImageOcclusion, AreaId } from "@recall/domain";
import type { Assessment, LearningArea, Workspace } from "@/features/workspace/types";

export type LibraryDraftSnapshotInput = {
  readonly addingArea: boolean;
  readonly areaTitle: string;
  readonly editingAreaId: string | null;
  readonly areaColor: string;
  readonly areaEditorId: AreaId | null;
  readonly areaBaseline: string | undefined;
  readonly areas: Workspace["areas"];
  readonly addingCard: boolean;
  readonly area: LearningArea | undefined;
  readonly editingCardId: string | null;
  readonly front: string;
  readonly back: string;
  readonly clozeText: string;
  readonly cardPresentation?: ReviewPresentation | undefined;
  readonly cardTags: string;
  readonly mediaFilePresent: boolean;
  readonly removedMediaIds: readonly string[];
  readonly sourceCard: Assessment | null;
  readonly imageOcclusion?: ImageOcclusion | undefined;
  readonly cardKind: "basic" | "cloze";
  readonly clozeIndex: string;
  readonly cardObjectiveIds: readonly string[];
  readonly cardBaseline: string | undefined;
};

export function snapshotLibraryDraft(input: LibraryDraftSnapshotInput): LibraryDraft | null {
  if (input.addingArea) {
    if (!input.editingAreaId && !input.areaTitle.trim()) return null;
    const original = input.areas.find((item) => item.id === input.editingAreaId);
    if (
      input.editingAreaId &&
      original?.title === input.areaTitle &&
      original.color === input.areaColor
    )
      return null;
    return {
      kind: "area",
      key: input.editingAreaId ? `area:${input.editingAreaId}` : "new-area",
      id: input.areaEditorId ?? "new",
      mode: input.editingAreaId ? "edit" : "create",
      title: input.areaTitle,
      color: input.areaColor,
      ...(input.areaBaseline === undefined ? {} : { baseline: input.areaBaseline }),
    };
  }
  if (
    !input.addingCard ||
    !input.area ||
    (!input.editingCardId &&
      !(
        input.front.trim() ||
        input.back.trim() ||
        input.clozeText.trim() ||
        input.cardTags.trim() ||
        input.mediaFilePresent ||
        input.removedMediaIds.length
      ))
  )
    return null;
  const source = input.sourceCard;
  if (
    source &&
    JSON.stringify(source.imageOcclusion) === JSON.stringify(input.imageOcclusion) &&
    JSON.stringify(source.presentation) === JSON.stringify(input.cardPresentation) &&
    source.front === input.front &&
    source.back === input.back &&
    (source.cloze?.text ?? "") === input.clozeText &&
    String(source.cloze?.deletionIndex ?? 1) === input.clozeIndex &&
    formatTagInput(source.tags ?? []) === input.cardTags &&
    JSON.stringify(source.objectiveIds ?? []) === JSON.stringify(input.cardObjectiveIds) &&
    input.removedMediaIds.length === 0 &&
    !input.mediaFilePresent &&
    (source.cloze ? "cloze" : "basic") === input.cardKind
  )
    return null;
  return {
    kind: "card",
    key: input.editingCardId ? `card:${input.editingCardId}` : `new-card:${input.area.id}`,
    areaId: input.area.id,
    id: input.editingCardId ?? "new",
    mode: input.editingCardId ? "edit" : "create",
    imageOcclusion: input.imageOcclusion,
    cardKind: input.cardKind,
    front: input.front,
    back: input.back,
    clozeText: input.clozeText,
    clozeIndex: input.clozeIndex,
    presentation: input.cardPresentation,
    tagsText: input.cardTags,
    objectiveIds: input.cardObjectiveIds,
    media: source?.media ?? [],
    removedMediaIds: input.removedMediaIds,
    ...(source ? { sourceCard: source } : {}),
    ...(input.cardBaseline === undefined ? {} : { baseline: input.cardBaseline }),
  };
}
