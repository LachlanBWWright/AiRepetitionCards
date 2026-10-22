"use client";
import { useMemo, useState } from "react";
import { Effect, Either } from "effect";
import type { LearningArea, Workspace } from "@recall/domain";
import {
  browseStudyCards,
  browserNoteRows,
  createStudySearchIndex,
  defaultBrowserColumns,
  tagHierarchy,
  relatedStudyCards,
  previewFieldReplacement,
  previewNoteFieldReplacement,
  type BrowserColumn,
} from "@recall/application";
import { useStudyCommand, type StudyCommandSave } from "./use-study-command";
export function useCardBrowser(
  workspace: Workspace,
  area: LearningArea,
  now: number,
  save: StudyCommandSave | undefined,
) {
  const [mode, setMode] = useState("cards");
  const index = useMemo(() => createStudySearchIndex(workspace), [workspace]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("subject");
  const [sort, setSort] = useState<BrowserColumn>("front");
  const [descending, setDescending] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [field, setField] = useState<"front" | "back" | "cloze" | "note">("front");
  const [noteField, setNoteField] = useState("");
  const [page, setPage] = useState(0);
  const controls = useStudyCommand(workspace, save);
  const matches = useMemo(
    () =>
      Effect.runSync(
        Effect.either(
          browseStudyCards(
            workspace,
            query,
            now,
            sort,
            descending,
            scope === "subject" ? area.id : undefined,
            index,
          ),
        ),
      ),
    [workspace, query, now, sort, descending, scope, area.id, index],
  );
  const entries = useMemo(() => {
    const cards = Either.isRight(matches) ? matches.right : [];
    return mode === "notes" ? browserNoteRows(cards, workspace) : cards;
  }, [matches, mode, workspace]);
  const columns = workspace.schedulerSettings?.browserColumns ?? defaultBrowserColumns;
  const toggleColumn = (column: BrowserColumn) => {
    const next = columns.includes(column)
      ? columns.filter((item) => item !== column)
      : [...columns, column];
    if (next.length)
      controls.commit({
        kind: "update-scheduler-settings",
        settings: {
          ...(workspace.schedulerSettings ?? { requestRetention: 0.9 }),
          browserColumns: next,
        },
      });
  };
  const selected = entries.find(({ card }) => card.id === selectedId);
  const related = selected ? relatedStudyCards(workspace, selected.card) : [];
  const replacementEntries = field === "note" ? browserNoteRows(entries) : entries;
  const changes = replacementEntries.flatMap((entry) => {
    const preview =
      field === "note"
        ? previewNoteFieldReplacement(
            workspace,
            entry.area.id,
            entry.card,
            noteField,
            find,
            replacement,
          )
        : previewFieldReplacement(entry.card, field, find, replacement);
    return preview ? [{ ...entry, ...preview }] : [];
  });
  const apply = () => {
    if (
      !changes.length ||
      changes.length > 500 ||
      new Set(changes.map(({ area }) => area.id)).size > 1
    )
      return;
    const first = changes[0];
    if (first)
      controls.commit(
        {
          kind: "replace-card-fields",
          areaId: first.area.id,
          cardIds: changes.map(({ card }) => card.id),
          field,
          ...(field === "note" ? { noteField } : {}),
          find,
          replacement,
        },
        "Card fields updated. Previous content is available in version history.",
      );
  };
  const currentPage = Math.min(page, Math.max(0, Math.ceil(entries.length / 50) - 1));
  return {
    mode,
    setMode,
    query,
    setQuery,
    scope,
    setScope,
    sort,
    setSort,
    descending,
    setDescending,
    selectedId,
    setSelectedId,
    find,
    setFind,
    replacement,
    setReplacement,
    field,
    setField,
    noteField,
    setNoteField,
    columns,
    toggleColumn,
    controls,
    entries,
    rows: entries.slice(currentPage * 50, (currentPage + 1) * 50),
    page: currentPage,
    setPage,
    matches,
    related,
    changes,
    apply,
    canApply:
      Boolean(save) &&
      !controls.busy &&
      changes.length > 0 &&
      changes.length <= 500 &&
      new Set(changes.map(({ area }) => area.id)).size === 1,
    tags: useMemo(() => tagHierarchy(workspace), [workspace]),
  };
}
