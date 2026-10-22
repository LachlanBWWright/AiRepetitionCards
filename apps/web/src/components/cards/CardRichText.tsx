import { InlineImage } from "../ui/InlineImage";
import { cardAppearanceMetrics, parseRichContent, type RichInline } from "@recall/application";
import type { CardAppearance } from "@recall/domain";
import { CardEquation } from "./CardEquation";

type Props = {
  readonly text: string;
  readonly mediaUrls?: Readonly<Record<string, string>>;
  readonly className?: string;
  readonly appearance?: CardAppearance | undefined;
};
function Inline({
  item,
  mediaUrls,
  fontSize,
}: {
  readonly item: RichInline;
  readonly mediaUrls: Props["mediaUrls"];
  readonly fontSize: number;
}) {
  switch (item.kind) {
    case "strong":
      return <strong>{item.text}</strong>;
    case "emphasis":
      return <em>{item.text}</em>;
    case "code":
      return <code className="rounded bg-muted px-1 font-mono text-[0.9em]">{item.text}</code>;
    case "math":
      return <CardEquation source={item.text} fontSize={fontSize} />;
    case "image": {
      const url = mediaUrls?.[item.mediaId];
      return url ? (
        <InlineImage
          src={url}
          alt={item.text || "Card image"}
          className="my-2 inline-block max-h-72 max-w-full object-contain"
        />
      ) : (
        <span>[Image: {item.text || item.mediaId}]</span>
      );
    }
    default:
      return <>{item.text}</>;
  }
}
export function CardRichText({ text, mediaUrls, className, appearance }: Props) {
  const metrics = appearance ? cardAppearanceMetrics(appearance) : undefined;
  const style =
    appearance && metrics
      ? {
          fontFamily: {
            sans: "var(--font-geist-sans), sans-serif",
            serif: "Georgia, serif",
            mono: "var(--font-geist-mono), monospace",
          }[appearance.font],
          fontSize: metrics.fontSize,
          lineHeight: `${String(metrics.lineHeight)}px`,
          textAlign: metrics.textAlign,
        }
      : undefined;
  return (
    <div className={className} style={style}>
      {parseRichContent(text).map((block, index) => (
        <div
          key={index}
          className={
            block.kind === "heading"
              ? "font-bold"
              : block.kind === "quote"
                ? "border-l-2 pl-3 italic"
                : "min-h-[1em]"
          }
        >
          {block.kind === "bullet" && "• "}
          {block.kind === "number" && `${String(block.number)}. `}
          {block.kind === "math" ? (
            <CardEquation
              source={block.content[0]?.text ?? ""}
              display
              fontSize={metrics?.fontSize ?? 20}
            />
          ) : (
            block.content.map((item, inlineIndex) => (
              <Inline
                key={inlineIndex}
                item={item}
                mediaUrls={mediaUrls}
                fontSize={metrics?.fontSize ?? 20}
              />
            ))
          )}
        </div>
      ))}
    </div>
  );
}
