import { useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Effect, Either } from "effect";
import { createAreaId, createAssessmentId, type Workspace } from "@recall/domain";
import { newSchedule, type ReviewRating } from "@recall/scheduler";
import {
  applyWorkspaceAuthoringCommand,
  recordReview,
  studyQueue,
  localStudyDay,
  summarizeStudySession,
} from "@recall/application";
import type { StudyCommandSave } from "@recall/react";
import type { MediaStore } from "@recall/local-store";
import { StudyTools } from "./StudyTools";
import { ReviewCard } from "@/components/ui/ReviewCard";
import { NativeAdditionalStudyTools } from "../../../../../mobile/src/components/review/NativeAdditionalStudyTools";
import { NativeTodayScreenReviewCard } from "../../../../../mobile/src/components/review/NativeTodayScreenReviewCard";

const mediaStore: MediaStore = {
  get: () => Effect.succeed(null),
  put: () => Effect.void,
  delete: () => Effect.void,
  list: Effect.succeed([]),
};
const now = new Date();
const areaId = createAreaId("review-flow");
const initial: Workspace = {
  schemaVersion: 1,
  reviews: 0,
  reviewEvents: [],
  areas: [
    {
      id: areaId,
      title: "Cell biology",
      color: "#7dcfff",
      cards: [
        {
          id: createAssessmentId("mitochondria"),
          front: "What is the main role of mitochondria?",
          back: "Produce ATP through cellular respiration.",
          objective: "Cells",
          siblingId: "cell-note",
          schedule: newSchedule(now),
        },
        {
          id: createAssessmentId("ribosomes"),
          front: "What do ribosomes produce?",
          back: "Proteins.",
          objective: "Cells",
          siblingId: "cell-note",
          schedule: newSchedule(now),
        },
      ],
    },
  ],
  schedulerSettings: { requestRetention: 0.9, burySiblings: false },
};

function useFixture() {
  const [workspace, setWorkspace] = useState(initial);
  const current = useRef(workspace);
  const [revealed, setRevealed] = useState(false);
  const save: StudyCommandSave = (command, baseline) =>
    applyWorkspaceAuthoringCommand(current.current, command, now, baseline).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          current.current = result.workspace;
          setWorkspace(result.workspace);
          setRevealed(false);
        }),
      ),
      Effect.asVoid,
    );
  const rate = (rating: ReviewRating) => {
    const area = current.current.areas[0];
    const card =
      area &&
      studyQueue(current.current, area, now.getTime(), localStudyDay(now.getTime())).cards[0];
    if (!area || !card) return;
    const result = Effect.runSync(
      Effect.either(
        recordReview({
          workspace: current.current,
          areaId: area.id,
          cardId: card.id,
          rating,
          ratedAt: now.toISOString(),
          eventId: crypto.randomUUID(),
        }),
      ),
    );
    if (Either.isRight(result)) {
      current.current = result.right.workspace;
      setWorkspace(result.right.workspace);
      setRevealed(false);
    }
  };
  return { workspace, revealed, setRevealed, save, rate };
}

function Fixture({ native = false }: { readonly native?: boolean }) {
  const model = useFixture();
  const area = model.workspace.areas[0];
  if (!area) return null;
  const queue = studyQueue(model.workspace, area, now.getTime(), localStudyDay(now.getTime()));
  const card = queue.cards[0];
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-8">
      <p className="text-xs text-muted-foreground">
        Storybook preview · in-memory workspace and media services
      </p>
      <h1 className="text-2xl font-semibold">Cell biology</h1>
      <p role="status">Saved answers: {model.workspace.reviewEvents?.length ?? 0}</p>
      {native ? (
        <>
          <NativeAdditionalStudyTools
            workspace={model.workspace}
            area={area}
            card={card}
            now={now.getTime()}
            disabled={false}
            save={async (command, baseline) => {
              const result = await Effect.runPromise(Effect.either(model.save(command, baseline)));
              return Either.isRight(result)
                ? { ok: true, message: "Saved" }
                : { ok: false, message: result.left.message };
            }}
          />
          {card ? (
            <NativeTodayScreenReviewCard
              card={card}
              flagged={false}
              showAnswer={model.revealed}
              reviewPending={false}
              mediaUris={{}}
              reviewDelays={{}}
              ratingColors={{ again: "", hard: "", good: "", easy: "" }}
              onReview={model.rate}
              onShowAnswer={() => {
                model.setRevealed(true);
              }}
            />
          ) : (
            <p>No cards available.</p>
          )}
        </>
      ) : (
        <>
          <StudyTools
            workspace={model.workspace}
            area={area}
            card={card}
            mediaStore={mediaStore}
            save={model.save}
            onEdit={() => undefined}
            disabled={false}
          />
          <ReviewCard
            area={area}
            card={card}
            now={now}
            showAnswer={model.revealed}
            keyboardActive
            onReveal={() => {
              model.setRevealed(true);
            }}
            onRate={model.rate}
            onAddCard={() => undefined}
            session={summarizeStudySession(
              area,
              model.workspace.reviewEvents ?? [],
              now.getTime(),
              queue,
            )}
          />
        </>
      )}
    </main>
  );
}

const meta = {
  title: "Review/Anki workflow improvements",
  component: Fixture,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Web: Story = {};
export const Native: Story = { args: { native: true }, parameters: { nativePreview: true } };
