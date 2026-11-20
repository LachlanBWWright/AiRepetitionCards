import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";

export function StudyToolsDisclosure({
  undoAction,
  disabled,
  children,
}: {
  readonly undoAction: ReactNode;
  readonly disabled: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Collapsible className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {undoAction}
        <div className="w-40 shrink-0">
          <CollapsibleTrigger disabled={disabled}>Study tools</CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent>
        <div className="flex flex-wrap gap-2">{children}</div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Repeated failures are flagged for editing, never suspended automatically.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
