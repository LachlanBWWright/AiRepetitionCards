"use client";

import type { ReactNode } from "react";
import { Toaster, TooltipProvider } from "@recall/ui-web";

export function AppUiProvider({ children }: { readonly children: ReactNode }) {
  return (
    <TooltipProvider>
      {children}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
