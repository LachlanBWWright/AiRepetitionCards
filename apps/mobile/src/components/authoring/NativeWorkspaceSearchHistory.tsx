import { Text, View } from "react-native";
import { findDuplicateCardPairs, type WorkspaceSearchResult } from "@recall/application";
import type { Workspace } from "@recall/domain";
import type { Editor } from "./NativeWorkspaceAuthoringPanel.types";
import { NativeButton } from "../ui/NativeButton";
import { NativeCardHistoryPanel } from "../review/NativeCardHistoryPanel";

export type NativeWorkspaceSearchHistoryProps = {
  readonly searchTarget: WorkspaceSearchResult | null | undefined;
  readonly workspace: Workspace | null;
  readonly locked: boolean;
  readonly editor: Editor | null;
  readonly history: { readonly areaId?: string; readonly cardId?: string } | null;
  readonly showDuplicates: boolean;
  readonly duplicatePairs: ReturnType<typeof findDuplicateCardPairs>;
  readonly onOpenSearchCard: () => void;
  readonly onFilterObjective: (
    areaId: WorkspaceSearchResult["areaId"],
    objectiveId: Extract<
      WorkspaceSearchResult["target"],
      { readonly kind: "objective" }
    >["objectiveId"],
  ) => void;
  readonly onToggleHistory: () => void;
  readonly onRestore: (command: unknown, baseline?: string) => void;
  readonly onToggleDuplicates: () => void;
  readonly onEditDuplicate: (areaId: string | undefined, cardId: string) => void;
};

export function NativeWorkspaceSearchHistory({
  searchTarget,
  workspace,
  locked,
  editor,
  history,
  showDuplicates,
  duplicatePairs,
  onOpenSearchCard,
  onFilterObjective,
  onToggleHistory,
  onRestore,
  onToggleDuplicates,
  onEditDuplicate,
}: NativeWorkspaceSearchHistoryProps) {
  function filterSelectedObjective() {
    if (searchTarget?.target.kind === "objective")
      onFilterObjective(searchTarget.areaId, searchTarget.target.objectiveId);
  }
  function editDuplicate(areaId: string | undefined, cardId: string) {
    if (areaId) onEditDuplicate(areaId, cardId);
  }
  return (
    <>
      {searchTarget && workspace && (
        <View className={"gap-[8px] pb-[12px]"}>
          <Text className={"text-recall-ink text-[13px] font-semibold"}>{searchTarget.title}</Text>
          <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
            {searchTarget.snippet}
          </Text>
          {searchTarget.target.kind === "card" && (
            <NativeButton
              label={editor ? "Discard draft and open selected card" : "Edit selected card"}
              tone="soft"
              disabled={locked}
              onPress={onOpenSearchCard}
            />
          )}
          {searchTarget.target.kind === "objective" && (
            <NativeButton
              label="Filter cards by this objective"
              tone="soft"
              onPress={filterSelectedObjective}
            />
          )}
        </View>
      )}
      {workspace && (
        <View className={"gap-[8px] pb-[12px]"}>
          <NativeButton
            label={history ? "Hide history" : "Card history and recovery"}
            tone="soft"
            disabled={locked}
            onPress={onToggleHistory}
          />
          {history && editor && (
            <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
              Save or cancel your draft before restoring a version.
            </Text>
          )}
          {history && (
            <NativeCardHistoryPanel
              workspace={workspace}
              {...history}
              disabled={locked || editor !== null}
              onRestore={onRestore}
            />
          )}
          <NativeButton
            label={showDuplicates ? "Hide duplicates" : "Find duplicates"}
            tone="soft"
            disabled={locked}
            onPress={onToggleDuplicates}
          />
          {showDuplicates && (
            <DuplicateList pairs={duplicatePairs} locked={locked} onEdit={editDuplicate} />
          )}
        </View>
      )}
    </>
  );
}

function DuplicatePair({
  pair,
  locked,
  onEdit,
}: {
  readonly pair: ReturnType<typeof findDuplicateCardPairs>[number];
  readonly locked: boolean;
  readonly onEdit: (areaId: string | undefined, cardId: string) => void;
}) {
  return (
    <View className={"border-t border-recall-line py-[8px]"}>
      <Text className={"text-recall-ink text-[13px] font-semibold"}>{pair.left.front}</Text>
      <Text>{pair.right.front}</Text>
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>{pair.reason}</Text>
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        {pair.left.areaTitle} · {pair.right.areaTitle}
      </Text>
      {[pair.left, pair.right].map((candidate) => (
        <NativeButton
          key={candidate.id}
          label={`Edit: ${candidate.front.slice(0, 60)}`}
          tone="soft"
          disabled={locked}
          onPress={() => {
            onEdit(candidate.areaId, candidate.id);
          }}
        />
      ))}
    </View>
  );
}

function DuplicateList({
  pairs,
  locked,
  onEdit,
}: {
  readonly pairs: ReturnType<typeof findDuplicateCardPairs>;
  readonly locked: boolean;
  readonly onEdit: (areaId: string | undefined, cardId: string) => void;
}) {
  return (
    <View className={"gap-[8px] pb-[12px]"}>
      {pairs.length === 0 && (
        <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
          No likely duplicates found.
        </Text>
      )}
      {pairs.map((pair) => (
        <DuplicatePair
          key={`${pair.left.id}:${pair.right.id}`}
          pair={pair}
          locked={locked}
          onEdit={onEdit}
        />
      ))}
    </View>
  );
}
