"use client";

import type { ReactNode } from "react";
import { Dialog as ShadcnDialog, DialogContent } from "./components/dialog";

export function Dialog({
  labelledBy,
  onClose,
  children,
  showCloseButton,
}: {
  readonly labelledBy: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly showCloseButton?: boolean;
}) {
  return (
    <ShadcnDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-labelledby={labelledBy}
        className="max-h-[calc(100dvh-2.5rem)] overflow-y-auto"
        {...(showCloseButton === undefined ? {} : { showCloseButton })}
      >
        {children}
      </DialogContent>
    </ShadcnDialog>
  );
}
