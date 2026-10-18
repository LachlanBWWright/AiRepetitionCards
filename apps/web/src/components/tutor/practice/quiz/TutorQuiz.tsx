import type { TargetedQuizSession } from "@recall/ai-core";
import { TutorQuizQuestion } from "./TutorQuizQuestion";
type Props = {
  readonly quiz: TargetedQuizSession;
  readonly busy: boolean;
  readonly pendingQuestionIndex: number | null;
  readonly canSubmit: boolean;
  readonly onAnswerChange: (index: number, answer: string) => void;
  readonly onSubmit: (index: number) => void;
};
export function TutorQuiz({
  quiz,
  busy,
  pendingQuestionIndex,
  canSubmit,
  onAnswerChange,
  onSubmit,
}: Props) {
  return (
    <div className="my-3 rounded-lg border bg-muted/30 p-4">
      <h3 className="mb-3 text-base font-semibold">{quiz.objectiveTitle}</h3>
      {quiz.questions.map((item, index) => (
        <TutorQuizQuestion
          key={`${quiz.objectiveId}-${String(index)}`}
          item={item}
          index={index}
          busy={busy}
          pending={busy && pendingQuestionIndex === index}
          canSubmit={canSubmit}
          onAnswerChange={(answer) => {
            onAnswerChange(index, answer);
          }}
          onSubmit={() => {
            onSubmit(index);
          }}
        />
      ))}
    </div>
  );
}
