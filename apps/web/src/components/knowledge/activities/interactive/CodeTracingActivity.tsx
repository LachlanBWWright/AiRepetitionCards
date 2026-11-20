import { useId } from "react";
import { Label, Textarea } from "@recall/ui-web";
export function CodeTracingActivity({
  code,
  language,
  value,
  disabled,
  onChange,
}: {
  readonly code: string;
  readonly language: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Trace this {language} program without running it and predict its output.
      </p>
      <pre
        className="max-h-96 overflow-auto rounded-lg bg-muted p-4 text-sm"
        tabIndex={0}
        aria-label={`${language} source code`}
      >
        <code data-language={language}>{code}</code>
      </pre>
      <Label htmlFor={id}>Predicted output</Label>
      <Textarea
        id={id}
        className="min-h-32 font-mono"
        value={value}
        disabled={disabled}
        maxLength={40_000}
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      <p className="text-xs text-muted-foreground">
        Case and leading whitespace matter. Line endings, trailing spaces and trailing blank lines
        are normalized when checking.
      </p>
    </div>
  );
}
