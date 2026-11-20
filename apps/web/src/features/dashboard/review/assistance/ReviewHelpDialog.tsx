import { reviewRepairCopy as copy } from "@recall/application";
import type { ReactNode } from "react";
import { Pause } from "lucide-react";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";

export function ReviewHelpDialog({ children }: { readonly children: ReactNode }) {
  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto p-5 sm:max-w-[760px] sm:p-8">
      <DialogHeader>
        <DialogTitle className="text-xl">{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      {children}
      <p className="flex items-start gap-2 border-t pt-4 text-xs leading-5 text-muted-foreground">
        <Pause className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {copy.paused}
      </p>
    </DialogContent>
  );
}
