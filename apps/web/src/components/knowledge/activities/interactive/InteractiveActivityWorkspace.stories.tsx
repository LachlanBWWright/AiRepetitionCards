import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ActivityPresentation } from "@recall/application";
import type { ActivityResponse } from "@recall/domain";
import { InteractiveActivityWorkspace } from "./InteractiveActivityWorkspace";
import { ActivityAuthoringFields } from "./ActivityAuthoringFields";

const empty: ActivityResponse = {
  answers: [],
  selectedOptionIds: [],
  selfScore: 0,
  assistance: "none",
};
const ordering: ActivityPresentation = {
  prompts: ["Arrange the steps to solve $2x + 4 = 10$."],
  options: [],
  rubric: "Order the steps.",
  reference: "",
  code: false,
  interactive: {
    kind: "ordering",
    seed: 1,
    items: [
      { id: "divide", text: "Divide both sides by **2**." },
      { id: "answer", text: "Conclude $x = 3$." },
      { id: "subtract", text: "Subtract **4** from both sides." },
    ],
  },
};
const matching: ActivityPresentation = {
  prompts: ["Match each data structure to its behavior."],
  options: [],
  rubric: "Match each pair.",
  reference: "",
  code: false,
  interactive: {
    kind: "matching",
    seed: 1,
    left: [
      { id: "queue", text: "`Queue<T>`" },
      { id: "stack", text: "`Stack<T>`" },
      { id: "set", text: "`Set<T>`" },
    ],
    right: [
      { id: "set", text: "Unique values" },
      { id: "queue", text: "First in, first out" },
      { id: "stack", text: "Last in, first out" },
    ],
  },
};
const tracing: ActivityPresentation = {
  prompts: ["Predict each line printed by this program. Track `total` after each iteration."],
  options: [],
  rubric: "Predict the output.",
  reference: "",
  code: false,
  interactive: {
    kind: "code-tracing",
    language: "javascript",
    code: "let total = 0;\nfor (const value of [2, 3, 5]) {\n  total += value;\n  console.log(total);\n}",
  },
};
const meta = {
  title: "Learning Activities/Interactive Games",
  component: InteractiveActivityWorkspace,
  parameters: { layout: "padded" },
  args: { presentation: ordering, response: empty, disabled: false, onChange: () => undefined },
  render: function Interactive(args) {
    const [response, setResponse] = useState(args.response);
    return (
      <div className="mx-auto max-w-3xl">
        <InteractiveActivityWorkspace {...args} response={response} onChange={setResponse} />
      </div>
    );
  },
} satisfies Meta<typeof InteractiveActivityWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ordering: Story = {};
export const Matching: Story = { args: { presentation: matching } };
export const CodeTracing: Story = { args: { presentation: tracing } };
export const ResumedOrdering: Story = {
  args: {
    response: {
      ...empty,
      selectedOptionIds: ["subtract", "divide", "answer"],
      interaction: { seed: 1, retries: 1, firstTry: false },
    },
  },
};
export const ResumedMatching: Story = {
  args: { presentation: matching, response: { ...empty, answers: ['{"queue":"stack"}'] } },
};
export const DisabledResult: Story = {
  args: { presentation: tracing, disabled: true, response: { ...empty, answers: ["2\n5\n10"] } },
};
export const OrderingAuthoring: Story = {
  render: function Authoring() {
    const [fields, setFields] = useState<Readonly<Record<string, string>>>({
      prompt: "Order the steps for $x^2$.",
      items: "Read input\nCalculate square\nReturn result",
      reference: "Read before calculating and returning.",
      seed: "1",
    });
    return (
      <ActivityAuthoringFields
        pluginId="recall.ordering"
        fields={[
          { key: "prompt", label: "Prompt", initial: "", multiline: true },
          {
            key: "items",
            label: "Items in correct order (one per line)",
            initial: "",
            multiline: true,
          },
          { key: "seed", label: "Shuffle seed", initial: "1", multiline: false },
          { key: "reference", label: "Explanation", initial: "", multiline: true },
        ]}
        value={(key) => fields[key] ?? ""}
        disabled={false}
        onChange={(key, value) => {
          setFields((current) => ({ ...current, [key]: value }));
        }}
      />
    );
  },
};
