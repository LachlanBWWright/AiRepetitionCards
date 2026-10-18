"use client";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { Textarea } from "@recall/ui-web";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { Effect, Either } from "effect";
import { Label } from "@recall/ui-web/components/label";
import { Button } from "@/components/ui/Button";
import {
  chatGPTResearchApi,
  decodeChatGPTResearchResult,
  type ChatGPTResearchApi,
  type ChatGPTResearchResult,
} from "@/lib/chatgpt-local-research";
import { ResearchAnswerText } from "./ResearchAnswerText";
import { ResearchSources } from "./ResearchSources";

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
  const id = useId();
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
  const handleOpenSource = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    void openSource(event, url);
  };
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
    <section className="space-y-5" aria-labelledby={`${id}-title`}>
      <header className="space-y-2">
        <h3 className="text-xl font-semibold tracking-tight" id={`${id}-title`}>
          Research the web
        </h3>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">
          Find explanations and sources to support your study materials.
        </p>
      </header>
      <form
        className="max-w-2xl space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <Label htmlFor={`${id}-query`}>What would you like to research?</Label>
        <Textarea
          id={`${id}-query`}
          className="min-h-28 leading-6"
          rows={3}
          maxLength={2000}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Find sources explaining how mitochondria produce ATP."
        />
        <p className="text-xs leading-5 text-muted-foreground">
          Only your search query is sent to OpenAI.
        </p>
        <Button size="small" type="submit" disabled={disabled || busy || !query.trim()}>
          {busy ? "Searching…" : message ? "Retry search" : "Search the web"}
        </Button>
      </form>
      {message && (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {currentView && result && (
        <section className="space-y-4" aria-label="Research result">
          <h3 className="text-base font-semibold">{currentView.query}</h3>
          <ResearchAnswerText
            result={result}
            boundaries={boundaries}
            onOpenSource={handleOpenSource}
          />
          <ResearchSources citations={result.citations} onOpenSource={handleOpenSource} />
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
      {sourceMessage && (
        <Alert variant="destructive">
          <AlertDescription>{sourceMessage}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
