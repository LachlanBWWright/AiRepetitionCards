import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Effect, Either } from "effect";
import type { Workspace } from "@recall/domain";
import { applyWorkspaceAuthoringCommand, workspaceAuthoringBaseline } from "@recall/application";
import { NativeTextField } from "@recall/ui-native";
import { NativeSchedulerEditor } from "../../../../../mobile/src/components/authoring/settings/NativeSchedulerEditor";
import type { Editor } from "../../../../../mobile/src/components/authoring/NativeWorkspaceAuthoringPanel.types";
import { mockWorkspace } from "@/features/workspace/mock-data";
function NativeSettingsStory() {
  const [workspace, setWorkspace] = useState<Workspace>(mockWorkspace);
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<Editor | null>(() => ({
    kind: "scheduler",
    retentionPercent: "90",
    dailyNewLimit: "20",
    leechThreshold: "8",
    settings: { requestRetention: 0.9 },
    baseline:
      workspaceAuthoringBaseline(mockWorkspace, {
        kind: "update-scheduler-settings",
        settings: { requestRetention: 0.9 },
      }) ?? "",
  }));
  if (editor?.kind !== "scheduler") return null;
  return (
    <main className="mx-auto max-w-2xl p-6">
      <NativeSchedulerEditor
        editor={editor}
        workspace={workspace}
        locked={false}
        pending={false}
        field={(label, value, change, multiline = false, maxLength = 500) => (
          <NativeTextField
            key={label}
            label={label}
            value={value}
            onChangeText={change}
            multiline={multiline}
            maxLength={maxLength}
          />
        )}
        setEditor={setEditor}
        setMessage={setMessage}
        submit={(command, baseline) => {
          const saved = Effect.runSync(
            Effect.either(
              applyWorkspaceAuthoringCommand(
                workspace,
                command,
                new Date("2026-10-19T12:00:00Z"),
                baseline,
              ),
            ),
          );
          if (Either.isLeft(saved)) setMessage(saved.left.message);
          else {
            setWorkspace(saved.right.workspace);
            setMessage(saved.right.message);
          }
        }}
      />
      <p role="status">{message}</p>
    </main>
  );
}
const meta = {
  title: "Knowledge/Native review settings",
  component: NativeSettingsStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NativeSettingsStory>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
