import { useCramPractice } from "@recall/react";
import type { MediaStore } from "@recall/local-store";
import { useReviewCardMedia, type ReviewMediaPreview } from "./useReviewCardMedia";
import { useState } from "react";
import type { LearningArea, Workspace } from "@recall/domain";
import { ReviewCard } from "@/components/ui/ReviewCard";
import { Button } from "@/components/ui/Button";
import { FilteredStudyControls } from "./FilteredStudyControls";
import type { SaveStudyCommand } from "./useStudyCardControls";

export function CramPractice({
  area,
  workspace,
  mediaStore,
  save,
}: {
  readonly area: LearningArea;
  readonly workspace: Workspace;
  readonly mediaStore: MediaStore;
  readonly save: SaveStudyCommand;
}) {
  const {
    now,
    busy,
    message,
    mode,
    session,
    card: current,
    showAnswer,
    start,
    reveal,
    rate,
    restart,
  } = useCramPractice(area, workspace, Date.now, save, () => crypto.randomUUID());
  const [previews, setPreviews] = useState<readonly ReviewMediaPreview[]>([]);
  useReviewCardMedia(mediaStore, current, setPreviews);
  return (
    <div className="grid gap-4">
      <FilteredStudyControls
        workspace={workspace}
        area={area}
        now={now}
        save={save}
        onStart={start}
      />
      <p className="text-sm text-muted-foreground">
        {mode === "reschedule"
          ? "Answers are recorded and original schedules updated."
          : "Preview leaves due dates, daily budget and review history unchanged."}{" "}
        Forgotten cards return at the end.
      </p>
      {message && <p role="alert">{message}</p>}
      <p role="status">
        {session.answered} answers · {session.recalled} recalled · {session.remainingIds.length}{" "}
        remaining
      </p>
      {current ? (
        <ReviewCard
          area={area}
          card={current}
          mediaPreviews={previews}
          showAnswer={showAnswer}
          onReveal={reveal}
          onRate={rate}
          saving={busy}
          onAddCard={() => undefined}
        />
      ) : (
        <p>Practice complete.</p>
      )}
      <Button variant="secondary" onClick={restart}>
        Restart practice
      </Button>
    </div>
  );
}
