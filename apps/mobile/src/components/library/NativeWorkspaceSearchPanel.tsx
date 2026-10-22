import { NativeButton } from "../ui/NativeButton";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Effect, Either, Fiber } from "effect";
import { NativeTextField } from "../ui/NativeTextField";
import {
  searchWorkspace,
  validateStudyQuery,
  isStructuredStudyQuery,
  CARD_SEARCH_HELP,
  type WorkspaceSearchKind,
  type WorkspaceSearchNotebook,
  type WorkspaceSearchResult,
} from "@recall/application";
import type { Workspace } from "@recall/domain";
import { loadNativeWorkspaceSearchNotebooks } from "../../storage/workspace/native-workspace-search";

const labels: Record<WorkspaceSearchKind, string> = {
  area: "Area",
  card: "Card",
  objective: "Objective",
  concept: "Concept",
  material: "Material",
  passage: "Passage",
  claim: "Topic",
  conversation: "Tutor discussion",
  suggestion: "Suggestion",
};

function KindFilterButton({
  value,
  selected,
  onSelect,
}: {
  readonly value: WorkspaceSearchKind | null;
  readonly selected: boolean;
  readonly onSelect: (value: WorkspaceSearchKind | null) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        onSelect(value);
      }}
      className="min-h-[44px] justify-center px-[8px]"
    >
      <Text
        className={
          selected ? "font-bold text-recall-ink" : "text-[12px] leading-[18px] text-recall-muted"
        }
      >
        {value ? labels[value] : "All"}
      </Text>
    </Pressable>
  );
}
export type NativeWorkspaceSearchPanelProps = {
  readonly notebookScope?: string | undefined;
  readonly workspace: Workspace | null;
  readonly onNavigate: (result: WorkspaceSearchResult) => void;
  readonly disabled?: boolean;
  readonly initialQuery?: string;
  readonly initialNotebooks?: readonly WorkspaceSearchNotebook[];
};
export function NativeWorkspaceSearchPanel({
  workspace,
  notebookScope,
  onNavigate,
  disabled = false,
  initialQuery = "",
  initialNotebooks,
}: NativeWorkspaceSearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [searchNow] = useState(() => Date.now());
  const [kind, setKind] = useState<WorkspaceSearchKind | null>(null);
  const [index, setIndex] = useState<{
    readonly workspace: Workspace | null;
    readonly notebooks: readonly WorkspaceSearchNotebook[];
    readonly unreadableCount: number;
    readonly refresh: number;
  }>({
    workspace: initialNotebooks ? workspace : null,
    notebooks: initialNotebooks ?? [],
    unreadableCount: 0,
    refresh: 0,
  });
  const [refresh, setRefresh] = useState(0);
  const loading = Boolean(
    workspace && !initialNotebooks && (index.workspace !== workspace || index.refresh !== refresh),
  );
  useEffect(() => {
    if (!workspace || initialNotebooks) return;
    let active = true;
    const fiber = Effect.runFork(
      loadNativeWorkspaceSearchNotebooks(workspace, notebookScope).pipe(
        Effect.tap((loaded) =>
          Effect.sync(() => {
            if (active) setIndex({ workspace, ...loaded, refresh });
          }),
        ),
      ),
    );
    return () => {
      active = false;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [workspace, initialNotebooks, refresh, notebookScope]);
  const notebooks = initialNotebooks ?? (index.workspace === workspace ? index.notebooks : []);
  const results = workspace
    ? searchWorkspace(workspace, notebooks, query, {
        now: searchNow,
        limit: 100,
        ...(kind ? { kinds: [kind] } : {}),
      })
    : [];
  const queryValidation = isStructuredStudyQuery(query)
    ? Effect.runSync(Effect.either(validateStudyQuery(query)))
    : Either.right(null);
  const queryError = Either.isLeft(queryValidation) ? queryValidation.left.message : null;
  return (
    <View className={"gap-[12px]"} testID="native-workspace-search">
      <Text className={"text-[20px] font-semibold text-recall-ink"}>Search</Text>
      <NativeTextField
        label="Search"
        placeholder="Search cards, materials and discussions"
        value={query}
        maxLength={500}
        onChangeText={setQuery}
      />
      <Text className="text-xs text-recall-muted">Card filters: {CARD_SEARCH_HELP}</Text>
      {queryError && (
        <Text accessibilityRole="alert" className="text-sm text-recall-muted">
          {queryError}
        </Text>
      )}
      <View className={"flex-row flex-wrap gap-[6px]"}>
        {[null, ...(Object.keys(labels) as WorkspaceSearchKind[])].map((value) => (
          <KindFilterButton
            key={value ?? "all"}
            value={value}
            selected={value === kind}
            onSelect={setKind}
          />
        ))}
      </View>
      {loading && (
        <Text
          accessibilityLiveRegion="polite"
          className={"text-[12px] leading-[18px] text-recall-muted"}
        >
          Reading study materials…
        </Text>
      )}
      {index.workspace === workspace && index.unreadableCount > 0 && (
        <Text accessibilityRole="alert" className={"text-[12px] leading-[18px] text-recall-muted"}>
          Some saved notebooks could not be read. Card search is still available.
        </Text>
      )}
      <NativeButton
        label="Refresh search"
        tone="soft"
        disabled={loading || !workspace}
        onPress={() => {
          setRefresh(refresh + 1);
        }}
      />
      {query.trim() && !loading && (
        <Text
          accessibilityLiveRegion="polite"
          className={"text-[12px] leading-[18px] text-recall-muted"}
        >
          {results.length === 100 ? "First 100 matches" : `${String(results.length)} matches`}
        </Text>
      )}
      {results.map((result) => (
        <Pressable
          key={result.id}
          accessibilityRole="button"
          disabled={disabled}
          accessibilityState={{ disabled }}
          onPress={() => {
            onNavigate(result);
          }}
          className={"gap-[5px] py-[14px] border-t border-recall-line"}
        >
          <Text className={"text-[14px] font-semibold text-recall-ink"}>{result.title}</Text>
          <Text className={"text-[12px] leading-[18px] text-recall-muted"}>
            {result.areaTitle} · {labels[result.kind]}
          </Text>
          <Text className={"text-[13px] leading-[19px] text-recall-ink"}>{result.snippet}</Text>
        </Pressable>
      ))}
      {!query.trim() && (
        <Text className={"text-[12px] leading-[18px] text-recall-muted"}>
          Enter a word or phrase to search your library.
        </Text>
      )}
    </View>
  );
}
