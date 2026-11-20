import type { ReactNode } from "react";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";

export function InsightsSection({
  value,
  title,
  description,
  children,
}: {
  readonly value: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <AccordionItem
      value={value}
      className="rounded-xl border border-border bg-[var(--surface)] last:border-b"
    >
      <AccordionTrigger variant="section">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-lg font-semibold leading-6">{title}</span>
          <span className="max-w-prose text-sm font-normal leading-5 text-muted-foreground">
            {description}
          </span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="flex min-w-0 flex-col gap-6 px-5 pb-5 pt-4">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}
