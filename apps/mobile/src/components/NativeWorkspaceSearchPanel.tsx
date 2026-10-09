import { NativeButton } from "./ui/NativeButton";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Effect, Fiber } from "effect";
import { NativeTextField } from "./ui/NativeTextField";
import {
  searchWorkspace,
  type WorkspaceSearchKind,
  type WorkspaceSearchNotebook,
  type WorkspaceSearchResult,
} from "@recall/application";
import type { Workspace } from "@recall/domain";
import { loadNativeWorkspaceSearchNotebooks } from "../storage/native-workspace-search";

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
export type NativeWorkspaceSearchPanelProps = {
  readonly workspace: Workspace | null;
  readonly onNavigate: (result: WorkspaceSearchResult) => void;
  readonly disabled?: boolean;
  readonly initialQuery?: string;
  readonly initialNotebooks?: readonly WorkspaceSearchNotebook[];
};
export function NativeWorkspaceSearchPanel({
  workspace,
  onNavigate,
  disabled = false,
  initialQuery = "",
  initialNotebooks,
}: NativeWorkspaceSearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
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
      loadNativeWorkspaceSearchNotebooks(workspace).pipe(
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
  }, [workspace, initialNotebooks, refresh]);
  const notebooks = initialNotebooks ?? (index.workspace === workspace ? index.notebooks : []);
  const results = workspace
    ? searchWorkspace(workspace, notebooks, query, {
        limit: 100,
        ...(kind ? { kinds: [kind] } : {}),
      })
    : [];
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
      <View className={"flex-row flex-wrap gap-[6px]"}>
        {[null, ...(Object.keys(labels) as WorkspaceSearchKind[])].map((value) => (
          <Pressable
            key={value ?? "all"}
            accessibilityRole="button"
            accessibilityState={{ selected: value === kind }}
            onPress={() => setKind(value)}
            className={"min-h-[44px] justify-center px-[8px]"}
          >
            <Text
              className={
                value === kind
                  ? "font-bold text-recall-ink"
                  : "text-[12px] leading-[18px] text-recall-muted"
              }
            >
              {value ? labels[value] : "All"}
            </Text>
          </Pressable>
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
        onPress={() => setRefresh(refresh + 1)}
      />
      {query.trim() && !loading && (
        <Text
          accessibilityLiveRegion="polite"
          className={"text-[12px] leading-[18px] text-recall-muted"}
        >
          {results.length === 100 ? "First 100 matches" : `${results.length} matches`}
        </Text>
      )}
      {results.map((result) => (
        <Pressable
          key={result.id}
          accessibilityRole="button"
          disabled={disabled}
          accessibilityState={{ disabled }}
          onPress={() => onNavigate(result)}
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
