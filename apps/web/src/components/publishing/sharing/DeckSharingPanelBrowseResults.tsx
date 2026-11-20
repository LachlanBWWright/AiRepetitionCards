"use client";

import { EmptyState } from "@recall/ui-web";

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
    <article className="flex min-w-0 flex-col gap-3">
      <Button
        size="row"
        variant="default"
        className="w-full min-w-0 flex-col items-stretch text-left"
        aria-pressed={selected}
        onClick={() => {
          onSelect();
          void loadDetail(deck.id);
        }}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="font-semibold">{deck.title}</span>
          <span>
            v{deck.version} · {deck.cardCount} cards
          </span>
        </span>
        <span className="text-sm mt-1 block line-clamp-2">
          {deck.description || "No description provided."}
        </span>
        <span className="text-xs mt-2 block">
          {deck.authorName} · {deck.language} · {deck.visibility}
          {deck.status === "withdrawn" ? " · withdrawn" : ""}
        </span>
        {deck.tags.length > 0 ? (
          <span className="text-xs mt-2 block">{deck.tags.join(" · ")}</span>
        ) : null}
        {deck.catalog ? (
          <span className="text-xs mt-2 block">
            {deckSharingDifficultyLabel(deck.catalog.difficulty)}
            About {deck.catalog.estimatedMinutes} minutes
          </span>
        ) : null}
        {deck.catalog?.preview[0] ? (
          <span className="text-xs mt-2 block rounded-md bg-muted/50 p-2">
            Preview: {deck.catalog.preview[0].prompt}
            {deck.catalog.preview[0].answer ? ` → ${deck.catalog.preview[0].answer}` : ""}
          </span>
        ) : null}
      </Button>
      {onOpenDeck ? (
        <Button
          size="sm"
          variant="default"
          className="gap-1 self-start"
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
          <EmptyState
            className="rounded-lg border border-dashed p-6"
            title={ownedOnly ? "No published decks" : "No shared decks found"}
            description={
              ownedOnly
                ? "You haven’t published any decks yet."
                : "Try a different search or clear the filters."
            }
          />
        ) : null}
      </div>
      {nextCursor ? (
        <Button
          variant="default"
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
