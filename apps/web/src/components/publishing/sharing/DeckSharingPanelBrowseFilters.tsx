"use client";

import type { DeckSummary } from "@recall/contracts";
import { Button } from "@/components/ui/Button";
import { Input } from "@recall/ui-web";
import { Search } from "lucide-react";
import { Label } from "@recall/ui-web/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import type { DeckSharingBrowseFilters } from "./useDeckSharingBrowseFilters";
import {
  decodeDeckSharingDifficulty,
  deckSharingActivityLabel,
  deckSharingActivityTypes,
} from "./DeckSharingPanelSupport";

type Props = {
  readonly filters: DeckSharingBrowseFilters;
  readonly onFilterChange: <K extends keyof DeckSharingBrowseFilters>(
    key: K,
    value: DeckSharingBrowseFilters[K],
  ) => void;
  readonly onClearFilters: () => void;
  readonly ownedOnly: boolean;
  readonly onOwnedOnlyChange: (value: boolean) => void;
  readonly decks: readonly DeckSummary[];
  readonly busy: boolean;
  readonly onSearch: () => void;
};

function ActivityFilter({
  value,
  decks,
  onChange,
}: {
  readonly value: string;
  readonly decks: readonly DeckSummary[];
  readonly onChange: (value: string) => void;
}) {
  const activityTypes = deckSharingActivityTypes(decks, value);
  return (
    <Label className="grid gap-2 text-xs text-muted-foreground">
      Activity
      <Select
        value={value || "__any__"}
        onValueChange={(selection) => {
          onChange(selection === "__any__" ? "" : selection);
        }}
      >
        <SelectTrigger className="w-full" aria-label="Activity or card type">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__any__">Any activity</SelectItem>
          {activityTypes.map((type) => (
            <SelectItem key={type} value={type}>
              {deckSharingActivityLabel(type)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Label>
  );
}

function StudyTimeFilter({
  value,
  onChange,
}: {
  readonly value: DeckSharingBrowseFilters["studyTime"];
  readonly onChange: (value: DeckSharingBrowseFilters["studyTime"]) => void;
}) {
  return (
    <Label className="grid gap-2 text-xs text-muted-foreground">
      Study time
      <Select
        value={value}
        onValueChange={(selection) => {
          onChange(
            selection === "short" || selection === "medium" || selection === "long"
              ? selection
              : "any",
          );
        }}
      >
        <SelectTrigger className="w-full" aria-label="Estimated study time">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any duration</SelectItem>
          <SelectItem value="short">Up to 10 minutes</SelectItem>
          <SelectItem value="medium">11–30 minutes</SelectItem>
          <SelectItem value="long">31 minutes or more</SelectItem>
        </SelectContent>
      </Select>
    </Label>
  );
}

export function DeckSharingPanelBrowseFilters({
  filters,
  onFilterChange,
  onClearFilters,
  ownedOnly,
  onOwnedOnlyChange,
  decks,
  busy,
  onSearch,
}: Props) {
  const { query, language, tag, difficulty, activityType, studyTime } = filters;
  const hasFilters = Boolean(
    query || language || tag || difficulty || activityType || studyTime !== "any",
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            aria-label="Search decks"
            placeholder="Search shared decks…"
            value={query}
            onChange={(event) => {
              onFilterChange("query", event.target.value);
            }}
          />
        </div>
        <Select
          value={ownedOnly ? "mine" : "all"}
          onValueChange={(value) => {
            onOwnedOnlyChange(value === "mine");
          }}
        >
          <SelectTrigger className="w-40" aria-label="Deck collection">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All shared decks</SelectItem>
            <SelectItem value="mine">My published decks</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline" disabled={busy}>
          Search
        </Button>
        {hasFilters ? (
          <Button type="button" variant="link" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Label className="grid gap-2 text-xs text-muted-foreground">
          Language
          <Input
            aria-label="Filter by language"
            placeholder="Any language"
            value={language}
            onChange={(event) => {
              onFilterChange("language", event.target.value);
            }}
          />
        </Label>
        <Label className="grid gap-2 text-xs text-muted-foreground">
          Topic
          <Input
            aria-label="Filter by tag"
            placeholder="Any topic"
            value={tag}
            onChange={(event) => {
              onFilterChange("tag", event.target.value);
            }}
          />
        </Label>
        <Label className="grid gap-2 text-xs text-muted-foreground">
          Difficulty
          <Select
            value={difficulty || "__any__"}
            onValueChange={(value) => {
              onFilterChange("difficulty", decodeDeckSharingDifficulty(value));
            }}
          >
            <SelectTrigger className="w-full" aria-label="Difficulty">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">Any difficulty</SelectItem>
              <SelectItem value="beginner">Beginner</SelectItem>
              <SelectItem value="intermediate">Intermediate</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>
        </Label>
        <ActivityFilter
          value={activityType}
          decks={decks}
          onChange={(value) => {
            onFilterChange("activityType", value);
          }}
        />
        <StudyTimeFilter
          value={studyTime}
          onChange={(value) => {
            onFilterChange("studyTime", value);
          }}
        />
      </div>
    </form>
  );
}
