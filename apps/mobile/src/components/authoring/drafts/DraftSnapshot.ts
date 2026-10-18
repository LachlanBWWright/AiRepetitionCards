import { formatTagInput, type LibraryDraft } from "@recall/application";
import type { Workspace } from "@recall/domain";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";

export function snapshotLibraryDraft(
  editor: Editor | null,
  workspace: Workspace | null,
): LibraryDraft | null {
  if (editor?.kind === "area") {
    if (editor.mode === "create" && !editor.title.trim()) return null;
    const saved = workspace?.areas.find((item) => item.id === editor.id);
    if (editor.mode === "edit" && saved?.title === editor.title && saved.color === editor.color)
      return null;
    return {
      kind: "area",
      key: editor.mode === "edit" ? `area:${editor.id}` : "new-area",
      id: editor.id,
      mode: editor.mode,
      title: editor.title,
      color: editor.color,
      ...(editor.baseline === undefined ? {} : { baseline: editor.baseline }),
    };
  }
  if (editor?.kind !== "card") return null;
  const content = editor.content;
  if (
    editor.mode === "create" &&
    !(
      content.front.trim() ||
      content.back.trim() ||
      content.cloze?.text.trim() ||
      editor.tagsText.trim() ||
      content.media.length
    )
  )
    return null;
  const source = editor.sourceCard;
  if (
    source &&
    (source.cloze ? "cloze" : "basic") === content.kind &&
    source.front === content.front &&
    source.back === content.back &&
    (source.cloze?.text ?? "") === (content.cloze?.text ?? "") &&
    (source.cloze?.deletionIndex ?? 1) === (content.cloze?.deletionIndex ?? 1) &&
    formatTagInput(source.tags ?? []) === editor.tagsText &&
    JSON.stringify(source.media ?? []) === JSON.stringify(content.media) &&
    JSON.stringify(source.objectiveIds ?? []) === JSON.stringify(content.objectiveIds)
  )
    return null;
  return {
    kind: "card",
    key: editor.mode === "edit" ? `card:${editor.id}` : `new-card:${editor.areaId}`,
    areaId: editor.areaId,
    id: editor.id,
    mode: editor.mode,
    cardKind: content.kind,
    front: content.front,
    back: content.back,
    clozeText: content.cloze?.text ?? "",
    clozeIndex: String(content.cloze?.deletionIndex ?? 1),
    tagsText: editor.tagsText,
    objectiveIds: content.objectiveIds,
    media: content.media,
    removedMediaIds: [],
    ...(source ? { sourceCard: source } : {}),
    ...(editor.baseline === undefined ? {} : { baseline: editor.baseline }),
  };
}
