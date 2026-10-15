import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect, Schema } from "effect";
import { builtinActivityRegistry, type ActivityPlugin } from "@recall/application";
import { Checkbox, Input, Label } from "@recall/ui-web";
import { emptyActivityLibrary, type ActivityLibrary } from "@recall/domain";
import { LearningActivitiesPanel } from "../components/knowledge/LearningActivitiesPanel";
import { NativeLearningActivitiesPanel } from "../../../mobile/src/components/NativeLearningActivitiesPanel";
import { mockWorkspace } from "../features/workspace/mock-data";
const area = mockWorkspace.areas[0];
const meta = {
  title: "Screens/Learning Activities",
  component: LearningActivitiesPanel,
  parameters: { layout: "padded" },
  args: {
    areaId: area?.id ?? "demo-deck",
    cards: area?.cards ?? [],
    objectives: area?.objectives ?? [],
    createId: () => crypto.randomUUID(),
    onSave: async () => true,
  },
} satisfies Meta<typeof LearningActivitiesPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Web: Story = {
  render: function Web(args) {
    const [library, setLibrary] = useState(emptyActivityLibrary);
    return (
      <LearningActivitiesPanel
        {...args}
        library={library}
        onSave={async (next) => {
          setLibrary(next);
          return true;
        }}
      />
    );
  },
};
export const Native: Story = {
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  render: function Native(args) {
    const [library, setLibrary] = useState(emptyActivityLibrary);
    return (
      <NativeLearningActivitiesPanel
        {...args}
        library={library}
        onSave={async (next) => {
          setLibrary(next);
          return true;
        }}
      />
    );
  },
};

export const SaveRecovery: Story = {
  render: function SaveRecovery(args) {
    const [library, setLibrary] = useState(emptyActivityLibrary);
    const [failSaving, setFailSaving] = useState(true);
    return (
      <div className="grid gap-4">
        <Label className="flex items-center gap-2">
          <Checkbox
            checked={failSaving}
            onCheckedChange={(checked) => setFailSaving(checked === true)}
          />
          Simulate unavailable storage
        </Label>
        <LearningActivitiesPanel
          {...args}
          library={library}
          onSave={async (next) => {
            if (failSaving) return false;
            setLibrary(next);
            return true;
          }}
        />
      </div>
    );
  },
};

const estimatePayload = Schema.Struct({
  prompt: Schema.String.pipe(Schema.minLength(1)),
  target: Schema.Number.pipe(Schema.int(), Schema.between(0, 100)),
});
const readEstimate = (payload: unknown) =>
  Schema.decodeUnknown(estimatePayload)(payload).pipe(
    Effect.mapError(() => ({
      _tag: "ActivityFailure" as const,
      reason: "invalid-input" as const,
      message: "An estimate needs a prompt and a target from 0 to 100.",
    })),
  );
const estimatePlugin: ActivityPlugin = {
  id: "example.estimate",
  version: 1,
  label: "Estimate a value (custom plugin)",
  capabilities: {
    offline: true,
    execution: false,
    assessment: "deterministic",
    platforms: ["web"],
  },
  present: (payload) =>
    readEstimate(payload).pipe(
      Effect.map((value) => ({
        prompts: [value.prompt],
        options: [],
        rubric: "Estimate the target percentage.",
        reference: String(value.target),
        code: false,
      })),
    ),
  assess: (activity, response) =>
    readEstimate(activity.payload).pipe(
      Effect.flatMap((value) => {
        if (!response.answers[0]?.trim())
          return Effect.fail({
            _tag: "ActivityFailure" as const,
            reason: "invalid-input" as const,
            message: "Move the slider to choose an estimate before checking.",
          });
        const estimate = Number(response.answers[0]);
        const score = Number.isFinite(estimate)
          ? Math.max(0, 1 - Math.abs(estimate - value.target) / 100)
          : 0;
        return Effect.succeed({
          evaluatorId: "example.estimate",
          evaluatorVersion: "1",
          feedback: `Target: ${value.target}%. Your estimate: ${estimate}%.`,
          evidence: activity.objectiveIds.map((objectiveId) => ({
            objectiveId,
            dimension: "application",
            score,
            confidence: 1,
            assistance: response.assistance,
            assessment: "deterministic",
            explanation: "Distance from the approved target, on a 100 point scale.",
          })),
        });
      }),
    ),
};
export const CustomPlugin: Story = {
  render: function CustomPlugin(args) {
    const [library, setLibrary] = useState<ActivityLibrary>({
      ...emptyActivityLibrary,
      activities: [
        {
          id: "custom-estimate",
          areaId: args.areaId,
          title: "Estimate the proportion",
          pluginId: estimatePlugin.id,
          pluginVersion: 1,
          revision: 1,
          objectiveIds: [args.objectives[0]?.id ?? "estimate-objective"],
          fallback: "Estimate what percentage of an hour is 15 minutes.",
          payload: { prompt: "What percentage of an hour is 15 minutes?", target: 25 },
        },
      ],
    });
    return (
      <LearningActivitiesPanel
        {...args}
        library={library}
        registry={[...builtinActivityRegistry, estimatePlugin]}
        onSave={async (next) => {
          setLibrary(next);
          return true;
        }}
        renderInteraction={({ activity, response, disabled, onChange }) =>
          activity.pluginId !== estimatePlugin.id ? null : (
            <div className="grid gap-2">
              <Label htmlFor="custom-estimate-response">{String(activity.payload.prompt)}</Label>
              <Input
                id="custom-estimate-response"
                type="range"
                min={0}
                max={100}
                disabled={disabled}
                value={response.answers[0] || "50"}
                onChange={(event) => onChange({ ...response, answers: [event.target.value] })}
              />
              <p>{response.answers[0] || "50"}%</p>
            </div>
          )
        }
      />
    );
  },
};
