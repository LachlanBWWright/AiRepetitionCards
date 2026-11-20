import { Alert } from "@recall/ui-web/components/alert";
import { FieldError } from "@recall/ui-web/components/field";
import { Label } from "@recall/ui-web/components/label";
import { useState } from "react";
import { Either } from "effect";
import type { NoteAuthoringModel } from "@recall/react";
import { Input } from "@recall/ui-web/components/input";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { Button } from "@/components/ui/Button";

function SourceSelect({
  value,
  options,
  label,
  onChange,
}: {
  readonly value: string;
  readonly options: readonly { readonly id: string; readonly name: string }[];
  readonly label: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Label className="grid gap-2 text-sm">
      {label}
      <Select
        value={value || "__new"}
        onValueChange={(value) => {
          onChange(value === "__new" ? "" : value);
        }}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__new">Create empty / new</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Label>
  );
}
export function NoteLifecycleEditor({ model }: { readonly model: NoteAuthoringModel }) {
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  return (
    <div className="grid gap-3">
      {model.type.fields.map((field, index) => (
        <div key={field.name} className="grid gap-2 border-b pb-3">
          <Label className="grid gap-2 text-sm">
            Field name
            <Input
              value={names[field.name] ?? field.name}
              maxLength={80}
              onChange={(event) => {
                setNames({ ...names, [field.name]: event.target.value });
              }}
            />
          </Label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={
                !names[field.name] ||
                names[field.name] === field.name ||
                model.type.fields.some((item) => item.name === names[field.name]) ||
                !/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(names[field.name] ?? "")
              }
              onClick={() => {
                model.renameField(field.name, names[field.name] ?? field.name);
                setNames({});
              }}
            >
              Rename
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={index === 0}
              onClick={() => {
                model.moveField(field.name, -1);
              }}
            >
              Move up
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={index === model.type.fields.length - 1}
              onClick={() => {
                model.moveField(field.name, 1);
              }}
            >
              Move down
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={model.type.fields.length === 1}
              onClick={() => {
                model.removeField(field.name);
              }}
            >
              Remove {field.name}
            </Button>
          </div>
        </div>
      ))}
      {model.savedNote && (
        <Label className="grid gap-2 text-sm">
          Change note type
          <Select
            value={model.type.id}
            onValueChange={(id) => {
              const type = model.types.find((item) => item.id === id);
              if (type) model.convertType(type);
            }}
          >
            <SelectTrigger className="w-full" aria-label="Change note type">
              <SelectValue />
            </SelectTrigger>
            <NoteTypeOptions model={model} />
          </Select>
        </Label>
      )}
      {model.savedNote && model.sourceType && model.savedNote.typeId !== model.type.id && (
        <>
          {model.type.fields.map((field) => (
            <SourceSelect
              key={field.name}
              label={`${field.name}: source field`}
              value={model.migration?.fields[field.name] ?? ""}
              options={
                model.sourceType?.fields.map((item) => ({ id: item.name, name: item.name })) ?? []
              }
              onChange={(source) => {
                model.mapField(field.name, source);
              }}
            />
          ))}
          {model.type.templates.map((template) => (
            <SourceSelect
              key={template.id}
              label={`${template.name}: preserve schedule from`}
              value={model.migration?.templates[template.id] ?? ""}
              options={model.sourceType?.templates ?? []}
              onChange={(source) => {
                model.mapTemplate(template.id, source);
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}
export function NoteLifecycleImpact({ model }: { readonly model: NoteAuthoringModel }) {
  const plan = model.lifecyclePlan;
  if (Either.isLeft(plan)) return <FieldError>{plan.left.message}</FieldError>;
  if (!plan.right.requiresConfirmation) return null;
  return (
    <Alert variant="destructive" className="grid gap-2">
      {plan.right.removed.length > 0 && (
        <p>
          {plan.right.removed.length} {plan.right.removed.length === 1 ? "card" : "cards"} will move
          to recoverable trash.
        </p>
      )}
      {plan.right.discardedValues.length > 0 && (
        <p>
          {plan.right.discardedValues.length}{" "}
          {plan.right.discardedValues.length === 1
            ? "nonempty field value"
            : "nonempty field values"}{" "}
          will be removed.
        </p>
      )}
      {plan.right.removed.map((card) => (
        <p key={card.id} className="truncate">
          Card: {card.front}
        </p>
      ))}
      {plan.right.discardedValues.map((value) => (
        <p key={`${value.noteId}:${value.field}`} className="break-words">
          {value.field}: {value.value}
        </p>
      ))}
      <Label className="flex items-center gap-2">
        <Checkbox
          checked={model.migration?.confirmRemoval ?? false}
          onCheckedChange={(value) => {
            model.confirmRemoval(value === true);
          }}
        />
        Apply these removals when saving
      </Label>
    </Alert>
  );
}

function NoteTypeOptions({ model }: { readonly model: NoteAuthoringModel }) {
  return (
    <SelectContent>
      {model.types.map((type) => (
        <SelectItem key={type.id} value={type.id}>
          {type.name}
        </SelectItem>
      ))}
    </SelectContent>
  );
}
