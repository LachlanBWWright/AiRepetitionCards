import { Fragment } from "react";

/** A small, text-only chat formatter. AI text never becomes raw HTML. */
export function ChatMessageContent({ content }: { readonly content: string }) {
  const blocks = content.split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g);
  return <div className="space-y-4">{blocks.map(renderBlock)}</div>;
}

function renderBlock(block: string, index: number) {
  if (!block.trim()) return null;
  if (block.startsWith("```")) {
    const line = block.indexOf("\n");
    const language = block.slice(3, line).trim();
    const code = block
      .slice(line + 1)
      .replace(/```$/, "")
      .trimEnd();
    return (
      <div key={index} className="overflow-hidden rounded-lg border bg-muted/40">
        {language && (
          <div className="border-b px-4 py-1 text-xs text-muted-foreground">{language}</div>
        )}
        <pre className="overflow-x-auto p-4 text-[13px] leading-6">
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return (
    <Fragment key={index}>
      {block
        .trim()
        .split(/\n\s*\n/)
        .map(renderParagraph)}
    </Fragment>
  );
}

function renderParagraph(text: string, index: number) {
  const lines = text.split("\n");
  if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
    return (
      <ul key={index} className="list-disc space-y-1 pl-5">
        {lines.map((line, i) => (
          <li key={i}>
            <InlineText text={line.replace(/^\s*[-*]\s+/, "")} />
          </li>
        ))}
      </ul>
    );
  }
  if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
    return (
      <ol key={index} className="list-decimal space-y-1 pl-5">
        {lines.map((line, i) => (
          <li key={i}>
            <InlineText text={line.replace(/^\s*\d+[.)]\s+/, "")} />
          </li>
        ))}
      </ol>
    );
  }
  if (/^#{1,4}\s/.test(text))
    return (
      <p key={index} className="font-semibold">
        <InlineText text={text.replace(/^#{1,4}\s+/, "")} />
      </p>
    );
  return (
    <p key={index} className="whitespace-pre-wrap">
      <InlineText text={text} />
    </p>
  );
}

function InlineText({ text }: { readonly text: string }) {
  return text.split(/(`[^`\n]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={index} className="rounded bg-muted px-1 py-0.5 text-[0.88em]">
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("**") && part.endsWith("**"))
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    return <Fragment key={index}>{part}</Fragment>;
  });
}
