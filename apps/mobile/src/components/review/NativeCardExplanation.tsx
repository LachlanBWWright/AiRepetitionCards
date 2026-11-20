import { useState } from "react";
import { View } from "react-native";
import { NativeCollapsible } from "@recall/ui-native";
import { NativeCardRichText } from "../authoring/rich/NativeCardRichText";
import type { CardAppearance } from "@recall/domain";
export function NativeCardExplanation({
  text,
  mediaUrls,
  appearance,
}: {
  readonly text: string;
  readonly mediaUrls: Readonly<Record<string, string>>;
  readonly appearance?: CardAppearance | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-2 my-3">
      <NativeCollapsible
        open={expanded}
        title="Explanation and supporting material"
        onToggle={() => {
          setExpanded((current) => !current);
        }}
      >
        <NativeCardRichText text={text} mediaUrls={mediaUrls} appearance={appearance} />
      </NativeCollapsible>
    </View>
  );
}
