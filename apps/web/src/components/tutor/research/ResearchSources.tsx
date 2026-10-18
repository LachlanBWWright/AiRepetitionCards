import type { MouseEvent } from "react";
import { safeResearchUrl, type ChatGPTResearchResult } from "@/lib/chatgpt-local-research";

export function ResearchSources({
  citations,
  onOpenSource,
}: {
  readonly citations: ChatGPTResearchResult["citations"];
  readonly onOpenSource: (event: MouseEvent<HTMLAnchorElement>, url: string) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold leading-6">Sources</h3>
      <ol>
        {citations.map((citation, index) => (
          <li key={`${citation.url}:${String(index)}`}>
            <a
              href={safeResearchUrl(citation.url) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                onOpenSource(event, citation.url);
              }}
            >
              {citation.title || citation.url}
            </a>
            <p className="[overflow-wrap:anywhere]">{citation.url}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
