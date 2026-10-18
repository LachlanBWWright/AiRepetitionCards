import { Button, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import type { KnowledgeNotebookModel } from "../useKnowledgeNotebookModel";

type Props = {
  readonly question: NonNullable<KnowledgeNotebookModel["pendingQuestion"]>;
  readonly draft: Pick<KnowledgeNotebookModel, "answer" | "confidence">;
  readonly onAnswerChange: KnowledgeNotebookModel["setAnswer"];
  readonly onConfidenceChange: KnowledgeNotebookModel["setConfidence"];
  readonly onSubmit: KnowledgeNotebookModel["submitAnswer"];
  readonly onSaveDraft: () => void;
  readonly networkDisabled: boolean;
  readonly draftDisabled: boolean;
};
export function NotebookPracticeQuestion({
  question,
  draft,
  onAnswerChange,
  onConfidenceChange,
  onSubmit,
  onSaveDraft,
  networkDisabled,
  draftDisabled,
}: Props) {
  return (
    <>
      {question.explanation && (
        <div className="whitespace-pre-wrap">
          <h3 className="text-base font-semibold">Worked explanation</h3>
          <p>{question.explanation}</p>
        </div>
      )}
      <h3 className="max-w-prose text-xl font-semibold leading-relaxed">{question.question}</h3>
      <Label>
        Your answer
        <Textarea
          value={draft.answer}
          onChange={(event) => {
            onAnswerChange(event.target.value);
          }}
          maxLength={8000}
        />
      </Label>
      <Label>
        How confident are you?
        <Select
          value={draft.confidence}
          onValueChange={(value) => {
            if (value === "guess" || value === "unsure" || value === "confident")
              onConfidenceChange(value);
          }}
        >
          <SelectTrigger className="w-full" aria-label="How confident are you?">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="guess">A guess</SelectItem>
            <SelectItem value="unsure">Unsure</SelectItem>
            <SelectItem value="confident">Confident</SelectItem>
          </SelectContent>
        </Select>
      </Label>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="primary"
          disabled={networkDisabled || !draft.answer.trim()}
          onClick={() => {
            onSubmit(draft.answer);
          }}
        >
          Check answer
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="small"
          disabled={draftDisabled}
          onClick={onSaveDraft}
        >
          Save answer draft
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="small"
          disabled={networkDisabled}
          onClick={() => {
            onSubmit("I don't know yet.", "guess");
          }}
        >
          I don’t know
        </Button>
      </div>
    </>
  );
}
