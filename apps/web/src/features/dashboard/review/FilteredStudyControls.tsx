import { useFilteredStudy } from "@recall/react";
import { Either } from "effect";
import type { FilteredDeck, LearningArea, Workspace } from "@recall/domain";
import { CARD_SEARCH_HELP } from "@recall/application";
import { Input } from "@recall/ui-web";
import { Button } from "@/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { type SaveStudyCommand } from "./useStudyCardControls";

export function FilteredStudyControls({
  workspace,
  area,
  now,
  onStart,
  save,
}: {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly now: number;
  readonly onStart: (area: LearningArea, deck?: FilteredDeck) => void;
  readonly save: SaveStudyCommand;
}) {
  const {
    deck,
    scope,
    setScope,
    mode,
    setMode,
    saveCollection,
    loadCollection,
    removeCollection,
    newCollection,
    query,
    setQuery,
    name,
    setName,
    limit,
    setLimit,
    order,
    setOrder,
    settings,
    filtered,
    controls,
    saveSearch,
    deleteSearch,
    filterReviews,
    canSaveSearch,
  } = useFilteredStudy(workspace, area, now, save);
  return (
    <section className="grid gap-3 border-b pb-4" aria-label="Filtered study">
      <h3 className="font-semibold">Filtered study collections</h3>
      <Select value={scope} onValueChange={setScope}>
        <SelectTrigger aria-label="Study scope">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {workspace.areas.map((subject) => (
            <SelectItem key={subject.id} value={subject.id}>
              {subject.title}
            </SelectItem>
          ))}
          <SelectItem value="all">All subjects</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={mode}
        onValueChange={(value) => {
          if (value === "preview" || value === "reschedule") setMode(value);
        }}
      >
        <SelectTrigger aria-label="Answer behavior">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="preview">Preview without scheduling</SelectItem>
          <SelectItem value="reschedule">Record answers and reschedule</SelectItem>
        </SelectContent>
      </Select>
      <p>
        {mode === "reschedule"
          ? "Answers update the original cards, even when early or above normal daily limits."
          : "Preview leaves schedules and answer history unchanged."}
      </p>
      {!!settings.filteredDecks?.length && (
        <Select onValueChange={loadCollection}>
          <SelectTrigger aria-label="Saved study collections">
            <SelectValue placeholder="Load a study collection" />
          </SelectTrigger>
          <SelectContent>
            {settings.filteredDecks.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={newCollection}>
          New collection
        </Button>
        <Button
          variant="secondary"
          disabled={!name.trim() || controls.busy || Either.isLeft(filtered)}
          onClick={saveCollection}
        >
          Save collection
        </Button>
        <Button
          variant="secondary"
          disabled={controls.busy || !settings.filteredDecks?.some((item) => item.id === deck.id)}
          onClick={removeCollection}
        >
          Delete collection
        </Button>
      </div>
      <label>
        Card search
        <Input
          value={query}
          maxLength={500}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="tag:biology (is:due OR rated:7:again)"
        />
      </label>
      <p className="text-sm text-muted-foreground">{CARD_SEARCH_HELP}</p>
      {(settings.savedSearches?.length ?? 0) > 0 && (
        <Select onValueChange={setQuery}>
          <SelectTrigger aria-label="Saved card searches">
            <SelectValue placeholder="Load a saved search" />
          </SelectTrigger>
          <SelectContent>
            {settings.savedSearches?.map((search) => (
              <SelectItem key={search.id} value={search.query}>
                {search.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <label>
        Card limit
        <Input
          type="number"
          min={1}
          max={500}
          value={limit}
          onChange={(event) => {
            setLimit(event.target.value);
          }}
        />
      </label>
      <Select
        value={order}
        onValueChange={(value) => {
          if (value === "due" || value === "weakest" || value === "shortest" || value === "longest")
            setOrder(value);
        }}
      >
        <SelectTrigger aria-label="Filtered study order">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="due">Oldest due first</SelectItem>
          <SelectItem value="weakest">Lowest recall first</SelectItem>
          <SelectItem value="shortest">Shortest intervals first</SelectItem>
          <SelectItem value="longest">Longest intervals first</SelectItem>
        </SelectContent>
      </Select>
      {Either.isLeft(filtered) ? (
        <p role="alert">{filtered.left.message}</p>
      ) : (
        <p role="status">
          {filtered.right.cards.length} cards selected. Suspended cards are excluded.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            Either.isLeft(filtered) ||
            (Either.isRight(filtered) && filtered.right.cards.length === 0)
          }
          onClick={() => {
            if (Either.isRight(filtered)) onStart(filtered.right, deck);
          }}
        >
          Rebuild and start collection
        </Button>
        <Button
          variant="secondary"
          disabled={controls.busy || Either.isLeft(filtered) || !query.trim()}
          onClick={filterReviews}
        >
          Filter scheduled reviews
        </Button>
      </div>
      <label>
        Save this search as
        <Input
          value={name}
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      <Button variant="secondary" disabled={!canSaveSearch} onClick={saveSearch}>
        Save search
      </Button>
      {settings.savedSearches?.some((search) => search.query === query) && (
        <Button
          variant="secondary"
          disabled={controls.busy}
          onClick={() => {
            deleteSearch();
          }}
        >
          Delete this saved search
        </Button>
      )}
      {controls.message && <p role="status">{controls.message}</p>}
    </section>
  );
}
