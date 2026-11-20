import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatRoom } from "./ChatRoom";
import { NativeChatRoom } from "../../../../../mobile/src/components/tutor/chat/NativeChatRoom";

const meta = {
  title: "Tutor/Conversation layout",
  component: ChatRoom,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="flex h-dvh min-h-0 flex-col">
        <Story />
      </main>
    ),
  ],
  args: {
    label: "Tutor",
    inputId: "preview-message",
    greeting: "What would you like to understand?",
    placeholder: "Message your Rust Programming tutor…",
    value: "",
    onChange: () => undefined,
    onSend: () => undefined,
    busy: false,
    disabled: false,
    maxLength: 2000,
    messages: [
      {
        id: "question",
        role: "learner",
        content: "Why use indices instead of pointers in a linked list?",
      },
      {
        id: "answer",
        role: "assistant",
        content:
          "An index identifies a slot in your storage. Moving the backing array keeps those indices valid.\n\nUse `Option<usize>` for a link that can be absent. If slots can be reused, a generation counter helps detect stale handles.",
      },
    ],
  },
} satisfies Meta<typeof ChatRoom>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Conversation: Story = {};
export const Empty: Story = { args: { messages: [] } };
export const Thinking: Story = {
  args: { busy: true, pendingMessage: "What happens when I remove a node?" },
};
export const Unavailable: Story = {
  args: {
    messages: [],
    disabled: true,
    afterMessages: (
      <p role="status" className="text-sm text-muted-foreground">
        Connect AI in Account to start a conversation.
      </p>
    ),
  },
};
export const Native: Story = {
  parameters: { nativePreview: true },
  render: (args) => <NativeChatRoom {...args} />,
};
