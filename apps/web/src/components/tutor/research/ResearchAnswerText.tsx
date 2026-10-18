import { Fragment, type MouseEvent } from "react";
import { safeResearchUrl, type ChatGPTResearchResult } from "@/lib/chatgpt-local-research";

function hasSurrogateCodeUnit(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const value = text.charCodeAt(index);
    if (value >= 0xd800 && value <= 0xdfff) return true;
  }
  return false;
}

function CitationLink({
  citation,
  index,
  onOpenSource,
}: {
  readonly citation: ChatGPTResearchResult["citations"][number];
  readonly index: number;
  readonly onOpenSource: (event: MouseEvent<HTMLAnchorElement>, url: string) => void;
}) {
  return (
    <a
      href={safeResearchUrl(citation.url) ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      title={citation.title || citation.url}
      aria-label={`Source ${String(index + 1)}: ${citation.title || citation.url}`}
      onClick={(event) => {
        onOpenSource(event, citation.url);
      }}
    >
      {" "}
      [{index + 1}]
    </a>
  );
}

function CitationLinks({
  citations,
  onOpenSource,
}: {
  readonly citations: ChatGPTResearchResult["citations"];
  readonly onOpenSource: (event: MouseEvent<HTMLAnchorElement>, url: string) => void;
}) {
  return (
    <>
      {citations.map((citation, index) => (
        <CitationLink key={index} citation={citation} index={index} onOpenSource={onOpenSource} />
      ))}
    </>
  );
}

function CitationsAtBoundary({
  citations,
  end,
  onOpenSource,
}: {
  readonly citations: ChatGPTResearchResult["citations"];
  readonly end: number;
  readonly onOpenSource: (event: MouseEvent<HTMLAnchorElement>, url: string) => void;
}) {
  return (
    <>
      {citations.map((citation, citationIndex) =>
        citation.endIndex === end ? (
          <CitationLink
            key={citationIndex}
            citation={citation}
            index={citationIndex}
            onOpenSource={onOpenSource}
          />
        ) : null,
      )}
    </>
  );
}

export function ResearchAnswerText({
  result,
  boundaries,
  onOpenSource,
}: {
  readonly result: ChatGPTResearchResult;
  readonly boundaries: readonly number[];
  readonly onOpenSource: (event: MouseEvent<HTMLAnchorElement>, url: string) => void;
}) {
  const needsFallback = hasSurrogateCodeUnit(result.text);
  return (
    <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
      {needsFallback ? (
        <>
          {result.text}
          <CitationLinks citations={result.citations} onOpenSource={onOpenSource} />
        </>
      ) : (
        boundaries.map((end, index) => (
          <Fragment key={end}>
            {result.text.slice(boundaries[index - 1] ?? 0, end)}
            <CitationsAtBoundary
              citations={result.citations}
              end={end}
              onOpenSource={onOpenSource}
            />
          </Fragment>
        ))
      )}
    </p>
  );
}
