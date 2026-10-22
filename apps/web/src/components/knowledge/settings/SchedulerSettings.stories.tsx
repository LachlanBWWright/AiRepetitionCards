import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect } from "effect";
import { applyWorkspaceAuthoringCommand } from "@recall/application";
import { createReviewEventId, type Workspace, type ReviewEvent } from "@recall/domain";
import { mockWorkspace } from "@/features/workspace/mock-data";
import { SchedulerSettings, type SchedulerSettingsSaveFailure } from "./SchedulerSettings";

type Scenario = "saved" | "storage" | "stale-content";
function fittingHistory(): readonly ReviewEvent[] {
  const area = mockWorkspace.areas[0];
  const card = area?.cards[0];
  if (!area || !card) return [];
  return Array.from({ length: 125 }, (_, index): ReviewEvent => ({
    id: createReviewEventId(`fit-${String(index)}`),
    areaId: area.id,
    cardId: card.id,
    ratedAt: new Date(Date.parse("2026-01-01T12:00:00.000Z") + index * 86_400_000).toISOString(),
    baseReviewEventId: index > 0 ? createReviewEventId(`fit-${String(index - 1)}`) : null,
    rating: index % 5 === 0 ? "again" : "good",
    schedulerFamily: "fsrs",
    schedulerVersion: "ts-fsrs@5.4.2",
  }));
}
const failureMessage = (scenario: Scenario) =>
  scenario === "storage"
    ? "Review settings could not be saved on this device. Your draft is still available; try again."
    : "Review settings changed while you were editing. Reload the latest settings before saving.";
function SettingsStory({
  retention = 0.9,
  scenario = "saved",
  personalizationReady = false,
}: {
  readonly retention?: number;
  readonly scenario?: Scenario;
  readonly personalizationReady?: boolean;
}) {
  const [workspace, setWorkspace] = useState<Workspace>(() => ({
    ...mockWorkspace,
    reviewEvents: personalizationReady ? fittingHistory() : (mockWorkspace.reviewEvents ?? []),
    schedulerSettings: { requestRetention: retention },
  }));
  const latest = useRef(
    scenario === "stale-content"
      ? { ...workspace, schedulerSettings: { requestRetention: 0.92 } }
      : workspace,
  );
  const initialDraft =
    scenario === "saved"
      ? undefined
      : {
          retentionPercent: "94.5",
          failure: {
            _tag: "SchedulerSettingsSaveFailure" as const,
            reason: scenario,
            message: failureMessage(scenario),
          },
        };
  return (
    <main style={{ padding: 32, maxWidth: 960, margin: "0 auto", minHeight: "100vh" }}>
      <SchedulerSettings
        workspace={workspace}
        readLatest={() => latest.current}
        {...(initialDraft ? { initialDraft } : {})}
        onSave={(settings, expectedBaseline) => {
          if (scenario !== "saved") {
            if (scenario === "stale-content")
              latest.current = { ...latest.current, schedulerSettings: { requestRetention: 0.92 } };
            return Effect.fail<SchedulerSettingsSaveFailure>({
              _tag: "SchedulerSettingsSaveFailure",
              reason: scenario,
              message: failureMessage(scenario),
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
export const PersonalizationReady: Story = { render: () => <SettingsStory personalizationReady /> };
export const HighRetention: Story = { render: () => <SettingsStory retention={0.97} /> };
export const FractionalRetention: Story = { render: () => <SettingsStory retention={0.905} /> };
export const SaveFailure: Story = {
  render: () => <SettingsStory scenario="storage" />,
};
export const Conflict: Story = {
  render: () => <SettingsStory scenario="stale-content" />,
};
