import { Effect, Either } from "effect";

export type ChatGPTResearchResult = {
  readonly text: string;
  readonly citations: readonly {
    readonly url: string;
    readonly title: string;
    readonly startIndex: number;
    readonly endIndex: number;
  }[];
  readonly searched: true;
  readonly model: string;
};
type Result =
  | { readonly _tag: "Success"; readonly value: ChatGPTResearchResult }
  | { readonly _tag: "Failure"; readonly code: string };
const invalid = (): Result => ({ _tag: "Failure", code: "invalid-research-response" });
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Citations come exclusively from the terminal provider annotations, never generated JSON. */
export function parseChatGPTResearchResult(value: unknown, model: string): Result {
  const response = record(value);
  if (response?.status !== "completed" || !Array.isArray(response.output)) return invalid();
  if (response.output.length > 200) return invalid();
  let searched = false;
  let text = "";
  const citations: ChatGPTResearchResult["citations"][number][] = [];
  for (const rawItem of response.output) {
    const item = record(rawItem);
    if (!item) return invalid();
    if (item.type === "web_search_call") {
      const action = record(item.action);
      if (item.status === "completed" && action?.type === "search") searched = true;
    }
    if (item.type !== "message") continue;
    if (item.role !== "assistant" || item.status !== "completed" || !Array.isArray(item.content))
      return invalid();
    if (item.content.length > 100) return invalid();
    for (const rawContent of item.content) {
      const content = record(rawContent);
      if (!content) return invalid();
      if (content.type !== "output_text") continue;
      if (typeof content.text !== "string" || !Array.isArray(content.annotations)) return invalid();
      const block = content.text;
      const offset = text.length + (text.length ? 2 : 0);
      if (offset + block.length > 100_000 || content.annotations.length > 100) return invalid();
      text += (text.length ? "\n\n" : "") + block;
      for (const rawAnnotation of content.annotations) {
        const annotation = record(rawAnnotation);
        if (!annotation) return invalid();
        if (annotation.type !== "url_citation") continue;
        const start = annotation.start_index;
        const end = annotation.end_index;
        if (
          typeof annotation.url !== "string" ||
          annotation.url.length > 2048 ||
          typeof annotation.title !== "string" ||
          !annotation.title.trim() ||
          annotation.title.length > 1000 ||
          typeof start !== "number" ||
          typeof end !== "number" ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          end <= start ||
          end > block.length ||
          citations.length >= 100
        )
          return invalid();
        const sourceUrl = annotation.url;
        const parsed = Effect.runSync(
          Effect.either(
            Effect.try({
              try: () => new URL(sourceUrl),
              catch: () => "invalid-url",
            }),
          ),
        );
        if (Either.isLeft(parsed)) return invalid();
        const url = parsed.right;
        if (
          !url.hostname ||
          url.href.length > 2048 ||
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          return invalid();
        citations.push({
          url: url.href,
          title: annotation.title,
          startIndex: offset + start,
          endIndex: offset + end,
        });
      }
    }
  }
  if (!searched) return { _tag: "Failure", code: "research-not-searched" };
  if (!text.trim()) return invalid();
  if (!citations.length) return { _tag: "Failure", code: "research-no-citations" };
  return { _tag: "Success", value: { text, citations, searched: true, model } };
}
