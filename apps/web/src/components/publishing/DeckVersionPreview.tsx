"use client";

import { useEffect, useRef, useState } from "react";
import { Effect, Either, Fiber } from "effect";
import { expandCloze } from "@recall/application";
import type { ReadPublishedKnowledgeAreaResponse } from "@recall/contracts";
import { Alert, AlertDescription, Button } from "@recall/ui-web";
import { publishingApi } from "@/lib/publishing-api";

type PublishedVersion = ReadPublishedKnowledgeAreaResponse["version"];

export function DeckVersionPreview({
  versionId,
  token,
  onAddPersonalCopy,
}: {
  readonly versionId: string;
  readonly token?: string;
  readonly onAddPersonalCopy: () => void;
}) {
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const [version, setVersion] = useState<PublishedVersion | null>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const requestId = ++requestRef.current;
    busyRef.current = false;

    const fiber = Effect.runFork(
      Effect.either(publishingApi.read(versionId, token)).pipe(
        Effect.map((result) => {
          if (requestRef.current !== requestId) return;
          if (Either.isLeft(result)) {
            setError(
              "This version could not be loaded. Check the link and access token, then retry.",
            );
          } else {
            setVersion(result.right.version);
          }
          setLoading(false);
        }),
      ),
    );

    return () => {
      requestRef.current += 1;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [versionId, token]);

  function retry(): void {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setError(null);
    const requestId = ++requestRef.current;
    const fiber = Effect.runFork(
      Effect.either(publishingApi.read(versionId, token)).pipe(
        Effect.map((result) => {
          if (requestRef.current !== requestId) return;
          busyRef.current = false;
          if (Either.isLeft(result)) {
            setError(
              "This version could not be loaded. Check the link and access token, then retry.",
            );
          } else {
            setVersion(result.right.version);
          }
          setLoading(false);
        }),
      ),
    );
    // Retry fibers are scoped to the current version by the effect lifecycle below.
    retryFiberRef.current = fiber;
  }

  const retryFiberRef = useRef<ReturnType<typeof Effect.runFork> | null>(null);
  useEffect(
    () => () => {
      if (retryFiberRef.current) Effect.runFork(Fiber.interrupt(retryFiberRef.current));
      retryFiberRef.current = null;
    },
    [versionId, token],
  );

  const cards = version?.content.cards.slice(0, 5) ?? [];
  return (
    <section
      aria-labelledby="deck-version-preview-title"
      className="space-y-5 rounded-xl border bg-card p-5"
    >
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Version {version?.version ?? "preview"}
        </p>
        <h2 id="deck-version-preview-title" className="text-xl font-semibold">
          {version?.content.title ?? "Deck preview"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Review a sample before choosing whether to add this deck to your library.
        </p>
      </div>

      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading deck preview…
        </p>
      ) : null}
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={retry} disabled={loading}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {version ? (
        <>
          <dl className="grid gap-3 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium">License</dt>
              <dd className="text-muted-foreground">{version.license}</dd>
            </div>
            <div>
              <dt className="font-medium">Attribution</dt>
              <dd className="text-muted-foreground">{version.attribution || "Not provided"}</dd>
            </div>
          </dl>

          <div className="space-y-3">
            <h3 className="font-medium">
              Sample cards ({cards.length} of {version.content.cards.length})
            </h3>
            {cards.length === 0 ? (
              <p className="text-sm text-muted-foreground">This deck has no cards to preview.</p>
            ) : (
              <ol className="space-y-3">
                {cards.map((card, index) => {
                  const cloze =
                    card.kind === "cloze"
                      ? Effect.runSync(Effect.either(expandCloze(card.text, card.deletionIndex)))
                      : null;
                  const renderedCloze = cloze && Either.isRight(cloze) ? cloze.right[0] : undefined;
                  const front =
                    card.kind === "basic" ? card.front : (renderedCloze?.front ?? card.text);
                  const back =
                    card.kind === "basic" ? card.back : (renderedCloze?.back ?? card.text);
                  const isRevealed = revealed.has(card.id);
                  return (
                    <li key={card.id} className="space-y-3 rounded-lg border p-4">
                      <p className="text-xs font-medium text-muted-foreground">Card {index + 1}</p>
                      <p className="whitespace-pre-wrap text-sm">{front}</p>
                      {isRevealed ? (
                        <p className="whitespace-pre-wrap border-t pt-3 text-sm">{back}</p>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setRevealed((current) => new Set(current).add(card.id))}
                        >
                          Reveal answer
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button type="button" onClick={onAddPersonalCopy}>
              Add personal copy
            </Button>
            <span className="text-sm text-muted-foreground">
              You can review the full import before saving.
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
