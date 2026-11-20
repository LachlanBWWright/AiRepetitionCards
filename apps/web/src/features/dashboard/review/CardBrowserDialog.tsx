import { Button } from "@recall/ui-web";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@recall/ui-web/components/dialog";
import { CardBrowser } from "./CardBrowser";
import { useState } from "react";
import { useWorkspaceShortcut } from "../navigation/useWorkspaceShortcut";
import type { StudyCommandSave } from "@recall/react";
import type { Assessment, LearningArea, Workspace } from "@recall/domain";

export function CardBrowserDialog({
  workspace,
  area,
  now,
  save,
  disabled,
  onEdit,
}: {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly now: number;
  readonly save: StudyCommandSave;
  readonly disabled: boolean;
  readonly onEdit: (card: Assessment) => void;
}) {
  const [open, setOpen] = useState(false);
  useWorkspaceShortcut("b", !disabled && !open, () => {
    setOpen(true);
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" disabled={disabled}>
          Browse cards
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[1120px]">
        <DialogHeader>
          <DialogTitle>Browse cards and notes</DialogTitle>
          <DialogDescription>
            Search across subjects, inspect related cards, and edit matching fields.
          </DialogDescription>
        </DialogHeader>
        <CardBrowser workspace={workspace} area={area} now={now} save={save} onEdit={onEdit} />
      </DialogContent>
    </Dialog>
  );
}
