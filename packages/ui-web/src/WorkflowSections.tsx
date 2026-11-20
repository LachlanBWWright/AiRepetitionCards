"use client";

import { useState, type ReactNode, type ComponentProps } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/tabs";

type Section = {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
};

/** Keep fields mounted so switching tasks preserves local drafts and pending work. */
export function WorkflowSections({
  label,
  sections,
}: {
  readonly label: string;
  readonly sections: readonly Section[];
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  const revealInvalidField: ComponentProps<typeof Tabs>["onInvalidCapture"] = (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const field = event.target;
    const section = field.closest<HTMLElement>("[data-workflow-section]");
    const sectionId = section?.dataset.workflowSection;
    if (!sectionId || sectionId === active) return;
    event.preventDefault();
    setActive(sectionId);
    requestAnimationFrame(() => {
      field.focus();
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement ||
        field instanceof HTMLSelectElement
      )
        field.reportValidity();
    });
  };
  return (
    <Tabs
      value={active}
      onValueChange={setActive}
      className="flex min-w-0 flex-col gap-4"
      onInvalidCapture={revealInvalidField}
    >
      <TabsList aria-label={label} className="grid h-auto w-full grid-cols-2 gap-1 sm:flex">
        {sections.map((section) => (
          <TabsTrigger key={section.id} value={section.id} className="min-h-10 whitespace-normal">
            {section.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {sections.map((section) => (
        <TabsContent
          key={section.id}
          value={section.id}
          forceMount
          data-workflow-section={section.id}
          className="flex min-w-0 flex-col gap-6 data-[state=inactive]:hidden"
        >
          {section.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
