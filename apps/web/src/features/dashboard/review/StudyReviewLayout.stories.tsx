import { NativeTodayScreenReviewCard } from "../../../../../mobile/src/components/review/NativeTodayScreenReviewCard";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Effect } from "effect";
import { createAreaId, createAssessmentId, type Workspace } from "@recall/domain";
import type { MediaStore } from "@recall/local-store";
import { newSchedule } from "@recall/scheduler";
import { summarizeStudySession } from "@recall/application";
import { Button } from "@recall/ui-web";
import { ReviewCard } from "@/components/ui/ReviewCard";
import { StudyTools } from "./StudyTools";

const now = new Date("2026-11-07T00:00:00Z");
const card = {
  id: createAssessmentId("rust-card"),
  objective: "Linked lists",
  schedule: newSchedule(now),
  front: "How do you move a node to the front of an index-based linked list?",
  back: "Detach node `x`: connect its previous node to its next node (`prev.next = next`) and its next node back to its previous node (`next.prev = prev`), updating the list’s head or tail when either neighbor is absent. Then set `x.prev` to none and `x.next` to the old head; set the old head’s `prev` to `x` if it exists, and set the head to `x`. If `x` was already the head, no move is needed.",
};
const area = {
  id: createAreaId("rust"),
  title: "Rust Programming",
  color: "#123456",
  cards: [card],
};
const workspace: Workspace = { schemaVersion: 1, reviews: 0, areas: [area] };
const mediaStore: MediaStore = {
  get: () => Effect.succeed(null),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed([]),
};
function ReviewLayout() {
  const [revealed, setRevealed] = useState(true);
  const [rating, setRating] = useState("");
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-[248px] shrink-0 border-r border-border bg-card px-6 py-8 lg:block">
        <strong className="text-xl">recall.</strong>
        <p className="mt-8 text-muted-foreground">Your subjects</p>
        <p className="mt-4">Rust Programming</p>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="mx-auto max-w-[1080px] px-4 pt-8 sm:px-8 lg:px-11">
          <p className="text-sm text-muted-foreground">Home / Subjects</p>
          <h1 className="mt-2 text-3xl font-semibold">Rust Programming</h1>
        </header>
        <div className="mx-auto max-w-[1080px] space-y-4 px-4 py-5 sm:px-8 lg:px-11">
          <StudyTools
            workspace={workspace}
            area={area}
            card={card}
            mediaStore={mediaStore}
            disabled={false}
            onEdit={() => undefined}
            save={() => Effect.succeed(workspace)}
          />
          <ReviewCard
            area={area}
            card={card}
            session={summarizeStudySession(area, [], now.getTime())}
            now={now}
            showAnswer={revealed}
            onReveal={() => {
              setRevealed(true);
            }}
            onRate={setRating}
            onAddCard={() => undefined}
            onFlag={() => undefined}
            onEdit={() => undefined}
            onDelete={() => undefined}
            keyboardActive
            helpAction={<Button variant="secondary">Help with this card</Button>}
          />
          {rating && <p role="status">Selected rating: {rating}</p>}
        </div>
      </main>
    </div>
  );
}
const meta = {
  title: "Review/Study layout",
  component: ReviewLayout,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ReviewLayout>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LongAnswer: Story = {};

function NativeReviewLayout() {
  const [rating, setRating] = useState("");
  return (
    <div className="mx-auto max-w-md p-4">
      <NativeTodayScreenReviewCard
        card={card}
        flagged={false}
        showAnswer
        reviewPending={false}
        mediaUris={{}}
        reviewDelays={{ again: "1 min", hard: "6 min", good: "10 min", easy: "8 days" }}
        ratingColors={{ again: "", hard: "", good: "", easy: "" }}
        onReview={setRating}
        onShowAnswer={() => undefined}
      />
      {rating && <p role="status">Selected rating: {rating}</p>}
    </div>
  );
}
export const Native: Story = {
  parameters: { nativePreview: true },
  render: () => <NativeReviewLayout />,
};
