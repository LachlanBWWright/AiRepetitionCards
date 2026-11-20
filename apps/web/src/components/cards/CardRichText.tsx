import { InlineImage } from "../ui/InlineImage";
import {
  cardAppearanceMetrics,
  cardImageSize,
  parseRichContent,
  type RichInline,
  type RichBlock,
} from "@recall/application";
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
  imageSize,
}: {
  readonly item: RichInline;
  readonly mediaUrls: Props["mediaUrls"];
  readonly fontSize: number;
  readonly imageSize: number;
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
          className="my-2 inline-block max-w-full object-contain"
          style={{ maxHeight: imageSize }}
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
    <div className={className} style={style} dir={appearance?.direction ?? "auto"}>
      {parseRichContent(text).map((block, index) => (
        <RichTextBlock
          key={index}
          block={block}
          mediaUrls={mediaUrls}
          fontSize={metrics?.fontSize ?? 20}
          imageSize={cardImageSize(appearance)}
        />
      ))}
    </div>
  );
}

function RichTextBlock({
  block,
  mediaUrls,
  fontSize,
  imageSize,
}: {
  readonly block: RichBlock;
  readonly mediaUrls: Props["mediaUrls"];
  readonly fontSize: number;
  readonly imageSize: number;
}) {
  if (block.kind === "code")
    return (
      <pre className="my-3 max-w-full overflow-x-auto rounded-md bg-muted p-3 text-sm">
        <code data-language={block.language}>{block.content[0]?.text}</code>
      </pre>
    );
  return (
    <div
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
        <CardEquation source={block.content[0]?.text ?? ""} display fontSize={fontSize} />
      ) : (
        block.content.map((item, index) => (
          <Inline
            key={index}
            item={item}
            mediaUrls={mediaUrls}
            fontSize={fontSize}
            imageSize={imageSize}
          />
        ))
      )}
    </div>
  );
}
