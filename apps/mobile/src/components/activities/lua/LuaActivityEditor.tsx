import { Text, View } from "react-native";
import { NativeTextField } from "@recall/ui-native";
import type { LearningActivity } from "@recall/domain";
import { luaAuthoringFields, type LuaAuthoringValues, type LuaRuntime } from "@recall/application";
import { useLuaAuthoringPreview } from "@recall/react";
import { NativeButton } from "../../ui/NativeButton";
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
    <View className="gap-3">
      {luaAuthoringFields.map((field) => (
        <NativeTextField
          key={field.key}
          label={field.label}
          value={props.fields[field.key] ?? field.initial}
          multiline={field.multiline}
          maxLength={field.key === "script" ? 40_000 : 16_000}
          editable={!props.disabled}
          onChangeText={(value) => {
            props.onField(field.key, value);
          }}
        />
      ))}
      <NativeButton
        label="Validate and preview Lua activity"
        disabled={props.disabled || model.busy}
        onPress={() => void model.prepare()}
      />
      {model.message ? <Text accessibilityRole="alert">{model.message}</Text> : null}
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
    </View>
  );
}
