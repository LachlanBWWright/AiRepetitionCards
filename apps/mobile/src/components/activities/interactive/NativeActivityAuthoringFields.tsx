import { Text, View } from "react-native";
import { NativeTextField } from "@recall/ui-native";
import type { LuaRuntime } from "@recall/application";
import { LuaActivityEditor } from "../lua/LuaActivityEditor";
import type { useLearningActivities } from "../../../hooks/use-learning-activities";

const guidance: Readonly<Record<string, string>> = {
  "recall.ordering":
    "Write the items in their correct order. Learners receive shuffled items and build their own answer.",
  "recall.matching":
    "Write one pair per line using the separator shown below. Learners match independently shuffled choices.",
  "recall.code-tracing":
    "Provide source code and its expected output. This activity compares predictions; it does not execute the source code.",
};

export function NativeActivityAuthoringFields({
  model,
  disabled,
  luaRuntime,
  areaId,
}: {
  readonly model: ReturnType<typeof useLearningActivities>;
  readonly disabled: boolean;
  readonly luaRuntime: LuaRuntime;
  readonly areaId: string;
}) {
  if (model.pluginId === "recall.lua")
    return (
      <LuaActivityEditor
        fields={Object.fromEntries(
          model.authorFields.map((field) => [field.key, model.fieldValue(field.key)]),
        )}
        onField={(key, value) => {
          model.setFields((current) => ({ ...current, [key]: value }));
        }}
        activity={
          model.editing ?? {
            id: "lua-authoring-preview",
            areaId,
            title: model.title || "Lua preview",
            objectiveIds: [model.objectiveId || "preview"],
            pluginId: "recall.lua",
            pluginVersion: 1,
            revision: 1,
            fallback: "Preview",
            payload: {},
          }
        }
        runtime={luaRuntime}
        disabled={disabled}
      />
    );
  const help = guidance[model.pluginId];
  return (
    <View className="gap-3">
      {help && <Text className="text-sm text-recall-muted">{help}</Text>}
      {model.authorFields.map((field) => (
        <NativeTextField
          key={field.key}
          label={field.label}
          value={model.fieldValue(field.key)}
          onChangeText={(value) => {
            model.setFields((current) => ({ ...current, [field.key]: value }));
          }}
          editable={!disabled}
          multiline={field.multiline}
          maxLength={field.key === "payload" ? 100_000 : 20_000}
          {...(field.key === "code" || field.key === "expectedOutput"
            ? { autoCapitalize: "none" as const, autoCorrect: false }
            : {})}
        />
      ))}
    </View>
  );
}
