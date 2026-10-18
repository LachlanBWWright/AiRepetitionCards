import { Either, Effect } from "effect";
import {
  findCardDuplicates,
  findDuplicateCardPairs,
  renderClozeCard,
  toKnowledgeArea,
  workspaceDuplicateCandidates,
  type LibraryNotes,
} from "@recall/application";
import type { CardProposal } from "@recall/ai-core";
import type { LearningArea, Workspace } from "@recall/domain";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";

type DerivedCardViewInput = {
  readonly editor: Editor | null;
  readonly area: LearningArea | undefined;
  readonly workspace: Workspace | null;
  readonly showDuplicates: boolean;
  readonly keptDuplicateDraft: string | null;
  readonly query: string;
  readonly objectiveFilter: string;
  readonly objectives: LearningArea["objectives"];
  readonly flaggedOnly: boolean;
  readonly notes: LibraryNotes;
};

export function deriveCardViews({
  editor,
  area,
  workspace,
  showDuplicates,
  keptDuplicateDraft,
  query,
  objectiveFilter,
  objectives,
  flaggedOnly,
  notes,
}: DerivedCardViewInput) {
  const editorArea =
    editor && "areaId" in editor
      ? workspace?.areas.find((item) => item.id === editor.areaId)
      : area;
  const assistanceArea = editorArea
    ? Effect.runSync(Effect.either(toKnowledgeArea(editorArea, false, true)))
    : null;
  const clozePreview =
    editor?.kind === "card" && editor.content.kind === "cloze"
      ? Effect.runSync(
          Effect.either(
            renderClozeCard(
              editor.content.cloze?.text ?? "",
              editor.content.cloze?.deletionIndex ?? 1,
            ),
          ),
        )
      : null;
  const assistanceContent: CardProposal | null =
    editor?.kind === "card" &&
    (editor.content.kind === "basic"
      ? Boolean(editor.content.front.trim() && editor.content.back.trim())
      : Boolean(clozePreview && Either.isRight(clozePreview)))
      ? {
          front:
            editor.content.kind === "cloze"
              ? (editor.content.cloze?.text ?? "")
              : editor.content.front,
          back:
            clozePreview && Either.isRight(clozePreview)
              ? clozePreview.right.back
              : editor.content.back,
          objectiveId: editor.content.objectiveIds[0] ?? null,
          rationale: "Improve this library card.",
        }
      : null;
  const duplicateCandidates = workspace ? workspaceDuplicateCandidates(workspace) : [];
  const draftDuplicates =
    editor?.kind === "card"
      ? findCardDuplicates(
          {
            front: editor.content.front,
            back: editor.content.back,
            ...(editor.content.cloze ? { cloze: editor.content.cloze } : {}),
          },
          duplicateCandidates,
          { excludeCardId: editor.id, limit: 5 },
        )
      : [];
  const duplicateDraftKey =
    editor?.kind === "card" ? JSON.stringify([editor.id, editor.content, draftDuplicates]) : "";
  const duplicatesAccepted = keptDuplicateDraft === duplicateDraftKey;
  const duplicatePairs = showDuplicates
    ? findDuplicateCardPairs(duplicateCandidates, { limit: 50 })
    : [];
  const filteredCards =
    area?.cards.filter((card) => {
      const matchesSearch =
        `${card.front} ${card.back} ${card.tags?.join(" ") ?? ""} ${card.objective}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase());
      const matchesObjective =
        !objectiveFilter ||
        (objectives ?? []).some(
          (objective) =>
            `id:${objective.id}` === objectiveFilter &&
            ((card.objectiveIds ?? []).includes(objective.id) ||
              card.objective === objective.title),
        ) ||
        `title:${card.objective}` === objectiveFilter;
      return (
        matchesSearch &&
        matchesObjective &&
        (!flaggedOnly || notes.flaggedCardIds.includes(card.id))
      );
    }) ?? [];

  return {
    editorArea,
    assistanceArea,
    assistanceContent,
    clozePreview,
    draftDuplicates,
    duplicateDraftKey,
    duplicatesAccepted,
    duplicatePairs,
    filteredCards,
  };
}
