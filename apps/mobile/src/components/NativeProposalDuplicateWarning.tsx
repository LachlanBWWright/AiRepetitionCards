import { Text, View, Switch } from "react-native";
import type { CardDuplicateMatch } from "@recall/application";

export function NativeProposalDuplicateWarning({
  matches,
  acknowledged,
  disabled,
  onChange,
}: {
  readonly matches: readonly CardDuplicateMatch[];
  readonly acknowledged: boolean;
  readonly disabled: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  if (matches.length === 0) return null;
  return (
    <View accessibilityLiveRegion="polite">
      <Text>Possible duplicates</Text>
      {matches.map(({ candidate, reason }) => (
        <View key={candidate.id}>
          <Text>
            {candidate.front}
            {candidate.areaTitle ? ` · ${candidate.areaTitle}` : ""}
          </Text>
          <Text>{reason}</Text>
        </View>
      ))}
      <Text>Keep both</Text>
      <Switch
        accessibilityLabel="Keep both"
        value={acknowledged}
        disabled={disabled}
        onValueChange={onChange}
      />
    </View>
  );
}
