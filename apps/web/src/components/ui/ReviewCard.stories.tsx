import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ReviewCard } from "./ReviewCard";
import { mockWorkspace } from "@/features/workspace/mock-data";

const biology = mockWorkspace.areas[0];
const exampleCard = biology?.cards[0];

const meta = {
  title: "Design System/Review Card",
  component: ReviewCard,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ReviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Question: Story = {
  args: {
    area: biology,
    card: exampleCard,
    showAnswer: false,
    onReveal: () => undefined,
    onRate: () => undefined,
    onEdit: () => undefined,
    onDelete: () => undefined,
    onAddCard: () => undefined,
  },
};

export const Answer: Story = {
  name: "Answer revealed",
  args: { ...Question.args, showAnswer: true },
};

export const MultilineAnswer: Story = {
  name: "Multiline answer",
  args: {
    ...Answer.args,
    card: exampleCard
      ? {
          ...exampleCard,
          front: "How do you solve this equation?\n\n2x + 3 = 11",
          back: "1. Subtract 3 from both sides.\n   2x = 8\n\n2. Divide both sides by 2.\n   x = 4",
        }
      : undefined,
  },
};

export const CaughtUp: Story = {
  name: "Caught up · empty state",
  args: { ...Question.args, card: undefined },
};

export const FullScreenCatalog: Story = {
  name: "Full-screen · study card catalog",
  args: Question.args,
  render: () => (
    <main className="component-catalog">
      <p className="eyebrow">RECALL · DESIGN SYSTEM</p>
      <h1>
        Study at your <em>own pace.</em>
      </h1>
      <p className="subheading">Question, answer, recall ratings, and completion states.</p>
      <div className="component-catalog-grid">
        <section>
          <h2>Question</h2>
          <p>Recall before revealing the answer.</p>
          <ReviewCard {...Question.args} />
        </section>
        <section>
          <h2>Answer revealed</h2>
          <p>Choose how well you remembered.</p>
          <ReviewCard {...Answer.args} />
        </section>
        <section>
          <h2>Caught up</h2>
          <p>There are no cards due right now.</p>
          <ReviewCard {...CaughtUp.args} />
        </section>
        <section>
          <h2>Another learning area</h2>
          <p>Card context comes from the selected area.</p>
          <ReviewCard
            {...Question.args}
            area={mockWorkspace.areas[1]}
            card={mockWorkspace.areas[1]?.cards[0]}
          />
        </section>
      </div>
    </main>
  ),
};
