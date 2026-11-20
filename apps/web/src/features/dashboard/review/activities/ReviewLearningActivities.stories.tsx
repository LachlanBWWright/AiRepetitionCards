import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { activityFromCard } from "@recall/application";
import { emptyActivityLibrary, type ActivityLibrary } from "@recall/domain";
import { mockWorkspace } from "@/features/workspace/mock-data";
import { ReviewCard } from "@/components/ui/ReviewCard";
import { ReviewLearningActivities } from "./ReviewLearningActivities";

const meta = {
  title: "Review/Inline learning activities",
  component: ReviewExample,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ReviewExample>;
export default meta;
type Story = StoryObj<typeof meta>;

function ReviewExample({ unavailable = false }: { readonly unavailable?: boolean }) {
  const area = mockWorkspace.areas[0];
  const card = area?.cards[0];
  const [library, setLibrary] = useState<ActivityLibrary>(() => {
    if (!area || !card) return emptyActivityLibrary;
    const activity = activityFromCard(card, area.id);
    return {
      ...emptyActivityLibrary,
      activities: [
        { ...activity, ...(unavailable ? { pluginId: "example.unavailable" } : {}) },
        {
          ...activity,
          id: "unrelated-activity",
          sourceId: "unrelated-card",
          objectiveIds: ["unrelated-objective"],
        },
      ],
    };
  });
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [rating, setRating] = useState<string | null>(null);
  if (!area || !card) return null;
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <ReviewCard
        area={area}
        card={card}
        showAnswer={revealed}
        keyboardActive={!open && !accepted}
        disabled={open}
        onReveal={() => {
          setRevealed(true);
        }}
        onRate={setRating}
        onAddCard={() => undefined}
      />
      <ReviewLearningActivities
        card={card}
        areaId={area.id}
        library={library}
        objectives={area.objectives ?? []}
        createId={() => crypto.randomUUID()}
        onOpenChange={setOpen}
        onAccepted={() => {
          setAccepted(true);
        }}
        onReturn={() => {
          setRevealed(true);
        }}
        onSave={(next) => {
          setLibrary(next);
          return Promise.resolve(true);
        }}
      />
      <p>Activities retained: {library.activities.length}</p>
      <p>Accepted attempts: {library.attempts.length}</p>
      <p role="status">{rating ? `Learner confirmed review: ${rating}` : "No review recorded"}</p>
    </div>
  );
}

export const ExplicitStartAndRating: Story = { render: () => <ReviewExample /> };
export const UnavailablePlugin: Story = { render: () => <ReviewExample unavailable /> };
