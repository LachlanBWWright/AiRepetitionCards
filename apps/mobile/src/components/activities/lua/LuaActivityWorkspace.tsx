import { Text, View } from "react-native";
import { useLuaActivity, type LuaActivityWorkspaceProps } from "@recall/react";
import { NativeButton } from "../../ui/NativeButton";

export function LuaActivityWorkspace(props: LuaActivityWorkspaceProps) {
  const model = useLuaActivity(props);
  const locked = Boolean(props.disabled) || model.busy;
  return (
    <View className="gap-3 rounded-xl border border-recall-line p-3">
      {model.view ? (
        <>
          <Text>{model.view.text}</Text>
          {model.view.buttons.map((button) => (
            <NativeButton
              key={button.id}
              label={button.label}
              disabled={locked}
              onPress={() => {
                model.dispatch({ id: button.id });
              }}
            />
          ))}
          <Text>
            When finished, request assessment and review the proposal before accepting it.
          </Text>
        </>
      ) : (
        <NativeButton label="Open or resume Lua activity" disabled={locked} onPress={model.start} />
      )}
      {model.message ? <Text accessibilityRole="alert">{model.message}</Text> : null}
      <Text className="font-bold">Fallback activity</Text>
      <Text>{props.activity.fallback}</Text>
      <Text>
        If execution is unavailable, use this content for manual study. Your draft is preserved and
        no script completion is recorded.
      </Text>
    </View>
  );
}
