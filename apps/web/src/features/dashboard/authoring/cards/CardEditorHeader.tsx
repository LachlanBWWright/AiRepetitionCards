import type { ReactNode } from "react";
import { DialogHeader, DialogTitle, DialogDescription } from "@recall/ui-web/components/dialog";

export function CardEditorHeader({
  title,
  description,
  tools,
}: {
  readonly title: string;
  readonly description: string | undefined;
  readonly tools: ReactNode;
}) {
  return (
    <DialogHeader className="pr-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <DialogTitle id="card-dialog-title" className="text-xl">
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
        {tools}
      </div>
    </DialogHeader>
  );
}
