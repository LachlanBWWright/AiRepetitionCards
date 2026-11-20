"use client";
import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { disclosureTriggerStyles } from "./disclosure-styles";
import { cn } from "cn";

function Accordion(props: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}
function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b last:border-b-0", className)}
      {...props}
    />
  );
}
function AccordionTrigger({
  className,
  children,
  variant = "default",
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger> & {
  readonly variant?: "default" | "section" | "compact";
}) {
  return (
    <AccordionPrimitive.Header className="flex text-base font-semibold">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          disclosureTriggerStyles,
          "flex-1 my-1 [&[data-state=open]>svg]:rotate-180",
          variant === "section" &&
            "my-0 min-h-16 rounded-xl px-5 py-4 [&>svg]:self-start [&>svg]:mt-1",
          variant === "compact" &&
            "my-0 w-fit flex-none justify-start gap-2 px-0 text-sm text-muted-foreground",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}
function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div className={cn("pt-0 pb-4", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
