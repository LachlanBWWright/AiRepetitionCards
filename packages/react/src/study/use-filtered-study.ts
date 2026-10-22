"use client";

import { useState } from "react";
import { Effect, Either } from "effect";
import type { FilteredDeck, LearningArea, Workspace } from "@recall/domain";
import {
  rebuildFilteredDeck,
  saveFilteredDeck,
  saveStudySearch,
  removeStudySearch,
  scheduledStudyFilter,
  type FilteredStudyOrder,
} from "@recall/application";
import { useStudyCommand, type StudyCommandSave } from "./use-study-command";
export function useFilteredStudy(
  workspace: Workspace,
  area: LearningArea,
  now: number,
  save: StudyCommandSave | undefined,
) {
  const [scope, setScope] = useState<string>(area.id);
  const [mode, setMode] = useState<"preview" | "reschedule">("preview");
  const [collectionId, setCollectionId] = useState(() => {
    let index = 1;
    while (
      workspace.schedulerSettings?.filteredDecks?.some(
        (item) => item.id === `collection-${String(index)}`,
      )
    )
      index += 1;
    return `collection-${String(index)}`;
  });
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("100");
  const [order, setOrder] = useState<FilteredStudyOrder>("due");
  const controls = useStudyCommand(workspace, save);
  const settings = workspace.schedulerSettings ?? { requestRetention: 0.9 };
  const deck: FilteredDeck = {
    id: collectionId,
    name: name.trim() || "Selected practice",
    query,
    limit: Number(limit),
    order,
    mode,
    ...(scope !== "all"
      ? {
          areaId:
            area.id === scope
              ? area.id
              : (workspace.areas.find((item) => item.id === scope)?.id ?? area.id),
        }
      : {}),
  };
  const filtered = Effect.runSync(Effect.either(rebuildFilteredDeck(workspace, deck, now, area)));
  const proposal = Effect.runSync(Effect.either(saveStudySearch(settings, name, query)));
  const saveSearch = () => {
    if (Either.isRight(proposal))
      controls.commit(
        { kind: "update-scheduler-settings", settings: proposal.right },
        "Search saved.",
      );
  };
  const deleteSearch = () => {
    controls.commit(
      { kind: "update-scheduler-settings", settings: removeStudySearch(settings, query) },
      "Saved search removed.",
    );
  };
  const filterReviews = () => {
    if (query.trim() && Either.isRight(filtered))
      controls.commit(
        { kind: "update-scheduler-settings", settings: scheduledStudyFilter(settings, query) },
        "Scheduled reviews now use this filter. Clear it in Study tools to see all due cards.",
      );
  };
  const saveCollection = () => {
    if (!name.trim() || Either.isLeft(filtered)) return;
    const proposal = Effect.runSync(Effect.either(saveFilteredDeck(settings, deck)));
    if (Either.isRight(proposal))
      controls.commit(
        { kind: "update-scheduler-settings", settings: proposal.right },
        "Study collection saved. Rebuild it to refresh matching cards.",
      );
  };
  const loadCollection = (id: string) => {
    const saved = settings.filteredDecks?.find((item) => item.id === id);
    if (!saved) return;
    setCollectionId(saved.id);
    setName(saved.name);
    setQuery(saved.query);
    setLimit(String(saved.limit));
    setOrder(saved.order);
    setMode(saved.mode);
    setScope(saved.areaId ?? "all");
  };
  const removeCollection = () => {
    controls.commit(
      {
        kind: "update-scheduler-settings",
        settings: {
          ...settings,
          filteredDecks: settings.filteredDecks?.filter((item) => item.id !== collectionId),
        },
      },
      "Study collection removed.",
    );
  };
  const newCollection = () => {
    let index = 1;
    while (settings.filteredDecks?.some((item) => item.id === `collection-${String(index)}`))
      index += 1;
    setCollectionId(`collection-${String(index)}`);
    setName("");
  };
  return {
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
    canSaveSearch:
      Boolean(save) && !controls.busy && Either.isRight(filtered) && Either.isRight(proposal),
  };
}
