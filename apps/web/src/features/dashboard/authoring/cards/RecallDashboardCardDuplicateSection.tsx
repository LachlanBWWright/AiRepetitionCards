import type { CardDuplicateCandidate, CardDuplicateContent } from "@recall/application";
import { CardDuplicateWarnings } from "@/components/knowledge/library/duplicates/CardDuplicateWarnings";

type Props = {
  readonly draft: CardDuplicateContent;
  readonly candidates: readonly CardDuplicateCandidate[];
  readonly editingCardId: string | null;
  readonly acknowledgement: string | null;
  readonly duplicateKey: string;
  readonly saving: boolean;
  readonly onAcknowledgementChange: (accepted: boolean) => void;
  readonly onOpenCandidate: (candidate: CardDuplicateCandidate) => void;
};

export function RecallDashboardCardDuplicateSection(props: Props) {
  return (
    <CardDuplicateWarnings
      draft={props.draft}
      candidates={props.candidates}
      {...(props.editingCardId ? { excludeCardId: props.editingCardId } : {})}
      keepBoth={props.acknowledgement === props.duplicateKey}
      onKeepBothChange={props.onAcknowledgementChange}
      disabled={props.saving}
      onOpenCandidate={props.onOpenCandidate}
    />
  );
}
