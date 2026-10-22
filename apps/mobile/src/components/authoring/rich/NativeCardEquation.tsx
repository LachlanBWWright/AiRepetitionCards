import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { Either } from "effect";
import { renderCardMath } from "@recall/infra-rich-content";

export function NativeCardEquation({
  source,
  display = false,
  fontSize = 20,
}: {
  readonly source: string;
  readonly display?: boolean;
  readonly fontSize?: number;
}) {
  const result = useMemo(() => renderCardMath(source, display), [source, display]);
  return Either.isRight(result) ? (
    <View accessibilityLabel={`Equation: ${source}`} className="my-1 max-w-full">
      <ScrollView horizontal>
        <SvgXml
          xml={result.right.svg}
          width={(result.right.width * fontSize) / 20}
          height={(result.right.height * fontSize) / 20}
        />
      </ScrollView>
    </View>
  ) : (
    <Text
      accessibilityLabel={result.left.message}
      className={display ? "font-mono my-3 text-recall-ink" : "font-mono text-recall-ink"}
    >
      {source}
    </Text>
  );
}
