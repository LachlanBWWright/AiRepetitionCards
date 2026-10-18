import { useState, type ReactNode } from "react";
import { Plus, Shapes } from "lucide-react";
import { Button } from "@recall/ui-web";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@recall/ui-web/components/dialog";
export function RecallSubjectActivityDialog({
  children,
  initialActivityId,
  onAdd,
}: {
  readonly children: ReactNode;
  readonly initialActivityId: string | undefined;
  readonly onAdd: () => void;
}) {
  const [open, setOpen] = useState(Boolean(initialActivityId));
  const [requestedActivity, setRequestedActivity] = useState(initialActivityId);
  if (requestedActivity !== initialActivityId) {
    setRequestedActivity(initialActivityId);
    if (initialActivityId) setOpen(true);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Card library</h2>
        <div className="flex items-center gap-2">
          <DialogTrigger asChild>
            <Button variant="secondary">
              <Shapes aria-hidden="true" className="size-4" />
              Learning activities
            </Button>
          </DialogTrigger>
          <Button onClick={onAdd}>
            <Plus aria-hidden="true" className="size-4" />
            Add card
          </Button>
        </div>
      </div>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Learning activities</DialogTitle>
          <DialogDescription>
            Practice with exercises and track evidence against your learning objectives.
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
