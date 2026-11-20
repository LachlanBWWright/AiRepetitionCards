import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Effect, Either } from "effect";
import { toKnowledgeArea } from "@recall/application";
import type { StudyCommandSave } from "@recall/react";
import type { Assessment, LearningArea, Workspace } from "@recall/domain";
import { Button } from "@recall/ui-web";
import { Dialog, DialogTrigger } from "@recall/ui-web/components/dialog";
import { ReviewHelpDialog } from "./ReviewHelpDialog";
import { LocalChatGPTTutor } from "@/components/tutor/connection/LocalChatGPTTutor";
import { ReviewRepairPanel } from "./ReviewRepairPanel";

export function ReviewCardHelp({
  workspace,
  area,
  card,
  save,
  disabled,
  onInteractionChange,
}: {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly card: Assessment;
  readonly save: StudyCommandSave;
  readonly disabled: boolean;
  readonly onInteractionChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const document = useMemo(
    () => Effect.runSync(Effect.either(toKnowledgeArea(area, true, true))),
    [area],
  );
  useEffect(
    () => () => {
      onInteractionChange(false);
    },
    [onInteractionChange],
  );
  if (Either.isLeft(document)) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          setOpen(value);
          onInteractionChange(value);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="default"
          className="w-full sm:w-auto"
          disabled={disabled}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          Help with this card
        </Button>
      </DialogTrigger>
      <ReviewHelpDialog>
        <LocalChatGPTTutor
          knowledgeArea={document.right}
          onApprove={() => Promise.resolve(null)}
          renderContent={(api, context) => (
            <div className="space-y-4">
              {context.unavailableReason && <p role="status">{context.unavailableReason}</p>}
              {context.connectionPrompt}
              <ReviewRepairPanel
                api={api}
                workspace={workspace}
                area={area}
                card={card}
                save={save}
                disabled={disabled || Boolean(context.unavailableReason)}
                onBusyChange={setBusy}
              />
            </div>
          )}
        />
      </ReviewHelpDialog>
    </Dialog>
  );
}
