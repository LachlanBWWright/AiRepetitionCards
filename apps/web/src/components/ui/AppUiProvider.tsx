"use client";

import { AiFundingProvider } from "../tutor/funding/AiFundingProvider";
import { LocalChatGPTConnectionProvider } from "../tutor/connection/LocalChatGPTConnectionProvider";
import type { ReactNode } from "react";
import { Toaster, TooltipProvider } from "@recall/ui-web";

export function AppUiProvider({ children }: { readonly children: ReactNode }) {
  return (
    <TooltipProvider>
      <AiFundingProvider>
        <LocalChatGPTConnectionProvider>{children}</LocalChatGPTConnectionProvider>
      </AiFundingProvider>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
