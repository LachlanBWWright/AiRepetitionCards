import { NoteTemplateDeck } from "./NoteTemplateDeck";
import { NoteLifecycleEditor } from "./NoteLifecycleEditor";
import { ReviewPresentationSettings } from "@/components/cards/ReviewPresentationSettings";
import type { NoteAuthoringModel } from "@recall/react";
import { Input } from "@recall/ui-web/components/input";
import { Textarea } from "@recall/ui-web/components/textarea";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import { Button } from "@/components/ui/Button";
import { useState } from "react";

export function NoteTypeEditor({ model }: { readonly model: NoteAuthoringModel }) {
  const [fieldName, setFieldName] = useState("");
  const { type, setType } = model;
  return (
    <div className="grid gap-3 rounded border p-3">
      <label>
        Type name
        <Input
          value={type.name}
          onChange={(event) => {
            setType({ ...type, name: event.target.value });
          }}
          maxLength={80}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Templates use {"{{Field name}}"}. Type edits update every note using this type; clone the
        type to experiment independently.
      </p>
      <Button type="button" size="small" variant="secondary" onClick={model.cloneType}>
        Clone as a new type and note
      </Button>
      <NoteLifecycleEditor key={type.id} model={model} />
      {type.fields.map((field) => (
        <label key={field.name} className="flex gap-2 items-center">
          <Checkbox
            checked={field.sticky ?? false}
            onCheckedChange={(sticky) => {
              model.setSticky(field.name, sticky === true);
            }}
          />
          Keep {field.name} when adding another note
        </label>
      ))}
      <label>
        New field name
        <Input
          value={fieldName}
          onChange={(event) => {
            setFieldName(event.target.value);
          }}
          placeholder="Example"
          maxLength={80}
        />
      </label>
      <Button
        type="button"
        size="small"
        variant="secondary"
        disabled={
          !/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(fieldName) ||
          type.fields.some((field) => field.name === fieldName) ||
          type.fields.length >= 50
        }
        onClick={() => {
          setType({ ...type, fields: [...type.fields, { name: fieldName }] });
          model.setNote({ ...model.note, fields: { ...model.note.fields, [fieldName]: "" } });
          setFieldName("");
        }}
      >
        Add field
      </Button>
      {type.templates.map((template) => (
        <div key={template.id} className="grid gap-2 rounded border p-2">
          <label>
            Card template name
            <Input
              value={template.name}
              onChange={(event) => {
                model.updateTemplate(template.id, { name: event.target.value });
              }}
            />
          </label>
          <label>
            Question template
            <Textarea
              value={template.front}
              onChange={(event) => {
                model.updateTemplate(template.id, { front: event.target.value });
              }}
              rows={2}
            />
          </label>
          <label>
            Answer template
            <Textarea
              value={template.back}
              onChange={(event) => {
                model.updateTemplate(template.id, { back: event.target.value });
              }}
              rows={2}
            />
          </label>
          <NoteTemplateDeck model={model} templateId={template.id} />
          <ReviewPresentationSettings
            value={template.presentation}
            onChange={(presentation) => {
              model.updateTemplate(template.id, { presentation });
            }}
          />
          {type.templates.length > 1 && (
            <Button
              type="button"
              size="small"
              variant="secondary"
              onClick={() => {
                model.removeTemplate(template.id);
              }}
            >
              Remove template
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        size="small"
        variant="secondary"
        disabled={type.templates.length >= 20}
        onClick={model.addTemplate}
      >
        Add card template
      </Button>
      {model.affectsOthers && (
        <label className="flex items-center gap-2">
          <Checkbox
            checked={model.confirmedTypeChange}
            onCheckedChange={(value) => {
              model.setConfirmedTypeChange(value === true);
            }}
          />
          Apply these field and template changes to all notes using this type
        </label>
      )}
    </div>
  );
}
