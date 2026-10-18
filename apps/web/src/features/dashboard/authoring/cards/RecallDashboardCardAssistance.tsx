import type { ComponentProps } from "react";
import type { KnowledgeArea } from "@recall/domain";
import type { CardDuplicateCandidate } from "@recall/application";
import { CardAssistancePanel } from "@/components/tutor/assistance/CardAssistancePanel";
import { LocalChatGPTTutor as TutorPanel } from "@/components/tutor/connection/LocalChatGPTTutor";

type Refinement = ComponentProps<typeof CardAssistancePanel>["onApply"];
type Preview = { readonly front: string; readonly back: string };
type Props = {
  readonly area: KnowledgeArea | null;
  readonly candidates: readonly CardDuplicateCandidate[];
  readonly cardKind: "basic" | "cloze";
  readonly front: string;
  readonly back: string;
  readonly clozeText: string;
  readonly clozePreview: Preview | null;
  readonly objectiveId: string | null;
  readonly editingCardId: string | null;
  readonly saving: boolean;
  readonly mediaFile: File | null;
  readonly stale: boolean;
  readonly demo: boolean;
  readonly ready: boolean;
  readonly cacheWritable: boolean;
  readonly onBusyChange: (saving: boolean) => void;
  readonly onApply: Refinement;
};

export function RecallDashboardCardAssistance(props: Props) {
  const { area, candidates } = props;
  const canAssist = Boolean(
    area &&
    (props.cardKind === "basic" ? props.front.trim() && props.back.trim() : props.clozePreview),
  );
  if (!area || !canAssist) return null;
  return (
    <TutorPanel
      knowledgeArea={area}
      duplicateCandidates={candidates}
      onApprove={() => Promise.resolve(null)}
      renderContent={(api) => (
        <CardAssistancePanel
          key={props.editingCardId ?? "new-card"}
          proposal={{
            front: props.cardKind === "cloze" ? props.clozeText : props.front,
            back:
              props.cardKind === "cloze" && props.clozePreview
                ? props.clozePreview.back
                : props.back,
            objectiveId: props.objectiveId,
            rationale: "Improve this library card.",
          }}
          knowledgeArea={area}
          api={api}
          existingCard={Boolean(props.editingCardId)}
          duplicateCandidates={candidates}
          {...(props.editingCardId ? { excludeCardId: props.editingCardId } : {})}
          onBusyChange={props.onBusyChange}
          disabled={
            props.saving ||
            Boolean(props.mediaFile) ||
            props.stale ||
            (!props.demo && (!props.ready || !props.cacheWritable))
          }
          onApply={props.onApply}
        />
      )}
    />
  );
}
