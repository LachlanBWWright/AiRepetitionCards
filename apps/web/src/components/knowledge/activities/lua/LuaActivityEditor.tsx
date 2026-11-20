"use client";
import { Button, Input, Label, Textarea } from "@recall/ui-web";
import type { LearningActivity } from "@recall/domain";
import { luaAuthoringFields, type LuaAuthoringValues, type LuaRuntime } from "@recall/application";
import { useLuaAuthoringPreview } from "@recall/react";
import { LuaActivityWorkspace } from "./LuaActivityWorkspace";

export type LuaActivityEditorProps = {
  readonly fields: LuaAuthoringValues;
  readonly onField: (key: string, value: string) => void;
  readonly activity: LearningActivity;
  readonly runtime: LuaRuntime;
  readonly disabled?: boolean;
};
export function LuaActivityEditor(props: LuaActivityEditorProps) {
  const model = useLuaAuthoringPreview(props.fields, props.activity);
  return (
    <div className="grid gap-3">
      {luaAuthoringFields.map((field) => (
        <div key={field.key} className="grid gap-2">
          <Label htmlFor={`lua-${field.key}`}>{field.label}</Label>
          {field.multiline ? (
            <Textarea
              id={`lua-${field.key}`}
              rows={field.key === "script" ? 14 : 3}
              value={props.fields[field.key] ?? field.initial}
              maxLength={field.key === "script" ? 40_000 : 16_000}
              disabled={props.disabled}
              onChange={(event) => {
                props.onField(field.key, event.target.value);
              }}
            />
          ) : (
            <Input
              id={`lua-${field.key}`}
              value={props.fields[field.key] ?? field.initial}
              maxLength={16}
              disabled={props.disabled}
              onChange={(event) => {
                props.onField(field.key, event.target.value);
              }}
            />
          )}
        </div>
      ))}
      <Button disabled={props.disabled || model.busy} onClick={() => void model.prepare()}>
        Validate and preview Lua activity
      </Button>
      {model.message ? <p role="status">{model.message}</p> : null}
      {model.preview ? (
        <LuaActivityWorkspace
          key={JSON.stringify(model.preview.payload)}
          activity={model.preview}
          response={model.response}
          onResponse={model.setResponse}
          runtime={props.runtime}
          disabled={props.disabled}
        />
      ) : null}
    </div>
  );
}
