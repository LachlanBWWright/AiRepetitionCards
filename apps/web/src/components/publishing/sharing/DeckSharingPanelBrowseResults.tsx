"use client";

import type { DeckSummary } from "@recall/contracts";
import { Button } from "@/components/ui/Button";
import { ArrowUpRight } from "lucide-react";
import type { DeckSharingDetail } from "./DeckSharingPanelTypes";
import { deckSharingDifficultyLabel } from "./DeckSharingPanelSupport";

type CardProps = {
  readonly deck: DeckSummary;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly loadDetail: (deckId: string) => Promise<void>;
  readonly onOpenDeck?: (deckId: string, token?: string) => void;
  readonly initialToken?: string;
};

function DeckCard({ deck, selected, onSelect, loadDetail, onOpenDeck, initialToken }: CardProps) {
  return (
    <article
      className={`rounded-xl border p-4 transition hover:border-primary ${selected ? "border-primary bg-muted/40" : "bg-card"}`}
    >
      <Button
        variant="link"
        className="h-auto w-full min-w-0 flex-col items-stretch p-0 text-left text-foreground no-underline hover:no-underline"
        aria-pressed={selected}
        onClick={() => {
          onSelect();
          void loadDetail(deck.id);
        }}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="font-semibold">{deck.title}</span>
          <span className="text-xs text-muted-foreground">
            v{deck.version} · {deck.cardCount} cards
          </span>
        </span>
        <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">
          {deck.description || "No description provided."}
        </span>
        <span className="mt-2 block text-xs text-muted-foreground">
          {deck.authorName} · {deck.language} · {deck.visibility}
          {deck.status === "withdrawn" ? " · withdrawn" : ""}
        </span>
        {deck.tags.length > 0 ? (
          <span className="mt-2 block text-xs">{deck.tags.join(" · ")}</span>
        ) : null}
        {deck.catalog ? (
          <span className="mt-2 block text-xs text-muted-foreground">
            {deckSharingDifficultyLabel(deck.catalog.difficulty)}
            About {deck.catalog.estimatedMinutes} minutes
          </span>
        ) : null}
        {deck.catalog?.preview[0] ? (
          <span className="mt-2 block rounded-md bg-muted/50 p-2 text-xs">
            Preview: {deck.catalog.preview[0].prompt}
            {deck.catalog.preview[0].answer ? ` → ${deck.catalog.preview[0].answer}` : ""}
          </span>
        ) : null}
      </Button>
      {onOpenDeck ? (
        <Button
          variant="link"
          className="mt-3 h-auto gap-1 p-0 text-xs"
          onClick={() => {
            onOpenDeck(deck.id, initialToken);
          }}
        >
          Open deck page
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </Button>
      ) : null}
    </article>
  );
}

type Props = {
  readonly decks: readonly DeckSummary[];
  readonly selected: string | null;
  readonly detail: DeckSharingDetail | null;
  readonly ownedOnly: boolean;
  readonly busy: boolean;
  readonly nextCursor: string | null;
  readonly loadList: (options?: {
    readonly cursor?: string;
    readonly append?: boolean;
  }) => Promise<void>;
  readonly loadDetail: (deckId: string) => Promise<void>;
  readonly onSelectDeck: () => void;
  readonly onOpenDeck?: (deckId: string, token?: string) => void;
  readonly initialToken?: string;
};

export function DeckSharingPanelBrowseResults({
  decks,
  selected,
  detail,
  ownedOnly,
  busy,
  nextCursor,
  loadList,
  loadDetail,
  onSelectDeck,
  onOpenDeck,
  initialToken,
}: Props) {
  return (
    <>
      <div className={`grid gap-3 ${detail ? "" : "sm:grid-cols-2"}`}>
        {decks.map((deck) => (
          <DeckCard
            key={deck.id}
            deck={deck}
            selected={selected === deck.id}
            onSelect={onSelectDeck}
            loadDetail={loadDetail}
            {...(onOpenDeck ? { onOpenDeck } : {})}
            {...(initialToken !== undefined ? { initialToken } : {})}
          />
        ))}
        {decks.length === 0 && !busy ? (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {ownedOnly
              ? "You haven’t published any decks yet."
              : "No shared decks found. Try a different search or clear the filters."}
          </p>
        ) : null}
      </div>
      {nextCursor ? (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void loadList({ cursor: nextCursor, append: true })}
        >
          Load more decks
        </Button>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      ) : null}
    </>
  );
}
