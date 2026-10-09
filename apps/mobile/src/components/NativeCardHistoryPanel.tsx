import { NativeButton } from "./ui/NativeButton";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  cardVersionHistory,
  cardVersionRestoresAsCopy,
  workspaceAuthoringBaseline,
} from "@recall/application";
import type { Workspace } from "@recall/domain";

export function NativeCardHistoryPanel({
  workspace,
  areaId,
  cardId,
  disabled = false,
  onRestore,
  initialVersionId = null,
}: {
  readonly workspace: Workspace;
  readonly areaId?: string;
  readonly cardId?: string;
  readonly disabled?: boolean;
  readonly initialVersionId?: string | null;
  readonly onRestore: (command: unknown, baseline: string | undefined) => void;
}) {
  const versions = cardVersionHistory(workspace, areaId, cardId);
  const [selection, setSelection] = useState<{
    readonly id: string;
    readonly baseline: string | undefined;
  } | null>(() => {
    const version = versions.find((item) => item.id === initialVersionId);
    return version
      ? {
          id: version.id,
          baseline: workspaceAuthoringBaseline(workspace, {
            kind: "restore-card",
            areaId: version.areaId,
            cardId: version.cardId,
            versionId: version.id,
          }),
        }
      : null;
  });
  const selectedId = selection?.id;
  const [limit, setLimit] = useState(20);
  const selected = versions.find((version) => version.id === selectedId);
  return (
    <View className={"gap-[10px]"} testID="native-card-history">
      <Text className={"text-recall-ink font-semibold text-[14px]"}>Card history</Text>
      <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
        Choose a saved version to preview. Restoring keeps review history.
      </Text>
      {versions.length === 0 && (
        <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
          No earlier versions saved yet.
        </Text>
      )}
      {versions.slice(0, limit).map((version) => {
        const current = workspace.areas
          .find((area) => area.id === version.areaId)
          ?.cards.find((card) => card.id === version.cardId);
        const exists = Boolean(current);
        const restoresAsCopy = cardVersionRestoresAsCopy(workspace, version.areaId, version.cardId);
        return (
          <View key={version.id} className={"border-t border-recall-line py-[12px] gap-[6px]"}>
            <Text className={"text-recall-ink font-semibold text-[14px]"}>
              {version.card.front}
            </Text>
            <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
              {version.area.title} · {new Date(version.recordedAt).toLocaleString()} ·{" "}
              {version.reason}
              {exists ? "" : " · Deleted"}
            </Text>
            <NativeButton
              label={selectedId === version.id ? "Hide version" : "Preview version"}
              tone="soft"
              disabled={disabled}
              onPress={() =>
                setSelection(
                  selectedId === version.id
                    ? null
                    : {
                        id: version.id,
                        baseline: workspaceAuthoringBaseline(workspace, {
                          kind: "restore-card",
                          areaId: version.areaId,
                          cardId: version.cardId,
                          versionId: version.id,
                        }),
                      },
                )
              }
            />
            {selected?.id === version.id && (
              <View className={"gap-[10px]"}>
                {current && (
                  <View className={"gap-[10px]"}>
                    <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                      Current version
                    </Text>
                    <Text>{current.cloze?.text ?? current.front}</Text>
                    <Text>{current.back}</Text>
                  </View>
                )}
                <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                  Saved version
                </Text>
                <Text>{version.card.cloze?.text ?? version.card.front}</Text>
                <Text>{version.card.back}</Text>
                {restoresAsCopy && (
                  <Text className={"text-recall-muted text-[12px] leading-[18px]"}>
                    Recovery creates a new card with a fresh review schedule. The original review
                    history stays saved.
                  </Text>
                )}
                <NativeButton
                  label={
                    restoresAsCopy
                      ? "Recover as a new card"
                      : exists
                        ? "Restore this version"
                        : "Recover card"
                  }
                  tone="soft"
                  disabled={disabled}
                  onPress={() => {
                    const command = {
                      kind: "restore-card" as const,
                      areaId: version.areaId,
                      cardId: version.cardId,
                      versionId: version.id,
                    };
                    if (selection?.id === version.id) onRestore(command, selection.baseline);
                  }}
                />
              </View>
            )}
          </View>
        );
      })}
      {versions.length > limit && (
        <NativeButton label="Show more versions" tone="soft" onPress={() => setLimit(limit + 20)} />
      )}
    </View>
  );
}
