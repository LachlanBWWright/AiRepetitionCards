import { useRef, useState } from "react";
import type { LearningArea, Workspace } from "@recall/domain";

export function useNativeWorkspaceLibraryState(input: {
  readonly area: LearningArea | undefined;
  readonly workspace: Workspace | null;
  readonly initialObjectiveFilter: string | undefined;
  readonly initialSearch: string | undefined;
  readonly requestedFlaggedOnly: boolean | undefined;
  readonly onFlaggedFilterChange: ((value: boolean) => void) | undefined;
}) {
  const {
    area,
    workspace,
    initialObjectiveFilter,
    initialSearch,
    requestedFlaggedOnly,
    onFlaggedFilterChange,
  } = input;
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(Boolean(initialObjectiveFilter));
  const [query, setQuery] = useState(initialSearch ?? "");
  const [objectiveSelection, setObjectiveSelection] = useState({
    areaId: area?.id ?? null,
    value: initialObjectiveFilter ?? "",
  });
  const objectiveFilter =
    objectiveSelection.areaId === (area?.id ?? null) ? objectiveSelection.value : "";
  const objectives = area?.objectives ?? [];
  const legacyObjectives = [...new Set(area?.cards.map((card) => card.objective) ?? [])].filter(
    (title) => !objectives.some((objective) => objective.title === title),
  );

  const [selectedCards, setSelectedCards] = useState<readonly string[]>([]);
  const [selectionAreaId, setSelectionAreaId] = useState(area?.id ?? "");
  const [localFlaggedOnly, setLocalFlaggedOnly] = useState(false);
  const flaggedOnly = requestedFlaggedOnly ?? localFlaggedOnly;
  function setFlaggedOnly(value: boolean) {
    setLocalFlaggedOnly(value);
    onFlaggedFilterChange?.(value);
  }
  const [bulkAction, setBulkAction] = useState<"tags" | "move" | "delete" | null>(null);
  const [bulkTags, setBulkTags] = useState("");
  const [bulkDestination, setBulkDestination] = useState("");
  const [bulkRequest, setBulkRequest] = useState<{
    readonly command: unknown;
    readonly baseline?: string;
  } | null>(null);
  const bulkSnapshot = useRef(workspace);
  const selectedIds =
    selectionAreaId === area?.id
      ? selectedCards.filter((id) => area.cards.some((card) => card.id === id))
      : [];

  return {
    cardMenuId,
    setCardMenuId,
    showFilters,
    setShowFilters,
    query,
    setQuery,
    objectiveSelection,
    setObjectiveSelection,
    objectiveFilter,
    objectives,
    legacyObjectives,
    selectedCards,
    setSelectedCards,
    selectionAreaId,
    setSelectionAreaId,
    flaggedOnly,
    setFlaggedOnly,
    bulkAction,
    setBulkAction,
    bulkTags,
    setBulkTags,
    bulkDestination,
    setBulkDestination,
    bulkRequest,
    setBulkRequest,
    bulkSnapshot,
    selectedIds,
  };
}
