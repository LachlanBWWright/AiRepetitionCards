import { NativeReviewerSettings } from "./NativeReviewerSettings";
import { NativeTodayStudyLimits } from "./NativeTodayStudyLimits";
import { NativeStudyPolicyFields } from "./NativeStudyPolicyFields";
import { schedulerSettingsDraft } from "@recall/application";
import { Text, View } from "react-native";
import { Either, Schema } from "effect";
import { SchedulerSettingsSchema } from "@recall/domain";
import { NativeButton } from "../../ui/NativeButton";
import type { Editor } from "../NativeWorkspaceAuthoringPanel.types";
import type { EditorActions } from "./NativeWorkspaceSimpleEditors";
import { NativeParameterFitting } from "./NativeParameterFitting";
import { NativeStudyCardSettings } from "./NativeStudyCardSettings";
import { NativeAdvancedScheduling } from "./NativeAdvancedScheduling";
import { NativeStudyPresets } from "./NativeStudyPresets";

export function NativeSchedulerEditor({
  editor,
  workspace,
  locked,
  pending,
  field,
  setEditor,
  setMessage,
  submit,
}: EditorActions & { readonly editor: Extract<Editor, { readonly kind: "scheduler" }> }) {
  const settings = schedulerSettingsDraft(editor.settings, {
    retentionPercent: editor.retentionPercent,
    dailyNewLimit: editor.dailyNewLimit,
    leechThreshold: editor.leechThreshold,
  });
  return (
    <View className="gap-3 border-t border-recall-line py-4">
      <Text className="text-lg font-bold text-recall-ink">Review settings</Text>
      <Text className="text-sm text-recall-muted">
        Higher retention means more reviews. Start at 90%. New-card limits apply across all
        subjects. Learning steps come first; limits defer returning cards while retaining backlog
        counts.
      </Text>
      {field(
        "Target retention (%) · 70 to 97",
        editor.retentionPercent,
        (retentionPercent) => {
          setEditor({ ...editor, retentionPercent });
        },
        false,
        20,
      )}
      <NativeStudyPolicyFields
        policy={settings}
        disabled={locked}
        onChange={(next) => {
          setEditor({
            ...editor,
            settings: next,
            dailyNewLimit: String(next.dailyNewLimit ?? 20),
            leechThreshold: String(next.leechThreshold ?? 8),
          });
        }}
      />
      <NativeReviewerSettings
        settings={settings}
        disabled={locked}
        onChange={(next) => {
          setEditor({ ...editor, settings: next });
        }}
      />
      <NativeTodayStudyLimits
        settings={settings}
        disabled={locked}
        onChange={(next) => {
          setEditor({ ...editor, settings: next });
        }}
      />
      {workspace && (
        <NativeParameterFitting
          workspace={workspace}
          settings={settings}
          disabled={locked}
          onChange={(next) => {
            setEditor({ ...editor, settings: next });
          }}
        />
      )}
      <NativeAdvancedScheduling
        policy={settings}
        disabled={locked}
        onChange={(policy) => {
          setEditor({ ...editor, settings: { ...settings, ...policy } });
        }}
      />
      {workspace && (
        <NativeStudyPresets
          workspace={workspace}
          settings={settings}
          disabled={locked}
          onChange={(next) => {
            setEditor({ ...editor, settings: next });
          }}
        />
      )}
      {workspace && (
        <NativeStudyCardSettings
          workspace={workspace}
          settings={settings}
          disabled={locked}
          onChange={(next) => {
            setEditor({ ...editor, settings: next });
          }}
        />
      )}
      <NativeButton
        label={pending ? "Saving…" : "Save review settings"}
        disabled={locked}
        onPress={() => {
          const decoded = Schema.decodeUnknownEither(SchedulerSettingsSchema)(settings);
          if (Either.isLeft(decoded)) {
            setMessage(
              "Check retention (70–97%), daily new cards (0–1000), and leech threshold (2–100).",
            );
            return;
          }
          submit({ kind: "update-scheduler-settings", settings: decoded.right }, editor.baseline);
        }}
      />
      <Text className="text-sm text-recall-muted">
        Save to apply these changes. Settings stay private and are included in workspace backups. A
        study day follows this device’s local calendar.
      </Text>
    </View>
  );
}
