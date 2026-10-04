"use client";

import { Fragment, useEffect, useRef, useState, type MouseEvent } from "react";
import { Effect, Either } from "effect";
import { Button } from "@/components/ui/Button";
import {
  chatGPTResearchApi,
  safeResearchUrl,
  decodeChatGPTResearchResult,
  type ChatGPTResearchApi,
  type ChatGPTResearchResult,
} from "@/lib/chatgpt-local-research";

type ResearchView = {
  readonly identity: string;
  readonly query: string;
  readonly result: ChatGPTResearchResult;
};
type ChatGPTResearchPanelProps = {
  readonly expectedClientId: string;
  readonly model: string;
  readonly areaId: string;
  readonly disabled?: boolean;
  readonly api?: ChatGPTResearchApi;
  readonly initialQuery?: string;
  readonly initialResult?: ChatGPTResearchResult;
  readonly initialMessage?: string;
};
export function ChatGPTResearchPanel(props: ChatGPTResearchPanelProps) {
  return (
    <ResearchForm key={`${props.expectedClientId}:${props.model}:${props.areaId}`} {...props} />
  );
}
function ResearchForm({
  expectedClientId,
  model,
  areaId,
  disabled = false,
  api = chatGPTResearchApi,
  initialQuery = "",
  initialResult,
  initialMessage,
}: ChatGPTResearchPanelProps) {
  const identity = `${expectedClientId}:${model}:${areaId}`;
  const decodedInitial = initialResult
    ? Effect.runSync(Effect.either(decodeChatGPTResearchResult(initialResult, model)))
    : null;
  const [query, setQuery] = useState(initialQuery);
  const [view, setView] = useState<ResearchView | null>(() =>
    decodedInitial && Either.isRight(decodedInitial)
      ? { identity, query: initialQuery, result: decodedInitial.right }
      : null,
  );
  const [message, setMessage] = useState<string | null>(initialMessage ?? null);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestActive = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  const currentView = view?.identity === identity ? view : null;
  async function search() {
    if (disabled || requestActive.current || !query.trim() || query.length > 2000) return;
    requestActive.current = true;
    const epoch = generation.current;
    const submittedQuery = query.trim();
    setBusy(true);
    setMessage(null);
    const result = await Effect.runPromise(
      Effect.either(
        api
          .search({ query: submittedQuery, model, expectedClientId })
          .pipe(Effect.flatMap((value) => decodeChatGPTResearchResult(value, model))),
      ),
    );
    if (!mounted.current || generation.current !== epoch) return;
    requestActive.current = false;
    setBusy(false);
    if (Either.isLeft(result)) {
      setMessage(result.left.message);
      return;
    }
    setView({ identity, query: submittedQuery, result: result.right });
    setSourceMessage(null);
  }
  async function openSource(event: MouseEvent<HTMLAnchorElement>, url: string) {
    if (!window.recallDesktop) return;
    event.preventDefault();
    const epoch = generation.current;
    const result = await Effect.runPromise(Effect.either(api.openSource(url, expectedClientId)));
    if (mounted.current && generation.current === epoch)
      setSourceMessage(Either.isLeft(result) ? result.left.message : null);
  }
  const result = currentView?.result;
  const boundaries = result
    ? [
        ...new Set([
          0,
          ...result.citations.flatMap((citation) => [citation.startIndex, citation.endIndex]),
          result.text.length,
        ]),
      ].sort((left, right) => left - right)
    : [];
  return (
    <section className="tutor-panel" aria-labelledby="chatgpt-research-title">
      <p className="eyebrow">CHATGPT PLAN · WEB SEARCH</p>
      <h2 id="chatgpt-research-title">Research a topic</h2>
      <p>
        Using {model}. Search availability depends on the model, account and workspace. Only this
        query is sent; your learning area and review history are not included.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label htmlFor="chatgpt-research-query">What would you like to research?</label>
        <textarea
          id="chatgpt-research-query"
          rows={3}
          maxLength={2000}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find sources explaining how mitochondria produce ATP."
        />
        <p>{query.length}/2,000 characters</p>
        <Button size="small" type="submit" disabled={disabled || busy || !query.trim()}>
          {busy ? "Searching…" : message ? "Retry search" : "Search the web"}
        </Button>
      </form>
      {message && <p role="alert">{message}</p>}
      {currentView && result && (
        <section aria-label="Research result">
          <h3>Results for: {currentView.query}</h3>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {/[\uD800-\uDFFF]/.test(result.text) ? (
              <>
                {result.text}
                {result.citations.map((citation, citationIndex) => (
                  <a
                    key={citationIndex}
                    href={safeResearchUrl(citation.url) ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={citation.title || citation.url}
                    aria-label={`Source ${citationIndex + 1}: ${citation.title || citation.url}`}
                    onClick={(event) => {
                      void openSource(event, citation.url);
                    }}
                  >
                    {" "}
                    [{citationIndex + 1}]
                  </a>
                ))}
              </>
            ) : (
              boundaries.map((end, index) => (
                <Fragment key={end}>
                  {result.text.slice(boundaries[index - 1] ?? 0, end)}
                  {result.citations.map((citation, citationIndex) =>
                    citation.endIndex === end ? (
                      <a
                        key={citationIndex}
                        href={safeResearchUrl(citation.url) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={citation.title || citation.url}
                        aria-label={`Source ${citationIndex + 1}: ${citation.title || citation.url}`}
                        onClick={(event) => {
                          void openSource(event, citation.url);
                        }}
                      >
                        {" "}
                        [{citationIndex + 1}]
                      </a>
                    ) : null,
                  )}
                </Fragment>
              ))
            )}
          </p>
          <h4>Sources</h4>
          <ol>
            {result.citations.map((citation, index) => (
              <li key={`${citation.url}:${index}`}>
                <a
                  href={safeResearchUrl(citation.url) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    void openSource(event, citation.url);
                  }}
                >
                  {citation.title || citation.url}
                </a>
                <p style={{ overflowWrap: "anywhere" }}>{citation.url}</p>
              </li>
            ))}
          </ol>
          <p>
            Review these sources before using the answer. Research does not change your cards or
            learning evidence.
          </p>
          <Button
            size="small"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setView(null);
              setSourceMessage(null);
            }}
          >
            Clear results
          </Button>
        </section>
      )}
      {sourceMessage && <p role="alert">{sourceMessage}</p>}
    </section>
  );
}
