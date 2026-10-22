import { NativeSpeechFieldSettings } from "./NativeSpeechFieldSettings";
import { Text, View } from "react-native";
import type { ReviewPresentation } from "@recall/domain";
import { NativeButton } from "../../ui/NativeButton";
import { NativeCardAppearanceSettings } from "../rich/NativeCardAppearanceSettings";

export function NativeReviewPresentationSettings({
  value,
  onChange,
  disabled,
}: {
  readonly value: ReviewPresentation | undefined;
  readonly onChange: (value: ReviewPresentation) => void;
  readonly disabled: boolean;
}) {
  const typed = value?.typedAnswer ?? { enabled: false, ignoreCase: true, ignoreAccents: false };
  return (
    <View className="gap-2 border border-recall-line rounded-lg p-3">
      <Text className="font-semibold text-recall-ink">Appearance, answer and pronunciation</Text>
      <NativeCardAppearanceSettings
        value={value?.appearance}
        disabled={disabled}
        onChange={(appearance) => {
          onChange({ ...value, appearance });
        }}
      />
      {(
        [
          ["enabled", "Type answer"],
          ["ignoreCase", "Ignore case"],
          ["ignoreAccents", "Ignore accents"],
        ] as const
      ).map(([key, label]) => (
        <NativeButton
          key={key}
          disabled={disabled}
          tone="soft"
          label={`${label}: ${typed[key] ? "on" : "off"}`}
          onPress={() => {
            onChange({ ...value, typedAnswer: { ...typed, [key]: !typed[key] } });
          }}
        />
      ))}
      {(["front", "back"] as const).map((side) => (
        <NativeSpeechFieldSettings
          key={side}
          side={side}
          speech={value?.speech?.[side]}
          disabled={disabled}
          update={(settings) => {
            onChange({ ...value, speech: { ...value?.speech, [side]: settings } });
          }}
        />
      ))}
    </View>
  );
}
