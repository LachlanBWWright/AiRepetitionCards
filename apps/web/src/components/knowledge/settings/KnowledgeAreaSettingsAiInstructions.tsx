import type { AreaSettings } from "@recall/application";
import { Textarea } from "@recall/ui-web";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@recall/ui-web/components/accordion";

const instructions = [
  {
    key: "tutorInstructions",
    label: "Tutor instructions",
    help: "Guide how the tutor explains and asks questions.",
  },
  {
    key: "quizInstructions",
    label: "Quiz instructions",
    help: "Describe the kinds of questions you want to practice.",
  },
  {
    key: "cardGenerationInstructions",
    label: "Card generation instructions",
    help: "Guide the style and detail of proposed cards.",
  },
] as const;

export function KnowledgeAreaSettingsAiInstructions({
  prefix,
  ai,
  onChange,
}: {
  readonly prefix: string;
  readonly ai: AreaSettings["ai"];
  readonly onChange: (ai: AreaSettings["ai"]) => void;
}) {
  return (
    <Accordion type="single" collapsible className="border-t">
      <AccordionItem value="ai-instructions" className="border-b-0">
        <AccordionTrigger id={`${prefix}-ai`}>AI instructions</AccordionTrigger>
        <AccordionContent>
          <div className="grid gap-4">
            {instructions.map((instruction) => (
              <InstructionField
                key={instruction.key}
                instruction={instruction}
                ai={ai}
                onChange={onChange}
              />
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function InstructionField({
  instruction,
  ai,
  onChange,
}: {
  readonly instruction: (typeof instructions)[number];
  readonly ai: AreaSettings["ai"];
  readonly onChange: (ai: AreaSettings["ai"]) => void;
}) {
  const { key, label, help } = instruction;
  return (
    <label className="grid gap-1.5">
      {label}
      <Textarea
        rows={3}
        maxLength={2000}
        value={ai[key] ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          onChange({
            ...ai,
            [key]: key === "tutorInstructions" ? value : value.trim() ? value : null,
          });
        }}
      />
      <small>
        {help} {(ai[key] ?? "").length}/2,000 characters
      </small>
    </label>
  );
}
