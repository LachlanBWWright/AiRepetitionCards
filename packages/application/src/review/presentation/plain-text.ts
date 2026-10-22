import { formatCardMath, parseRichContent } from "../../authoring/rich-content";
/** Use the same visible content for speech and typing, omitting inline image markup. */
export function reviewPlainText(text: string): string {
  return parseRichContent(text)
    .map((block) =>
      block.content
        .map((part) =>
          part.kind === "image" ? "" : part.kind === "math" ? formatCardMath(part.text) : part.text,
        )
        .join(""),
    )
    .join("\n");
}
