import type { AnswerDifference } from "@recall/application";
import { useTypedAnswer } from "@recall/react";
import type { Assessment } from "@recall/domain";
import { Input } from "@recall/ui-web/components/input";

export function TypedReviewAnswer({
  card,
  revealed,
  disabled,
  onReveal,
}: {
  readonly card: Assessment;
  readonly revealed: boolean;
  readonly disabled: boolean;
  readonly onReveal: () => void;
}) {
  const typed = useTypedAnswer(card);
  if (!typed.enabled) return null;
  return (
    <div className="mx-auto mb-4 grid w-full max-w-md gap-2 px-4">
      {!revealed ? (
        <label className="grid gap-2 text-sm">
          Type your answer
          <Input
            value={typed.answer}
            disabled={disabled}
            maxLength={20_000}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              typed.setAnswer(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onReveal();
              }
            }}
          />
        </label>
      ) : (
        <div role="status" className="grid gap-2 text-sm">
          <p>Your answer: {typed.answer || "(blank)"}</p>
          <p>{typed.comparison?.matches ? "Answer matches." : "Compare your answer:"}</p>
          <p>
            {typed.comparison?.differences.map((part, index) => (
              <AnswerPart key={index} part={part} />
            ))}
          </p>
          <p className="text-muted-foreground">Choose a rating based on your recall.</p>
        </div>
      )}
    </div>
  );
}

function AnswerPart({ part }: { readonly part: AnswerDifference }) {
  if (part.kind === "extra") return <del className="text-destructive">{part.text} </del>;
  if (part.kind === "missing") return <ins className="text-green-700">{part.text} </ins>;
  return <span>{part.text} </span>;
}
