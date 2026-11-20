import { useFonts } from "expo-font";
import geistFont from "../../../../assets/fonts/Geist-Regular.ttf";
import { Image, Platform, ScrollView, Text, View, type TextStyle } from "react-native";
import {
  cardAppearanceMetrics,
  cardImageSize,
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
  readonly imageSize: number;
};
function Inline({ item, mediaUrls, className, style, imageSize }: InlineProps) {
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
        className="w-full my-2"
        style={{ height: imageSize }}
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
  imageSize,
}: {
  readonly block: RichBlock;
  readonly mediaUrls: MediaUrls;
  readonly style: TextStyle | undefined;
  readonly imageSize: number;
}) {
  if (block.kind === "code")
    return (
      <ScrollView horizontal className="my-3 rounded-lg bg-recall-surface p-3">
        <Text className="font-mono text-recall-ink" selectable>
          {block.content[0]?.text}
        </Text>
      </ScrollView>
    );
  if (block.kind === "math")
    return (
      <NativeCardEquation
        source={block.content[0]?.text ?? ""}
        display
        fontSize={style?.fontSize ?? 20}
      />
    );
  const className = `text-recall-ink ${style ? "" : "text-[20px] leading-[29px]"} ${block.kind === "heading" ? "font-bold" : block.kind === "quote" ? "italic" : ""}`;
  const content = (
    <>
      {(block.kind === "bullet" || block.kind === "number") && (
        <Text className={className} style={style}>
          {block.kind === "bullet" ? "• " : `${String(block.number)}. `}
        </Text>
      )}
      {block.content.map((item, index) => (
        <Inline
          key={index}
          item={item}
          mediaUrls={mediaUrls}
          className={className}
          style={style}
          imageSize={imageSize}
        />
      ))}
    </>
  );
  return block.content.every((item) => item.kind !== "image" && item.kind !== "math") ? (
    <Text className={className} style={style} selectable>
      {content}
    </Text>
  ) : (
    <View
      className="flex-row flex-wrap items-center"
      style={{ justifyContent: style?.textAlign === "center" ? "center" : "flex-start" }}
    >
      {content}
    </View>
  );
}
export function NativeCardRichText({
  text,
  mediaUrls,
  appearance,
  variant = "card",
}: {
  readonly text: string;
  readonly variant?: "card" | "body";
  readonly mediaUrls?: Readonly<Record<string, string>>;
  readonly appearance?: CardAppearance | undefined;
}) {
  const [fontsLoaded] = useFonts({ RecallGeist: geistFont });
  const style: TextStyle | undefined = appearance
    ? {
        ...cardAppearanceMetrics(appearance),
        writingDirection:
          appearance.direction === "rtl" ? "rtl" : appearance.direction === "ltr" ? "ltr" : "auto",
        fontFamily: {
          sans: fontsLoaded ? "RecallGeist" : Platform.OS === "ios" ? "System" : "sans-serif",
          serif: Platform.OS === "ios" ? "Georgia" : "serif",
          mono: Platform.OS === "ios" ? "Menlo" : "monospace",
        }[appearance.font],
      }
    : variant === "body"
      ? { fontSize: 15, lineHeight: 24, textAlign: "left" }
      : undefined;
  return (
    <View className="gap-1 my-3">
      {parseRichContent(text).map((block, index) => (
        <Block
          key={index}
          block={block}
          mediaUrls={mediaUrls}
          style={style}
          imageSize={cardImageSize(appearance)}
        />
      ))}
    </View>
  );
}
