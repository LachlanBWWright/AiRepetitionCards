import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect } from "effect";
import { ChatGPTResearchPanel } from "./ChatGPTResearchPanel";
import type { ChatGPTResearchApi, ChatGPTResearchResult } from "@/lib/chatgpt-local-research";

const text = "Mitochondria produce ATP, which supplies energy for cellular processes.";
const result: ChatGPTResearchResult = {
  text,
  searched: true,
  model: "mock-study-model",
  citations: [
    {
      url: "https://example.com/biology/atp",
      title: "ATP and cellular energy (mock source)",
      startIndex: 0,
      endIndex: text.length,
    },
  ],
};
const api: ChatGPTResearchApi = {
  search: () => Effect.succeed(result),
  openSource: () => Effect.void,
};
const meta = {
  title: "Screens/Desktop ChatGPT Research",
  component: ChatGPTResearchPanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="component-catalog tutor-story">
        <div>
          <p className="eyebrow">RECALL · DESKTOP · MOCK DATA</p>
          <h1>Research with your ChatGPT plan</h1>
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    expectedClientId: "mock-client",
    model: "mock-study-model",
    areaId: "mock-biology",
    api,
    initialQuery: "How do mitochondria supply usable energy to a cell?",
  },
} satisfies Meta<typeof ChatGPTResearchPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = { name: "Research · ready to search" };
export const SourceResults: Story = {
  name: "Research · source citations",
  args: { initialResult: result },
};
export const Unsupported: Story = {
  name: "Research · search unavailable for selected model",
  args: {
    initialMessage:
      "Web search is unavailable for this model, account or workspace. Choose another available model or check workspace permissions.",
    api: {
      ...api,
      search: () =>
        Effect.fail({
          _tag: "ChatGPTResearchFailure",
          message: "Web search is unavailable for this model, account or workspace.",
        }),
    },
  },
};
export const FailurePreservesResult: Story = {
  name: "Research · failed search preserves results",
  args: {
    initialResult: result,
    initialMessage:
      "The search could not complete. Check your connection and try again. The previous result remains available.",
    api: {
      ...api,
      search: () =>
        Effect.fail({
          _tag: "ChatGPTResearchFailure",
          message: "The search could not complete. Check your connection and try again.",
        }),
    },
  },
};
