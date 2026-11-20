import { ReviewHelpOptions } from "./ReviewHelpOptions";
import { CardRichText } from "@/components/cards/CardRichText";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@recall/ui-web/components/accordion";
import { Label } from "@recall/ui-web/components/label";
import { useReviewRepair } from "@recall/react";
import {
  reviewRepairCopy as copy,
  reviewRepairApprovalNote,
  type requestReviewRepair,
} from "@recall/application";
import type { StudyCommandSave } from "@recall/react";
import type { Assessment, LearningArea, Workspace } from "@recall/domain";
import { Button } from "@recall/ui-web";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import { useEffect } from "react";

export function ReviewRepairPanel({
  api,
  workspace,
  area,
  card,
  save,
  disabled,
  onBusyChange,
}: {
  readonly api: Parameters<typeof requestReviewRepair>[0];
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly card: Assessment;
  readonly save: StudyCommandSave;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
}) {
  const repair = useReviewRepair({
    api,
    workspace,
    area,
    card,
    save,
    disabled,
    createId: () => crypto.randomUUID(),
    clock: Date.now,
  });
  useEffect(() => {
    onBusyChange(repair.busy);
  }, [repair.busy, onBusyChange]);
  const acknowledgeDuplicates = (value: boolean | "indeterminate") => {
    repair.setAllowDuplicates(value === true);
  };
  return (
    <section className="space-y-4" aria-label="Review card assistance">
      <div className="min-w-0 rounded-xl border bg-muted/20 px-4 py-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{copy.context}</p>
        <CardRichText text={card.front} className="text-sm leading-6" />
        <Accordion type="single" collapsible>
          <AccordionItem value="answer" className="border-0">
            <AccordionTrigger>{copy.answer}</AccordionTrigger>
            <AccordionContent>
              <CardRichText text={card.back} className="text-sm leading-6" />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      <ReviewHelpOptions disabled={disabled || repair.busy} onRequest={repair.request} />
      {repair.busy && (
        <div role="status" className="rounded-xl border p-5 text-sm text-muted-foreground">
          {copy.working}
        </div>
      )}
      {repair.message && <p role={repair.messageIsError ? "alert" : "status"}>{repair.message}</p>}
      {repair.visibleProposal?.kind === "explanation" && (
        <section className="min-w-0 space-y-3 border-t pt-5" aria-label="Tutor response">
          <h3 className="font-semibold">{copy.response}</h3>
          <CardRichText text={repair.visibleProposal.text} className="text-[15px] leading-7" />
        </section>
      )}
      {repair.visibleProposal?.kind === "cards" && (
        <div className="space-y-4">
          <div className="rounded-md border p-4">
            <h3 className="font-semibold">{copy.original}</h3>
            <CardRichText text={repair.original.front} className="text-sm leading-6" />
            <CardRichText text={repair.original.back} className="text-sm leading-6" />
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold">{copy.proposed}</h3>
            {repair.visibleProposal.refinement.cards.map((item, index) => (
              <div key={index} className="space-y-2 rounded-md border p-4">
                <CardRichText text={item.front} className="text-sm font-medium leading-6" />
                <CardRichText text={item.back} className="text-sm leading-6" />
                <p className="text-sm text-muted-foreground">{item.rationale}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {reviewRepairApprovalNote(repair.visibleProposal.action)}
          </p>
          {repair.duplicates && (
            <Label className="flex items-center gap-2">
              <Checkbox
                checked={repair.allowDuplicates}
                disabled={repair.busy}
                onCheckedChange={acknowledgeDuplicates}
              />
              {copy.duplicates}
            </Label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!repair.canApprove} onClick={repair.approve}>
              {copy.approve}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={repair.busy}
              onClick={repair.discard}
            >
              {copy.discard}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
