import type { ReactNode } from "react";
import { Label, Textarea, WorkflowSections } from "@recall/ui-web";
import { Alert, AlertDescription } from "@recall/ui-web/components/alert";

export function StudyMaterialsWorkflow({
  sources,
  goal,
  onGoalChange,
  disabled,
  importPanel,
  generationPanel,
  notice,
}: {
  readonly goal: string;
  readonly onGoalChange: (goal: string) => void;
  readonly disabled: boolean;
  readonly sources: (view: "text" | "topics") => ReactNode;
  readonly importPanel: ReactNode;
  readonly generationPanel: ReactNode;
  readonly notice: string | null;
}) {
  const topics = (
    <>
      <Label className="flex flex-col items-stretch gap-2">
        Study goal
        <Textarea
          disabled={disabled}
          value={goal}
          maxLength={2000}
          onChange={(event) => {
            onGoalChange(event.target.value);
          }}
        />
      </Label>
      {sources("topics")}
    </>
  );
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6" aria-label="Study materials">
      <header className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold tracking-tight">Study materials</h3>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Import your notes, check the text, choose topics, then generate source-backed cards.
        </p>
      </header>
      <WorkflowSections
        label="Study material steps"
        sections={[
          { id: "import", label: "1. Import", content: importPanel },
          { id: "text", label: "2. Check text", content: sources("text") },
          {
            id: "topics",
            label: "3. Choose topics",
            content: topics,
          },
          {
            id: "generate",
            label: "4. Generate",
            content: generationPanel ?? <p>Import a material first to generate cards.</p>,
          },
        ]}
      />
      {notice && (
        <Alert variant="destructive">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
