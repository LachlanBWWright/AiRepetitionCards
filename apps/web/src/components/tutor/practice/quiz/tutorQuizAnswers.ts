import type { TargetedQuizSession } from "@recall/ai-core";
export function updateTutorQuizAnswer(
  quiz: TargetedQuizSession | null,
  index: number,
  learnerAnswer: string,
): TargetedQuizSession | null {
  return (
    quiz && {
      ...quiz,
      questions: quiz.questions.map((question, questionIndex) =>
        questionIndex === index ? { ...question, learnerAnswer } : question,
      ),
    }
  );
}
