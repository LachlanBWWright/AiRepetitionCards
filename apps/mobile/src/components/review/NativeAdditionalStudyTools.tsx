import type { MediaTrashPurgeResult } from "@recall/application";
import {
  NativeCollapsibleContent,
  NativeCollapsibleTrigger,
  NativeSelect,
} from "@recall/ui-native";
import { NativeCardBrowser } from "./NativeCardBrowser";
import { NativeManualBurialControls } from "./NativeManualBurialControls";
import type { WorkspaceStore, MediaStore } from "@recall/local-store";
import { NativeCollectionMaintenance } from "./NativeCollectionMaintenance";
import { NativeStudySyncConflict } from "./NativeStudySyncConflict";
import { undoableReview } from "@recall/application";
import * as Crypto from "expo-crypto";
import { useEffect, useState } from "react";
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
  card,
  area,
  now,
  save,
  disabled,
  mediaStore,
  protectedReferences,
  onInteractionChange,
  workspaceStore,
  onPurged,
  onSuspend,
  onPractice,
}: {
  readonly protectedReferences?: readonly MediaReference[] | undefined;
  readonly onInteractionChange?: ((active: boolean) => void) | undefined;
  readonly workspaceStore?: WorkspaceStore | undefined;
  readonly onPurged?: ((result: MediaTrashPurgeResult) => void) | undefined;
  readonly workspace: Workspace;
  readonly card?: import("@recall/domain").Assessment | undefined;
  readonly area: LearningArea;
  readonly now: number;
  readonly save?: NativeStudyCommand | undefined;
  readonly disabled: boolean;
  readonly mediaStore?: MediaStore | undefined;
  readonly onSuspend?: (() => void) | undefined;
  readonly onPractice?: (() => void) | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    onInteractionChange?.(expanded);
    return () => onInteractionChange?.(false);
  }, [expanded, onInteractionChange]);
  const [mode, setMode] = useState<"none" | "manage" | "statistics">("none");
  const [section, setSection] = useState("browse");
  const controls = useNativeStudyCommand(workspace, save);
  const undo = undoableReview(workspace);
  return (
    <View className="gap-3 py-3">
      <NativeStudySyncConflict workspace={workspace} save={save} />
      <View className="flex-row items-center gap-2">
        <NativeButton
          className="flex-1"
          label="Undo last review"
          variant="secondary"
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
        <View className="flex-1">
          <NativeCollapsibleTrigger
            title="Study tools"
            open={expanded}
            disabled={disabled}
            onToggle={() => {
              setExpanded(!expanded);
            }}
          />
        </View>
      </View>
      {controls.message ? (
        <Text className="text-sm text-recall-muted" accessibilityLiveRegion="polite">
          {controls.message}
        </Text>
      ) : null}
      {workspace.schedulerSettings?.activeStudyQuery && (
        <View className="gap-2">
          <Text className="text-sm text-recall-muted">
            Scheduled review filter: {workspace.schedulerSettings.activeStudyQuery}
          </Text>
          <NativeButton
            label="Show all scheduled reviews"
            variant="default"
            disabled={disabled || controls.busy || !save}
            onPress={() => {
              const settings = { ...(workspace.schedulerSettings ?? { requestRetention: 0.9 }) };
              delete settings.activeStudyQuery;
              controls.commit({ kind: "update-scheduler-settings", settings });
            }}
          />
        </View>
      )}
      <NativeCollapsibleContent open={expanded}>
        <NativeManualBurialControls
          now={now}
          workspace={workspace}
          card={card}
          disabled={disabled || controls.busy || !save}
          onBury={controls.bury}
          onUnbury={controls.unbury}
        />
        {card && onSuspend && (
          <NativeButton
            variant="secondary"
            label="Suspend this card"
            disabled={disabled}
            onPress={onSuspend}
          />
        )}
        {onPractice && (
          <NativeButton
            variant="secondary"
            label="Extra practice"
            disabled={disabled || area.cards.length === 0}
            onPress={onPractice}
          />
        )}
        <View className="gap-2">
          <NativeCollapsibleTrigger
            open={mode === "manage"}
            title="Manage scheduling"
            disabled={disabled}
            onToggle={() => {
              const next = mode === "manage" ? "none" : "manage";
              setMode(next);
            }}
          />
          <NativeCollapsibleTrigger
            open={mode === "statistics"}
            title="Study statistics"
            disabled={disabled}
            onToggle={() => {
              const next = mode === "statistics" ? "none" : "statistics";
              setMode(next);
            }}
          />
        </View>
        <NativeCollapsibleContent open={mode === "manage"}>
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
        </NativeCollapsibleContent>
        <NativeCollapsibleContent open={mode === "statistics"}>
          <NativeStudyStatistics workspace={workspace} now={now} areaId={area.id} />
        </NativeCollapsibleContent>
      </NativeCollapsibleContent>
    </View>
  );
}
