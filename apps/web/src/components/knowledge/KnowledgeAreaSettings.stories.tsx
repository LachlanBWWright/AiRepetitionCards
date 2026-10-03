import { useState } from "react";
import { Effect } from "effect";
import { applyWorkspaceAuthoringCommand } from "@recall/application";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { createObjectiveId, type LearningArea } from "@recall/domain";
import { mockWorkspace } from "@/features/workspace/mock-data";
import { KnowledgeAreaSettings, type AreaSettingsSaveFailure } from "./KnowledgeAreaSettings";

const cellStructuresId = createObjectiveId("story-objective-cell-structures");
const respirationId = createObjectiveId("story-objective-respiration");
const populatedArea: LearningArea = {
  ...mockWorkspace.areas[0]!,
  description:
    "Understand how cell structures work together to sustain life, from organelles to energy transfer.",
  language: "en",
  tags: ["biology", "cells", "exam revision"],
  licence: "CC BY 4.0",
  attribution: "Adapted from OpenStax Biology 2e, Chapter 4.",
  ai: {
    tutorInstructions:
      "Explain with everyday analogies. Ask one question at a time and let me reason through it before revealing the answer.",
    quizInstructions:
      "Mix short recall questions with application questions. Focus on misconceptions about organelle functions.",
    cardGenerationInstructions:
      "Keep each card focused on a single idea. Use precise terminology and avoid yes/no questions.",
  },
  objectives: [
    {
      id: cellStructuresId,
      title: "Identify cell structures",
      description: "Recognize the major organelles and describe their roles.",
      prerequisiteIds: [],
    },
    {
      id: respirationId,
      title: "Explain cellular respiration",
      description: "Connect mitochondrial structure to the production of ATP.",
      prerequisiteIds: [cellStructuresId],
    },
  ],
  cards: mockWorkspace.areas[0]!.cards.map((card) => ({
    ...card,
    objectiveIds: [cellStructuresId],
  })),
};
const minimalArea: LearningArea = { ...mockWorkspace.areas[1]!, objectives: [] };
function SettingsStory({
  empty = false,
  narrow = false,
  importedTags = false,
  failure,
}: {
  readonly empty?: boolean;
  readonly narrow?: boolean;
  readonly importedTags?: boolean;
  readonly failure?: "stale-content" | "storage";
}) {
  const [draftArea] = useState<LearningArea>(() =>
    importedTags
      ? {
          ...populatedArea,
          tags: [
            "cells, tissues",
            'say "ATP"',
            "  source label  ",
            "source\ncategory",
            "imported:" + "x".repeat(90),
          ],
        }
      : empty
        ? minimalArea
        : populatedArea,
  );
  const [area, setArea] = useState<LearningArea>(() =>
    failure === "stale-content"
      ? { ...draftArea, description: "Latest synchronized description from another session." }
      : draftArea,
  );
  const failureValue: AreaSettingsSaveFailure | null = failure
    ? {
        _tag: "AreaSettingsSaveFailure",
        reason: failure,
        message:
          failure === "stale-content"
            ? "This content changed while you were editing. Your draft is preserved. Reload the latest settings before saving."
            : "These settings could not be saved on this device. Your draft is preserved; restore local storage before retrying.",
      }
    : null;
  const [created, setCreated] = useState(0);
  return (
    <main
      style={{
        padding: narrow ? 16 : 32,
        maxWidth: narrow ? 440 : 1100,
        margin: "0 auto",
        minHeight: "100vh",
      }}
    >
      <KnowledgeAreaSettings
        area={area}
        readLatest={() => area}
        {...(failureValue ? { initialDraftArea: draftArea, initialSaveFailure: failureValue } : {})}
        onSave={(settings, expectedBaseline) => {
          if (failure === "storage" && failureValue) return Effect.fail(failureValue);
          return applyWorkspaceAuthoringCommand(
            { schemaVersion: 1, reviews: 0, reviewEvents: [], areas: [area] },
            { kind: "update-area-settings", areaId: area.id, settings },
            new Date("2026-10-03T09:00:00.000Z"),
            expectedBaseline,
          ).pipe(
            Effect.mapError((error): AreaSettingsSaveFailure => ({
              _tag: "AreaSettingsSaveFailure",
              reason: error.reason === "stale-content" ? "stale-content" : "unavailable",
              message: error.message,
            })),
            Effect.flatMap((saved) => {
              const updated = saved.workspace.areas.find((item) => item.id === area.id);
              return updated
                ? Effect.succeed(updated)
                : Effect.fail({
                    _tag: "AreaSettingsSaveFailure",
                    reason: "unavailable",
                    message: "This knowledge area is no longer available.",
                  } as const);
            }),
            Effect.tap((updated) => Effect.sync(() => setArea(updated))),
          );
        }}
        createId={() => {
          const id = `story-created-objective-${created + 1}`;
          setCreated((value) => value + 1);
          return id;
        }}
      />
    </main>
  );
}
const meta = {
  title: "Knowledge/Area settings",
  component: SettingsStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SettingsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Complete: Story = { render: () => <SettingsStory /> };
export const NewArea: Story = { render: () => <SettingsStory empty /> };
export const NarrowLayout: Story = { render: () => <SettingsStory narrow /> };
export const ImportedTags: Story = { render: () => <SettingsStory importedTags /> };

export const Conflict: Story = { render: () => <SettingsStory failure="stale-content" /> };
export const SaveFailure: Story = { render: () => <SettingsStory failure="storage" /> };
