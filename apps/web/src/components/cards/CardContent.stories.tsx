import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createAssessmentId } from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import { ReviewCard } from "../ui/ReviewCard";
import { RichTextEditor } from "./RichTextEditor";

function CardContentExample() {
  const [source, setSource] = useState("Use x here.");
  const [revealed, setRevealed] = useState(false);
  return (
    <main className="mx-auto grid max-w-2xl gap-6 p-4">
      <section className="space-y-2">
        <label htmlFor="equation-source">Card text</label>
        <RichTextEditor id="equation-source" value={source} onChange={setSource} maxLength={500} />
      </section>
      <ReviewCard
        area={{ title: "Physics", color: "#123456" }}
        card={{
          id: createAssessmentId("equation-review"),
          front: "What is the mass–energy relation?",
          back: "\\(E=mc^2\\)",
          explanation:
            "Energy equals mass times the speed of light squared.\n\\[E = m \\times c^2\\]\n```rust\nlet energy = mass * c.powi(2);\n```",
          objective: "Physics",
          schedule: newSchedule(new Date("2026-10-25T12:00:00Z")),
        }}
        showAnswer={revealed}
        onReveal={() => {
          setRevealed(true);
        }}
        onRate={() => undefined}
        onAddCard={() => undefined}
      />
    </main>
  );
}
const meta = {
  title: "Authoring/Card content",
  component: CardContentExample,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CardContentExample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
