import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { emptyActivityLibrary, type ActivityLibrary, type LearningActivity } from "@recall/domain";
import { NativeLearningActivitiesPanel } from "../../../mobile/src/components/activities/NativeLearningActivitiesPanel";

const base = {
  areaId: "interactive-native",
  pluginVersion: 1,
  revision: 1,
  objectiveIds: ["reasoning"],
};
const activities: readonly LearningActivity[] = [
  {
    ...base,
    id: "native-ordering",
    pluginId: "recall.ordering",
    title: "Development workflow",
    fallback: "Put plan, implement and verify in order.",
    payload: {
      prompt: "Put these development steps in order.",
      seed: 1,
      items: [
        { id: "plan", text: "Plan" },
        { id: "implement", text: "Implement" },
        { id: "verify", text: "Verify" },
      ],
      explanation: "Plan the change, implement it, and verify the result.",
    },
  },
  {
    ...base,
    id: "native-matching",
    pluginId: "recall.matching",
    title: "Data structures",
    fallback: "A queue is FIFO; a stack is LIFO.",
    payload: {
      prompt: "Match each data structure to its access order.",
      seed: 2,
      pairs: [
        { id: "queue", left: "Queue", right: "First in, first out" },
        { id: "stack", left: "Stack", right: "Last in, first out" },
      ],
      explanation: "Queues process the earliest item first; stacks process the latest item first.",
    },
  },
  {
    ...base,
    id: "native-tracing",
    pluginId: "recall.code-tracing",
    title: "Trace a loop",
    fallback: "Add the integers one through three.",
    payload: {
      prompt: "What does the program print?",
      language: "javascript",
      code: "let total = 0;\nfor (let i = 1; i <= 3; i++) total += i;\nconsole.log(total);",
      expectedOutput: "6",
      explanation: "The loop adds 1 + 2 + 3, giving 6.",
    },
  },
];
const initialLibrary: ActivityLibrary = { ...emptyActivityLibrary, activities };
const meta = {
  title: "Screens/Native Interactive Learning Panel",
  component: NativeLearningActivitiesPanel,
  parameters: { layout: "padded" },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  args: {
    areaId: base.areaId,
    objectives: [{ id: "reasoning", title: "Explain the reasoning" }],
    createId: () => crypto.randomUUID(),
    onSave: () => Promise.resolve(true),
  },
  render: function InteractivePanel(args) {
    const [library, setLibrary] = useState(initialLibrary);
    return (
      <NativeLearningActivitiesPanel
        {...args}
        library={library}
        onSave={(next) => {
          setLibrary(next);
          return Promise.resolve(true);
        }}
      />
    );
  },
} satisfies Meta<typeof NativeLearningActivitiesPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AuthorAndAttempt: Story = {};
export const OrderingAttempt: Story = { args: { initialActivityId: "native-ordering" } };
export const MatchingAttempt: Story = { args: { initialActivityId: "native-matching" } };
export const TracingAttempt: Story = { args: { initialActivityId: "native-tracing" } };
