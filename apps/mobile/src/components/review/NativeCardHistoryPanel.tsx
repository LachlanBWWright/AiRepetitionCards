import { NativeButton } from "../ui/NativeButton";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  cardVersionHistory,
  cardVersionRestoresAsCopy,
  workspaceAuthoringBaseline,
} from "@recall/application";
import type { Workspace } from "@recall/domain";

type HistoryVersion = ReturnType<typeof cardVersionHistory>[number];
type CardHistorySelection = {
  readonly id: string;
  readonly baseline: string | undefined;
};

function HistoryVersionRow({
  workspace,
  version,
  selected,
  disabled,
  onSelect,
  onRestore,
}: {
  readonly workspace: Workspace;
  readonly version: HistoryVersion;
  readonly selected: CardHistorySelection | null;
  readonly disabled: boolean;
  readonly onSelect: (selection: CardHistorySelection | null) => void;
  readonly onRestore: (command: unknown, baseline: string | undefined) => void;
}) {
  const current = workspace.areas
    .find((area) => area.id === version.areaId)
    ?.cards.find((card) => card.id === version.cardId);
  const exists = Boolean(current);
  const restoresAsCopy = cardVersionRestoresAsCopy(workspace, version.areaId, version.cardId);
  const toggleSelection = () => {
    onSelect(
      selected?.id === version.id
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
    );
  };
  const restore = () => {
    if (selected?.id === version.id) {
      onRestore(
        {
          kind: "restore-card" as const,
          areaId: version.areaId,
          cardId: version.cardId,
          versionId: version.id,
        },
        selected.baseline,
      );
    }
  };
  return (
    <View className="border-t border-recall-line py-[12px] gap-[6px]">
      <Text className="text-recall-ink font-semibold text-[14px]">{version.card.front}</Text>
      <Text className="text-recall-muted text-[12px] leading-[18px]">
        {version.area.title} · {new Date(version.recordedAt).toLocaleString()} · {version.reason}
        {exists ? "" : " · Deleted"}
      </Text>
      <NativeButton
        label={selected?.id === version.id ? "Hide version" : "Preview version"}
        tone="soft"
        disabled={disabled}
        onPress={toggleSelection}
      />
      {selected?.id === version.id && (
        <HistoryVersionPreview
          version={version}
          current={current}
          exists={exists}
          restoresAsCopy={restoresAsCopy}
          disabled={disabled}
          onRestore={restore}
        />
      )}
    </View>
  );
}

function HistoryVersionPreview({
  version,
  current,
  exists,
  restoresAsCopy,
  disabled,
  onRestore,
}: {
  readonly version: HistoryVersion;
  readonly current: Workspace["areas"][number]["cards"][number] | undefined;
  readonly exists: boolean;
  readonly restoresAsCopy: boolean;
  readonly disabled: boolean;
  readonly onRestore: () => void;
}) {
  const label = restoresAsCopy
    ? "Recover as a new card"
    : exists
      ? "Restore this version"
      : "Recover card";
  return (
    <View className="gap-[10px]">
      {current && (
        <View className="gap-[10px]">
          <Text className="text-recall-muted text-[12px] leading-[18px]">Current version</Text>
          <Text>{current.cloze?.text ?? current.front}</Text>
          <Text>{current.back}</Text>
        </View>
      )}
      <Text className="text-recall-muted text-[12px] leading-[18px]">Saved version</Text>
      <Text>{version.card.cloze?.text ?? version.card.front}</Text>
      <Text>{version.card.back}</Text>
      {restoresAsCopy && (
        <Text className="text-recall-muted text-[12px] leading-[18px]">
          Recovery creates a new card with a fresh review schedule. The original review history
          stays saved.
        </Text>
      )}
      <NativeButton label={label} tone="soft" disabled={disabled} onPress={onRestore} />
    </View>
  );
}

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
  const [selection, setSelection] = useState<CardHistorySelection | null>(() => {
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
  const [limit, setLimit] = useState(20);
  const selected = selection;
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
      {versions.slice(0, limit).map((version) => (
        <HistoryVersionRow
          key={version.id}
          workspace={workspace}
          version={version}
          selected={selected}
          disabled={disabled}
          onSelect={setSelection}
          onRestore={onRestore}
        />
      ))}
      {versions.length > limit && (
        <NativeButton
          label="Show more versions"
          tone="soft"
          onPress={() => {
            setLimit(limit + 20);
          }}
        />
      )}
    </View>
  );
}
