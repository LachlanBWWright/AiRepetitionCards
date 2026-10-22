import type { MediaTrashPurgeResult } from "@recall/application";
import { NativeSelect } from "@recall/ui-native";
import { NativeCardBrowser } from "./NativeCardBrowser";
import type { WorkspaceStore, MediaStore } from "@recall/local-store";
import { NativeCollectionMaintenance } from "./NativeCollectionMaintenance";
import { NativeStudySyncConflict } from "./NativeStudySyncConflict";
import { undoableReview } from "@recall/application";
import * as Crypto from "expo-crypto";
import { useState } from "react";
import { Text, View } from "react-native";
import type { LearningArea, Workspace, MediaReference } from "@recall/domain";
import { NativeButton } from "../ui/NativeButton";
import { NativeStudyStatistics } from "./NativeStudyStatistics";
import { NativeManualScheduling } from "./NativeManualScheduling";
import {
  useNativeStudyCommand,
  type NativeStudyCommand,
} from "../../hooks/use-native-study-command";
export function NativeAdditionalStudyTools({
  workspace,
  area,
  now,
  save,
  disabled,
  mediaStore,
  protectedReferences,
  onInteractionChange,
  workspaceStore,
  onPurged,
}: {
  readonly protectedReferences?: readonly MediaReference[] | undefined;
  readonly onInteractionChange?: ((active: boolean) => void) | undefined;
  readonly workspaceStore?: WorkspaceStore | undefined;
  readonly onPurged?: ((result: MediaTrashPurgeResult) => void) | undefined;
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly now: number;
  readonly save?: NativeStudyCommand | undefined;
  readonly disabled: boolean;
  readonly mediaStore?: MediaStore | undefined;
}) {
  const [mode, setMode] = useState<"none" | "manage" | "statistics">("none");
  const [section, setSection] = useState("browse");
  const controls = useNativeStudyCommand(workspace, save);
  const undo = undoableReview(workspace);
  return (
    <View className="gap-3 py-3">
      <NativeStudySyncConflict workspace={workspace} save={save} />
      <View className="flex-row flex-wrap gap-2">
        <NativeButton
          label="Undo last review"
          tone="soft"
          disabled={disabled || controls.busy || !save || !undo}
          onPress={() => {
            if (undo)
              controls.commit({
                kind: "undo-review",
                eventId: undo.id,
                operationId: Crypto.randomUUID(),
              });
          }}
        />
        <NativeButton
          label={mode === "manage" ? "Close scheduling tools" : "Manage scheduling"}
          tone="soft"
          disabled={disabled}
          onPress={() => {
            const next = mode === "manage" ? "none" : "manage";
            setMode(next);
            onInteractionChange?.(next !== "none");
          }}
        />
        <NativeButton
          label={mode === "statistics" ? "Close statistics" : "Study statistics"}
          tone="soft"
          disabled={disabled}
          onPress={() => {
            const next = mode === "statistics" ? "none" : "statistics";
            setMode(next);
            onInteractionChange?.(next !== "none");
          }}
        />
      </View>
      {workspace.schedulerSettings?.activeStudyQuery && (
        <View className="gap-2">
          <Text>Scheduled review filter: {workspace.schedulerSettings.activeStudyQuery}</Text>
          <NativeButton
            label="Show all scheduled reviews"
            tone="soft"
            disabled={disabled || controls.busy || !save}
            onPress={() => {
              const settings = { ...(workspace.schedulerSettings ?? { requestRetention: 0.9 }) };
              delete settings.activeStudyQuery;
              controls.commit({ kind: "update-scheduler-settings", settings });
            }}
          />
        </View>
      )}
      {controls.message ? <Text>{controls.message}</Text> : null}
      {mode === "manage" && (
        <>
          <NativeSelect
            label="Study management"
            value={section}
            options={[
              { value: "browse", label: "Browse cards" },
              { value: "schedule", label: "Schedule" },
              { value: "files", label: "Files" },
            ]}
            onValueChange={setSection}
          />
          {section === "browse" && (
            <NativeCardBrowser workspace={workspace} area={area} now={now} save={save} />
          )}
          {section === "schedule" && (
            <NativeManualScheduling workspace={workspace} area={area} now={now} save={save} />
          )}
          {section === "files" && (
            <NativeCollectionMaintenance
              workspaceStore={workspaceStore}
              onPurged={onPurged}
              protectedReferences={protectedReferences}
              workspace={workspace}
              media={mediaStore}
              save={save}
            />
          )}
        </>
      )}
      {mode === "statistics" && (
        <NativeStudyStatistics workspace={workspace} now={now} areaId={area.id} />
      )}
    </View>
  );
}
