"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Label,
  Textarea,
  Alert,
  AlertDescription,
} from "@recall/ui-web";
import { CodingRubricFallback } from "./CodingRubricFallback";
import type { useLearningActivities } from "@recall/react";

export type CodingActivityWorkspaceProps = {
  readonly model: ReturnType<typeof useLearningActivities>;
  readonly disabled?: boolean;
};

export function CodingActivityWorkspace({ model, disabled = false }: CodingActivityWorkspaceProps) {
  const { content, execution, executionMode, message, busy, run, submit } = model.coding;
  if (!content)
    return (
      <section className="grid gap-3">
        <p>{model.activity?.fallback}</p>
        <Textarea
          aria-label="Your solution"
          value={model.response.answers[0] ?? ""}
          maxLength={40_000}
          disabled={disabled || !!model.result}
          onChange={(event) => {
            model.answer(0, event.target.value);
          }}
        />
        <CodingRubricFallback model={model} disabled={disabled} />
      </section>
    );
  const locked = disabled || busy || model.busy || !!model.result;
  const source = model.response.answers[0] ?? "";
  const revealHint = () => {
    model.setResponse((current) => ({
      ...current,
      assistance: current.assistance === "none" ? "hint" : current.assistance,
      interaction: { ...current.interaction, hints: Math.max(1, current.interaction?.hints ?? 0) },
    }));
  };
  return (
    <section className="grid gap-4" aria-label="Coding problem">
      <p className="text-sm text-muted-foreground">
        {content.language} · {content.mode === "short-review" ? "Short review" : "Practice"} ·
        solve(...inputs)
      </p>
      {content.prompts.map((prompt, index) => (
        <p key={index} className="whitespace-pre-wrap">
          {prompt}
        </p>
      ))}
      {content.signature && (
        <pre className="overflow-auto rounded-md bg-muted p-3">{content.signature}</pre>
      )}
      {!!content.constraints?.length && (
        <div>
          <h4 className="font-semibold">Constraints</h4>
          <ul className="list-inside list-disc">
            {content.constraints.map((constraint, index) => (
              <li key={index}>{constraint}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-2">
        <h4 className="font-semibold">Examples</h4>
        {(content.exampleTests ?? content.tests.slice(0, 1)).map((test, index) => (
          <pre
            key={index}
            className="overflow-auto rounded-md bg-muted p-3"
          >{`Input: ${JSON.stringify(test.input)}\nExpected: ${JSON.stringify(test.expected)}`}</pre>
        ))}
      </div>
      <Label htmlFor="coding-source">Your {content.language} solution</Label>
      <Textarea
        id="coding-source"
        className="min-h-64 font-mono"
        value={source}
        disabled={locked}
        maxLength={40_000}
        spellCheck={false}
        onChange={(event) => {
          model.answer(0, event.target.value);
        }}
      />
      {content.starterCode && (
        <Button
          variant="default"
          disabled={locked || !!source}
          onClick={() => {
            model.answer(0, content.starterCode ?? "");
          }}
        >
          Use starter code
        </Button>
      )}
      {!!content.hints?.length && (
        <Accordion
          type="single"
          collapsible
          onValueChange={(value) => {
            if (value) revealHint();
          }}
        >
          <AccordionItem value="hints">
            <AccordionTrigger disabled={locked}>Hints (marks assistance)</AccordionTrigger>
            <AccordionContent>
              <HintList hints={content.hints} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
      <p className="text-sm text-muted-foreground">
        Run checks public examples when provided, otherwise downloaded tests. Submit checks all
        downloaded tests and proposes an assessment. Accept it below to record one attempt. Your
        code is saved with your draft.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="default" disabled={locked || !source.trim()} onClick={run}>
          Run examples
        </Button>
        <Button disabled={locked || !source.trim()} onClick={submit}>
          Submit solution
        </Button>
      </div>
      <CodingRubricFallback model={model} disabled={locked} />
      {busy && <p role="status">Executing solution…</p>}
      {message && (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {execution && (
        <div role="status" className="grid gap-2 rounded-md border p-3">
          <p>
            {executionMode === "run" ? "Example run" : "Full submission"}:{" "}
            {execution.status ?? (execution.passed === execution.total ? "passed" : "failed")} ·{" "}
            {execution.passed}/{execution.total} passed
            {execution.runtimeMs === undefined ? "" : ` · ${String(execution.runtimeMs)} ms`}
          </p>
          {[...execution.failures, ...(execution.diagnostics ?? [])].map((diagnostic, index) => (
            <pre key={index} className="whitespace-pre-wrap text-sm">
              {diagnostic}
            </pre>
          ))}
          {execution.stdout && <pre className="whitespace-pre-wrap">{execution.stdout}</pre>}
        </div>
      )}
    </section>
  );
}

function HintList({ hints }: { readonly hints: readonly string[] }) {
  return hints.map((hint, index) => (
    <p key={index} className="whitespace-pre-wrap">
      {hint}
    </p>
  ));
}
