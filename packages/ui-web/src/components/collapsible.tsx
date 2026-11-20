"use client";
import * as React from "react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { disclosureTriggerStyles } from "./disclosure-styles";

function Collapsible(props: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}
function CollapsibleTrigger({
  className,
  children,
  asChild = false,
  variant = "default",
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger> & {
  readonly variant?: "default" | "content";
}) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      asChild={asChild}
      className={cn(
        disclosureTriggerStyles,
        variant === "content" && "px-0 text-[15px] leading-6",
        className,
      )}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </>
      )}
    </CollapsiblePrimitive.Trigger>
  );
}
function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      className={cn("min-w-0 pt-3", className)}
      {...props}
    />
  );
}
export { Collapsible, CollapsibleContent, CollapsibleTrigger };
