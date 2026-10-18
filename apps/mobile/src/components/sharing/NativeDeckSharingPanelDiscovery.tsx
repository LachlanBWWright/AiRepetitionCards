import type { DeckSummary } from "@recall/contracts";
import { NativeDeckSharingBrowseFiltersView } from "./browse/NativeDeckSharingBrowseFilters";
import { NativeDeckSharingBrowseResults } from "./browse/NativeDeckSharingBrowseResults";
import type { NativeDeckSharingBrowseFilters } from "./browse/useNativeDeckSharingBrowseFilters";
export type {
  NativeDeckSharingDifficulty,
  NativeDeckSharingStudyTime,
} from "./browse/useNativeDeckSharingBrowseFilters";

type NativeDeckSharingPanelDiscoveryProps = {
  readonly filters: NativeDeckSharingBrowseFilters;
  readonly onFilterChange: <K extends keyof NativeDeckSharingBrowseFilters>(
    key: K,
    value: NativeDeckSharingBrowseFilters[K],
  ) => void;
  readonly results: {
    readonly decks: readonly DeckSummary[];
    readonly nextCursor: string | null;
    readonly busy: boolean;
  };
  readonly actions: {
    readonly onSearch: (cursor: string | null) => void;
    readonly onOpenDeck: (deckId: string) => void;
  };
};

export function NativeDeckSharingPanelDiscovery({
  filters,
  onFilterChange,
  results,
  actions,
}: NativeDeckSharingPanelDiscoveryProps) {
  const availableActivityTypes = results.decks.flatMap((deck) => [
    ...(deck.catalog?.activityTypes ?? []),
    ...(deck.catalog?.cardTypes ?? []),
  ]);

  return (
    <>
      <NativeDeckSharingBrowseFiltersView
        filters={filters}
        onFilterChange={onFilterChange}
        busy={results.busy}
        onSearch={actions.onSearch}
        availableActivityTypes={availableActivityTypes}
      />
      <NativeDeckSharingBrowseResults
        decks={results.decks}
        nextCursor={results.nextCursor}
        busy={results.busy}
        onSearch={actions.onSearch}
        onOpenDeck={actions.onOpenDeck}
      />
    </>
  );
}
