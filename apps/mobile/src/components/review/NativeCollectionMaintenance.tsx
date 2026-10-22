import type { MediaTrashPurgeResult } from "@recall/application";
import { NativeCollectionRecovery } from "./NativeCollectionRecovery";
import { useCollectionHealth, adaptStudyCommandSave } from "@recall/react";
import type { Workspace, MediaReference } from "@recall/domain";
import type { MediaStore, WorkspaceStore } from "@recall/local-store";
import { Text, View } from "react-native";
import { NativeButton } from "../ui/NativeButton";
import type { NativeStudyCommand } from "../../hooks/use-native-study-command";
export function NativeCollectionMaintenance({
  workspace,
  media,
  save,
  protectedReferences,
  workspaceStore,
  onPurged,
}: {
  readonly workspaceStore?: WorkspaceStore | undefined;
  readonly onPurged?: ((result: MediaTrashPurgeResult) => void) | undefined;
  readonly protectedReferences?: readonly MediaReference[] | undefined;
  readonly workspace: Workspace;
  readonly media?: MediaStore | undefined;
  readonly save?: NativeStudyCommand | undefined;
}) {
  const health = useCollectionHealth(
    workspace,
    media,
    save ? adaptStudyCommandSave(save) : undefined,
    protectedReferences,
  );
  return (
    <View className="gap-3 border-t py-4">
      <Text className="font-bold">Collection maintenance</Text>
      <Text>
        Check attachments, shared notes, cloze sources and empty cards. Media in historical versions
        and retained deletions is protected.
      </Text>
      <NativeButton
        label={health.busy ? "Checking collection…" : "Check collection and media"}
        disabled={health.busy || !health.available}
        onPress={health.scan}
      />
      {health.report && (
        <>
          <Text>
            {health.report.checkedAssets} files checked · {health.report.missing.length} missing ·{" "}
            {health.report.corrupt.length} corrupt · {health.report.unused.length} unused ·{" "}
            {health.report.issues.length} card issues.
          </Text>
          <NativeButton
            tone="soft"
            label="Move unused files to recoverable trash"
            disabled={!save || !health.report.unused.length || health.controls.busy}
            onPress={() => {
              health.act("trash");
            }}
          />
          <NativeButton
            tone="soft"
            label="Tag cards with missing media"
            disabled={!save || !health.report.missing.length || health.controls.busy}
            onPress={() => {
              health.act("tag-missing");
            }}
          />
          {health.report.issues.map((issue, index) => (
            <Text key={`${issue.cardId}:${String(index)}`}>
              {issue.cardId}: {issue.message}
            </Text>
          ))}
          {health.report.missing.map((reference) => (
            <Text key={reference.id}>
              Missing {reference.mimeType}: {reference.id}
            </Text>
          ))}
          {health.report.corrupt.map((reference) => (
            <Text key={`corrupt:${reference.id}`}>
              Corrupt {reference.mimeType}: {reference.id}
            </Text>
          ))}
        </>
      )}
      <Text>
        {health.trashCount} files in recoverable trash. Bytes stay on this device; this does not
        reclaim storage.
      </Text>
      <NativeButton
        label="Restore files from trash"
        tone="soft"
        disabled={!save || !health.trashCount || health.controls.busy}
        onPress={() => {
          health.act("restore");
        }}
      />
      <NativeCollectionRecovery
        workspace={workspace}
        store={workspaceStore}
        save={save ? adaptStudyCommandSave(save) : undefined}
        protectedReferences={protectedReferences}
        onPurged={onPurged}
      />
      {health.controls.message || health.message ? (
        <Text accessibilityLiveRegion="polite">{health.controls.message || health.message}</Text>
      ) : null}
    </View>
  );
}
