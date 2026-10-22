import { NativeNoteTemplateDeck } from "./NativeNoteTemplateDeck";
import { NativeNoteLifecycleEditor } from "./NativeNoteLifecycleEditor";
import { NativeReviewPresentationSettings } from "../editor/NativeReviewPresentationSettings";
import { useState } from "react";
import { Text, View } from "react-native";
import type { NoteAuthoringModel } from "@recall/react";
import { NativeButton } from "../../ui/NativeButton";
import { NativeWorkspaceField } from "../editor/NativeWorkspaceField";

type Props = { readonly model: NoteAuthoringModel; readonly disabled: boolean };
export function NativeNoteTypeEditor({ model, disabled }: Props) {
  const [fieldName, setFieldName] = useState("");
  const { type, setType } = model;
  const field = (label: string, value: string, onChangeText: (value: string) => void) => (
    <NativeWorkspaceField
      editor={null}
      locked={disabled}
      label={label}
      value={value}
      onChangeText={onChangeText}
      multiline
    />
  );
  return (
    <View className="gap-3 rounded-lg border border-recall-line p-3">
      {field("Type name", type.name, (name) => {
        setType({ ...type, name });
      })}
      <Text className="text-recall-muted text-xs">
        Templates use {"{{Field name}}"}. Type edits affect every note using this type. Clone the
        type to experiment independently.
      </Text>
      <NativeButton
        label="Clone as a new type and note"
        tone="soft"
        disabled={disabled}
        onPress={model.cloneType}
      />
      <NativeNoteLifecycleEditor key={type.id} model={model} disabled={disabled} />
      {type.fields.map((item) => (
        <NativeButton
          key={item.name}
          label={`${item.sticky ? "✓ " : ""}Keep ${item.name} when adding another`}
          tone="soft"
          disabled={disabled}
          onPress={() => {
            setType({
              ...type,
              fields: type.fields.map((field) =>
                field.name === item.name ? { ...field, sticky: !field.sticky } : field,
              ),
            });
          }}
        />
      ))}
      {field("New field name", fieldName, setFieldName)}
      <NativeButton
        label="Add field"
        tone="soft"
        disabled={
          disabled ||
          !/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(fieldName) ||
          type.fields.some((item) => item.name === fieldName) ||
          type.fields.length >= 50
        }
        onPress={() => {
          setType({ ...type, fields: [...type.fields, { name: fieldName }] });
          model.setNote({ ...model.note, fields: { ...model.note.fields, [fieldName]: "" } });
          setFieldName("");
        }}
      />
      {type.templates.map((template) => (
        <View key={template.id} className="gap-2 border border-recall-line p-2 rounded-lg">
          {field("Card template name", template.name, (name) => {
            model.updateTemplate(template.id, { name });
          })}
          {field("Question template", template.front, (front) => {
            model.updateTemplate(template.id, { front });
          })}
          {field("Answer template", template.back, (back) => {
            model.updateTemplate(template.id, { back });
          })}
          <NativeNoteTemplateDeck model={model} templateId={template.id} disabled={disabled} />
          <NativeReviewPresentationSettings
            value={template.presentation}
            disabled={disabled}
            onChange={(presentation) => {
              model.updateTemplate(template.id, { presentation });
            }}
          />
          {type.templates.length > 1 && (
            <NativeButton
              label="Remove template"
              tone="soft"
              disabled={disabled}
              onPress={() => {
                model.removeTemplate(template.id);
              }}
            />
          )}
        </View>
      ))}
      <NativeButton
        label="Add card template"
        tone="soft"
        disabled={disabled || type.templates.length >= 20}
        onPress={model.addTemplate}
      />
      {model.affectsOthers && (
        <NativeButton
          label={`${model.confirmedTypeChange ? "✓ " : ""}Apply field and template changes to all notes using this type`}
          tone="soft"
          disabled={disabled}
          onPress={() => {
            model.setConfirmedTypeChange(!model.confirmedTypeChange);
          }}
        />
      )}
    </View>
  );
}
