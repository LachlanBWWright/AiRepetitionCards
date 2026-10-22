import type { NoteAuthoringModel } from "@recall/react";
import { RichTextEditor } from "@/components/cards/RichTextEditor";
import { useId } from "react";
import type { MediaReference } from "@recall/domain";
export function NoteFields({
  model,
  disabled,
}: {
  readonly model: NoteAuthoringModel;
  readonly disabled: boolean;
}) {
  return (
    <>
      {model.type.fields.map((field) => (
        <NoteField
          key={field.name}
          label={`${field.name}${field.sticky ? " (kept for next note)" : ""}`}
          value={model.note.fields[field.name] ?? ""}
          onChange={(value) => {
            model.updateField(field.name, value);
          }}
          media={model.note.media ?? []}
          disabled={disabled}
        />
      ))}
    </>
  );
}
function NoteField({
  label,
  value,
  onChange,
  media,
  disabled,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly media: readonly MediaReference[];
  readonly disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="grid gap-0 overflow-hidden rounded-xl border border-border bg-background/40 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
      <label htmlFor={id} className="px-4 pt-4 pb-2 text-sm font-medium">
        {label}
      </label>
      <RichTextEditor
        id={id}
        value={value}
        onChange={onChange}
        showPreview={false}
        media={media}
        disabled={disabled}
        className="min-h-28 resize-y border-0 bg-transparent px-4 text-base leading-relaxed shadow-none focus-visible:ring-0"
        rows={3}
        maxLength={20000}
      />
    </div>
  );
}
