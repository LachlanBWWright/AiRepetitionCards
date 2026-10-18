import type { ComponentProps } from "react";
import { Text } from "react-native";
import type { NativeWorkspaceAuthoringController } from "../useNativeWorkspaceAuthoringController";
import { NativeWorkspaceCardLibrary } from "../library/NativeWorkspaceCardLibrary";
import { NativeWorkspaceCardFilters } from "../library/NativeWorkspaceCardFilters";
import { NativeWorkspaceBulkActions } from "../library/NativeWorkspaceBulkActions";
import { NativeWorkspaceCardRow } from "../library/NativeWorkspaceCardRow";
import { createNativeWorkspaceField } from "../editor/NativeWorkspaceField";
import { NativeWorkspaceFlaggedFilter } from "../library/NativeWorkspaceFlaggedFilter";

export function createCardLibrarySection(
  input: Pick<
    NativeWorkspaceAuthoringController,
    | "workspace"
    | "notes"
    | "area"
    | "locked"
    | "message"
    | "pending"
    | "onFlag"
    | "editor"
    | "cardEditor"
    | "open"
    | "setHistory"
    | "setObjectiveSelection"
    | "setShowFilters"
    | "deleteEditor"
    | "flaggedOnly"
    | "setFlaggedOnly"
    | "query"
    | "setQuery"
    | "objectives"
    | "legacyObjectives"
    | "showFilters"
    | "objectiveFilter"
    | "selectedIds"
    | "bulkAction"
    | "bulkTags"
    | "bulkDestination"
    | "bulkRequest"
    | "beginBulk"
    | "submitBulk"
    | "setBulkTags"
    | "setBulkDestination"
    | "setBulkAction"
    | "setBulkRequest"
    | "setSelectedCards"
    | "setSelectionAreaId"
    | "cardMenuId"
    | "setCardMenuId"
    | "viewData"
  >,
) {
  const {
    workspace,
    notes,
    area,
    locked,
    message,
    pending,
    onFlag,
    editor,
    cardEditor,
    open,
    setHistory,
    setObjectiveSelection,
    setShowFilters,
    deleteEditor,
    flaggedOnly,
    setFlaggedOnly,
    query,
    setQuery,
    objectives,
    legacyObjectives,
    showFilters,
    objectiveFilter,
    selectedIds,
    bulkAction,
    bulkTags,
    bulkDestination,
    bulkRequest,
    beginBulk,
    submitBulk,
    setBulkTags,
    setBulkDestination,
    setBulkAction,
    setBulkRequest,
    setSelectedCards,
    setSelectionAreaId,
    cardMenuId,
    setCardMenuId,
    viewData,
  } = input;
  const { filteredCards } = viewData;
  const field = createNativeWorkspaceField(editor, locked);
  const choices = [
    { value: "", title: "All objectives" },
    ...objectives.map((objective) => ({
      value: `id:${objective.id}`,
      title: objective.title,
    })),
    ...legacyObjectives.map((title) => ({ value: `title:${title}`, title })),
  ];
  const header = area ? (
    <>
      {onFlag && (
        <NativeWorkspaceFlaggedFilter
          area={area}
          flaggedCardIds={notes.flaggedCardIds}
          flaggedOnly={flaggedOnly}
          onChange={setFlaggedOnly}
        />
      )}
      <Text className="text-recall-ink text-[16px] font-bold">All cards · {area.cards.length}</Text>
    </>
  ) : null;
  const filters = area ? (
    <>
      <NativeWorkspaceCardFilters
        areaId={area.id}
        choices={choices}
        objectiveFilter={objectiveFilter}
        setObjectiveSelection={setObjectiveSelection}
        locked={locked}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        query={query}
        setQuery={setQuery}
        renderField={field}
      />
      <Text
        accessibilityLiveRegion="polite"
        className="text-recall-muted text-[12px] leading-[18px]"
      >
        {filteredCards.length} of {area.cards.length} cards
      </Text>
    </>
  ) : null;
  const bulkActions = area ? (
    <NativeWorkspaceBulkActions
      area={area}
      workspace={workspace}
      selectedIds={selectedIds}
      bulkAction={bulkAction}
      bulkTags={bulkTags}
      bulkDestination={bulkDestination}
      bulkRequest={bulkRequest}
      locked={locked}
      pending={pending}
      message={message}
      filteredCount={filteredCards.length}
      onSelectVisible={() => {
        setSelectionAreaId(area.id);
        setSelectedCards([...new Set([...selectedIds, ...filteredCards.map((card) => card.id)])]);
      }}
      onBegin={beginBulk}
      onClearSelection={() => {
        setSelectedCards([]);
      }}
      onChangeTags={(value) => {
        if (!bulkRequest) setBulkTags(value);
      }}
      onChooseDestination={setBulkDestination}
      onSubmit={submitBulk}
      onCancel={() => {
        setBulkAction(null);
        setBulkRequest(null);
      }}
      renderField={field}
    />
  ) : null;
  function renderCard(card: NonNullable<typeof area>["cards"][number]) {
    if (!area) return null;
    const flagCurrentCard = onFlag
      ? () => {
          onFlag(card.id);
        }
      : undefined;
    return (
      <NativeWorkspaceCardRow
        key={card.id}
        card={card}
        selected={selectedIds.includes(card.id)}
        flagged={notes.flaggedCardIds.includes(card.id)}
        locked={locked || bulkAction !== null}
        showMenu={cardMenuId === card.id}
        onSelect={() => {
          setSelectionAreaId(area.id);
          setSelectedCards(
            selectedIds.includes(card.id)
              ? selectedIds.filter((id) => id !== card.id)
              : [...selectedIds, card.id],
          );
        }}
        onEdit={() => {
          open(cardEditor(area.cards.findIndex((item) => item.id === card.id)));
        }}
        onToggleMenu={() => {
          setCardMenuId((value) => (value === card.id ? null : card.id));
        }}
        onFlag={flagCurrentCard}
        onShowHistory={() => {
          setHistory({ areaId: area.id, cardId: card.id });
        }}
        onDelete={() => {
          open(deleteEditor(card.id));
        }}
      />
    );
  }
  const cardRows = area ? filteredCards.map(renderCard) : null;
  const emptyState =
    area && filteredCards.length === 0 ? (
      <Text className="text-recall-muted text-[12px] leading-[18px]">
        {query || objectiveFilter
          ? "No cards match this search and objective filter."
          : "Add your first card to this area."}
      </Text>
    ) : null;

  const props = {
    area,
    header,
    filters,
    bulkActions,
    cardRows,
    emptyState,
  } satisfies ComponentProps<typeof NativeWorkspaceCardLibrary>;
  return props;
}
