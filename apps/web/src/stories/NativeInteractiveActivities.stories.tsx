import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ActivityPresentation } from "@recall/application";
import type { ActivityResponse } from "@recall/domain";
import { NativeInteractiveActivityWorkspace } from "../../../mobile/src/components/activities/interactive/NativeInteractiveActivityWorkspace";

const emptyResponse: ActivityResponse = {
  answers: [],
  selectedOptionIds: [],
  selfScore: 0,
  assistance: "none",
};
const meta = {
  title: "Screens/Native Interactive Activities",
  component: NativeInteractiveActivityWorkspace,
  parameters: { layout: "padded" },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  args: {
    response: emptyResponse,
    disabled: false,
    onChange: () => {},
  },
  render: function Interactive(args) {
    const [response, setResponse] = useState(args.response);
    return (
      <NativeInteractiveActivityWorkspace {...args} response={response} onChange={setResponse} />
    );
  },
} satisfies Meta<typeof NativeInteractiveActivityWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;

const common: ActivityPresentation = {
  prompts: ["Place the development steps in order."],
  options: [],
  rubric: "Arrange every item in the correct order.",
  reference: "Plan, implement, then verify.",
  code: false,
};
export const Ordering: Story = {
  args: {
    presentation: {
      ...common,
      interactive: {
        kind: "ordering",
        seed: 1,
        items: [
          { id: "verify", text: "Verify" },
          { id: "plan", text: "Plan" },
          { id: "implement", text: "Implement" },
        ],
      },
    },
  },
};
export const SavedOrderingDraft: Story = {
  args: {
    ...Ordering.args,
    response: { ...emptyResponse, selectedOptionIds: ["verify", "plan"] },
  },
};
export const Matching: Story = {
  args: {
    presentation: {
      ...common,
      prompts: ["Match each data structure to its access order."],
      interactive: {
        kind: "matching",
        seed: 1,
        left: [
          { id: "queue", text: "Queue" },
          { id: "stack", text: "Stack" },
        ],
        right: [
          { id: "stack", text: "Last in, first out" },
          { id: "queue", text: "First in, first out" },
        ],
      },
    },
  },
};
export const CodeTracing: Story = {
  args: {
    presentation: {
      ...common,
      prompts: ["What does this program print?"],
      interactive: {
        kind: "code-tracing",
        language: "javascript",
        code: "let total = 0;\nfor (let i = 1; i <= 3; i++) total += i;\nconsole.log(total);",
      },
    },
    response: { ...emptyResponse, answers: [""] },
  },
};
export const LockedMatching: Story = {
  args: {
    ...Matching.args,
    disabled: true,
    response: { ...emptyResponse, answers: ['{"queue":"queue","stack":"stack"}'] },
  },
};
