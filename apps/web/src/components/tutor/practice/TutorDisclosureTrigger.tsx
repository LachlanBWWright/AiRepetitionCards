"use client";

import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { CollapsibleTrigger } from "@recall/ui-web/components/collapsible";
import { cn } from "@recall/ui-web/lib/utils";

export function TutorDisclosureTrigger({
  children,
  className,
  ...props
}: ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger
      {...props}
      className={cn(
        "group flex min-h-10 w-full items-center justify-between gap-3 rounded-md py-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <span>{children}</span>
      <ChevronDown
        className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
        aria-hidden="true"
      />
    </CollapsibleTrigger>
  );
}
