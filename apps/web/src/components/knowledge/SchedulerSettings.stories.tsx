import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect } from "effect";
import { applyWorkspaceAuthoringCommand } from "@recall/application";
import type { Workspace } from "@recall/domain";
import { mockWorkspace } from "@/features/workspace/mock-data";
import { SchedulerSettings, type SchedulerSettingsSaveFailure } from "./SchedulerSettings";

type Scenario = "saved" | "storage" | "stale-content";
function SettingsStory({
  retention = 0.9,
  scenario = "saved",
}: {
  readonly retention?: number;
  readonly scenario?: Scenario;
}) {
  const [workspace, setWorkspace] = useState<Workspace>(() => ({
    ...mockWorkspace,
    schedulerSettings: { requestRetention: retention },
  }));
  const latest = useRef(
    scenario === "stale-content"
      ? { ...workspace, schedulerSettings: { requestRetention: 0.92 } }
      : workspace,
  );
  return (
    <main style={{ padding: 32, maxWidth: 960, margin: "0 auto", minHeight: "100vh" }}>
      <SchedulerSettings
        workspace={workspace}
        readLatest={() => latest.current}
        {...(scenario === "saved"
          ? {}
          : {
              initialDraft: {
                retentionPercent: "94.5",
                failure: {
                  _tag: "SchedulerSettingsSaveFailure",
                  reason: scenario,
                  message:
                    scenario === "storage"
                      ? "Review settings could not be saved on this device. Your draft is still available; try again."
                      : "Review settings changed while you were editing. Reload the latest settings before saving.",
                },
              },
            })}
        onSave={(settings, expectedBaseline) => {
          if (scenario !== "saved") {
            if (scenario === "stale-content")
              latest.current = { ...latest.current, schedulerSettings: { requestRetention: 0.92 } };
            return Effect.fail<SchedulerSettingsSaveFailure>({
              _tag: "SchedulerSettingsSaveFailure",
              reason: scenario,
              message:
                scenario === "storage"
                  ? "Review settings could not be saved on this device. Your draft is still available; try again."
                  : "Review settings changed while you were editing. Reload the latest settings before saving.",
            });
          }
          return applyWorkspaceAuthoringCommand(
            latest.current,
            { kind: "update-scheduler-settings", settings },
            new Date("2026-10-01T12:00:00.000Z"),
            expectedBaseline,
          ).pipe(
            Effect.mapError((failure): SchedulerSettingsSaveFailure => ({
              _tag: "SchedulerSettingsSaveFailure",
              reason: "stale-content",
              message: failure.message,
            })),
            Effect.map(({ workspace: saved }) => {
              latest.current = saved;
              setWorkspace(saved);
              return saved;
            }),
          );
        }}
      />
    </main>
  );
}

const meta = {
  title: "Knowledge/Review settings",
  component: SettingsStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SettingsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const DefaultRetention: Story = { render: () => <SettingsStory /> };
export const HighRetention: Story = { render: () => <SettingsStory retention={0.97} /> };
export const FractionalRetention: Story = { render: () => <SettingsStory retention={0.905} /> };
export const SaveFailure: Story = {
  render: () => <SettingsStory scenario="storage" />,
};
export const Conflict: Story = {
  render: () => <SettingsStory scenario="stale-content" />,
};
