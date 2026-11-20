import { useState } from "react";
import { Effect } from "effect";
import type { AgentDialogue } from "@recall/application";
import { Button } from "@recall/ui-web";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@recall/ui-web/components/dialog";
import { AgentHandoverPanel } from "@/components/tutor/handover/AgentHandoverPanel";
import { browserAgentTransferPorts } from "@/components/tutor/handover/agent-transfer-ports";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";

export function DashboardAgentHandover({
  model,
  areaId,
  conversation,
}: {
  readonly model: RecallDashboardModel;
  readonly areaId: string;
  readonly conversation?: AgentDialogue;
}) {
  const [open, setOpen] = useState(false);
  const disabled =
    model.reviewSaving ||
    model.reviewSaveFailed ||
    model.cardSaving ||
    model.libraryMutation !== null ||
    (!model.demo && !model.cacheWritable);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Use external AI
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>External AI handover</DialogTitle>
          <DialogDescription>
            Copy context to another agent, then review its proposed deck changes.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <AgentHandoverPanel
            key={`${model.workspace.syncOwnerId ?? "local"}:${areaId}`}
            workspace={model.workspace}
            areaId={areaId}
            conversation={conversation}
            disabled={disabled}
            createId={() => crypto.randomUUID()}
            ports={browserAgentTransferPorts}
            saveChanges={(command) => model.saveAuthoringCommand(command).pipe(Effect.asVoid)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
