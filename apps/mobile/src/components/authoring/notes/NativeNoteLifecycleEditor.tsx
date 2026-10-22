import { useState } from "react";
import { Either } from "effect";
import { Text, View } from "react-native";
import type { NoteAuthoringModel } from "@recall/react";
import { NativeButton } from "../../ui/NativeButton";
import { NativeWorkspaceField } from "../editor/NativeWorkspaceField";

export function NativeNoteLifecycleEditor({
  model,
  disabled,
}: {
  readonly model: NoteAuthoringModel;
  readonly disabled: boolean;
}) {
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  return (
    <View className="gap-3">
      {model.type.fields.map((field, index) => (
        <View key={field.name} className="gap-2 border-b border-recall-line pb-3">
          <NativeWorkspaceField
            editor={null}
            locked={disabled}
            label="Field name"
            value={names[field.name] ?? field.name}
            onChangeText={(value) => {
              setNames({ ...names, [field.name]: value });
            }}
          />
          <View className="flex-row flex-wrap gap-2">
            <NativeButton
              label="Rename"
              tone="soft"
              disabled={
                disabled ||
                !names[field.name] ||
                names[field.name] === field.name ||
                model.type.fields.some((item) => item.name === names[field.name]) ||
                !/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(names[field.name] ?? "")
              }
              onPress={() => {
                model.renameField(field.name, names[field.name] ?? field.name);
                setNames({});
              }}
            />
            <NativeButton
              label="Move up"
              tone="soft"
              disabled={disabled || index === 0}
              onPress={() => {
                model.moveField(field.name, -1);
              }}
            />
            <NativeButton
              label="Move down"
              tone="soft"
              disabled={disabled || index === model.type.fields.length - 1}
              onPress={() => {
                model.moveField(field.name, 1);
              }}
            />
            <NativeButton
              label={`Remove ${field.name}`}
              tone="soft"
              disabled={disabled || model.type.fields.length === 1}
              onPress={() => {
                model.removeField(field.name);
              }}
            />
          </View>
        </View>
      ))}
      {model.savedNote && (
        <View className="gap-2">
          <Text className="font-bold text-recall-ink">Change note type</Text>
          {model.types.map((type) => (
            <NativeButton
              key={type.id}
              label={type.name}
              tone="soft"
              selected={model.type.id === type.id}
              disabled={disabled}
              onPress={() => {
                model.convertType(type);
              }}
            />
          ))}
        </View>
      )}
      <NativeNoteMapping model={model} disabled={disabled} />
    </View>
  );
}
export function NativeNoteLifecycleImpact({
  model,
  disabled,
}: {
  readonly model: NoteAuthoringModel;
  readonly disabled: boolean;
}) {
  const plan = model.lifecyclePlan;
  if (Either.isLeft(plan)) return <Text accessibilityRole="alert">{plan.left.message}</Text>;
  if (!plan.right.requiresConfirmation) return null;
  return (
    <View className="gap-2 border border-recall-line p-3">
      {plan.right.removed.length > 0 && (
        <Text className="text-recall-ink">
          {plan.right.removed.length} {plan.right.removed.length === 1 ? "card" : "cards"} will move
          to recoverable trash.
        </Text>
      )}
      {plan.right.discardedValues.length > 0 && (
        <Text className="text-recall-ink">
          {plan.right.discardedValues.length}{" "}
          {plan.right.discardedValues.length === 1
            ? "nonempty field value"
            : "nonempty field values"}{" "}
          will be removed.
        </Text>
      )}
      {plan.right.removed.map((card) => (
        <Text key={card.id} numberOfLines={2}>
          Card: {card.front}
        </Text>
      ))}
      {plan.right.discardedValues.map((value) => (
        <Text key={`${value.noteId}:${value.field}`}>
          {value.field}: {value.value}
        </Text>
      ))}
      <NativeButton
        label={`${model.migration?.confirmRemoval ? "✓ " : ""}Apply these removals when saving`}
        tone="soft"
        disabled={disabled}
        onPress={() => {
          model.confirmRemoval(!model.migration?.confirmRemoval);
        }}
      />
    </View>
  );
}

function NativeSourceChoice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly id: string; readonly name: string }[];
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-recall-ink">{label}</Text>
      {[{ id: "", name: "Empty / new" }, ...options].map((source) => (
        <NativeButton
          key={source.id}
          label={source.name}
          tone="soft"
          selected={value === source.id}
          disabled={disabled}
          onPress={() => {
            onChange(source.id);
          }}
        />
      ))}
    </View>
  );
}
function NativeNoteMapping({
  model,
  disabled,
}: {
  readonly model: NoteAuthoringModel;
  readonly disabled: boolean;
}) {
  if (!model.savedNote || !model.sourceType || model.savedNote.typeId === model.type.id)
    return null;
  const fields = model.sourceType.fields.map((field) => ({ id: field.name, name: field.name }));
  return (
    <View className="gap-3">
      {model.type.fields.map((field) => (
        <NativeSourceChoice
          key={field.name}
          label={`${field.name}: source field`}
          value={model.migration?.fields[field.name] ?? ""}
          options={fields}
          disabled={disabled}
          onChange={(source) => {
            model.mapField(field.name, source);
          }}
        />
      ))}
      {model.type.templates.map((template) => (
        <NativeSourceChoice
          key={template.id}
          label={`${template.name}: preserve schedule from`}
          value={model.migration?.templates[template.id] ?? ""}
          options={model.sourceType?.templates ?? []}
          disabled={disabled}
          onChange={(source) => {
            model.mapTemplate(template.id, source);
          }}
        />
      ))}
    </View>
  );
}
