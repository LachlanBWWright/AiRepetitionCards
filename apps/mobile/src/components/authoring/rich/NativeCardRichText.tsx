import { Image, Platform, Text, View, type TextStyle } from "react-native";
import {
  cardAppearanceMetrics,
  parseRichContent,
  type RichInline,
  type RichBlock,
} from "@recall/application";
import type { CardAppearance } from "@recall/domain";
import { NativeCardEquation } from "./NativeCardEquation";

type MediaUrls = Readonly<Record<string, string>> | undefined;
type InlineProps = {
  readonly item: RichInline;
  readonly mediaUrls: MediaUrls;
  readonly className: string;
  readonly style: TextStyle | undefined;
};
function Inline({ item, mediaUrls, className, style }: InlineProps) {
  if (item.kind === "math")
    return <NativeCardEquation source={item.text} fontSize={style?.fontSize ?? 20} />;
  if (item.kind === "image") {
    const uri = mediaUrls?.[item.mediaId];
    return uri ? (
      <Image
        source={{ uri }}
        accessibilityLabel={item.text || "Card image"}
        alt={item.text || "Card image"}
        resizeMode="contain"
        className="w-full h-[220px] my-2"
      />
    ) : (
      <Text className={className} style={style}>
        [Image: {item.text || item.mediaId}]
      </Text>
    );
  }
  const emphasis =
    item.kind === "strong"
      ? "font-bold"
      : item.kind === "emphasis"
        ? "italic"
        : item.kind === "code"
          ? "font-mono"
          : "";
  return (
    <Text className={`${className} ${emphasis}`} style={style}>
      {item.text}
    </Text>
  );
}
function Block({
  block,
  mediaUrls,
  style,
}: {
  readonly block: RichBlock;
  readonly mediaUrls: MediaUrls;
  readonly style: TextStyle | undefined;
}) {
  if (block.kind === "math")
    return (
      <NativeCardEquation
        source={block.content[0]?.text ?? ""}
        display
        fontSize={style?.fontSize ?? 20}
      />
    );
  const className = `text-recall-ink text-[20px] leading-[29px] ${block.kind === "heading" ? "font-bold" : block.kind === "quote" ? "italic" : ""}`;
  return (
    <View
      className="flex-row flex-wrap items-center"
      style={{ justifyContent: style?.textAlign === "center" ? "center" : "flex-start" }}
    >
      {(block.kind === "bullet" || block.kind === "number") && (
        <Text className={className} style={style}>
          {block.kind === "bullet" ? "• " : `${String(block.number)}. `}
        </Text>
      )}
      {block.content.map((item, index) => (
        <Inline key={index} item={item} mediaUrls={mediaUrls} className={className} style={style} />
      ))}
    </View>
  );
}
export function NativeCardRichText({
  text,
  mediaUrls,
  appearance,
}: {
  readonly text: string;
  readonly mediaUrls?: Readonly<Record<string, string>>;
  readonly appearance?: CardAppearance | undefined;
}) {
  const style: TextStyle | undefined = appearance
    ? {
        ...cardAppearanceMetrics(appearance),
        fontFamily: {
          sans: Platform.OS === "ios" ? "System" : "sans-serif",
          serif: Platform.OS === "ios" ? "Georgia" : "serif",
          mono: Platform.OS === "ios" ? "Menlo" : "monospace",
        }[appearance.font],
      }
    : undefined;
  return (
    <View className="gap-1 my-3">
      {parseRichContent(text).map((block, index) => (
        <Block key={index} block={block} mediaUrls={mediaUrls} style={style} />
      ))}
    </View>
  );
}
