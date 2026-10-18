import { Text, TextInput, View } from "react-native";
import type { TargetedQuizSession } from "@recall/ai-core";
import type { TutorSessionState } from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
import { designTokens } from "@recall/design-tokens";
import { NativeButton } from "../../../ui/NativeButton";
import { NativeTutorEvaluation } from "../NativeTutorPanelEvidence";

const palette = designTokens.color;

export interface NativeTutorQuizProps {
  readonly area: KnowledgeArea;
  readonly quiz: TargetedQuizSession;
  readonly busy: boolean;
  readonly pendingQuestionIndex: number;
  readonly answer: string;
  readonly onAnswerChange: (answer: string) => void;
  readonly onSubmit: () => void;
}

export function NativeTutorQuizHistory({
  area,
  session,
}: {
  readonly area: KnowledgeArea;
  readonly session: TutorSessionState | null;
}) {
  return (
    <>
      {session?.quiz?.questions.map((item, index) =>
        item.evaluation ? (
          <View
            key={`${String(session.quiz?.objectiveId)}:${String(index)}`}
            className="gap-[8px] py-[11px] border-b border-b-recall-line"
          >
            <Text className="text-recall-ink font-bold text-[13px]">
              Quiz answer {index + 1}: {item.prompt}
            </Text>
            {item.learnerAnswer ? (
              <Text className="text-recall-ink text-[13px] leading-[19px]">
                Your answer: {item.learnerAnswer}
              </Text>
            ) : null}
            <NativeTutorEvaluation evaluation={item.evaluation} area={area} />
          </View>
        ) : null,
      )}
    </>
  );
}

export function NativeTutorQuiz({
  area,
  quiz,
  busy,
  pendingQuestionIndex,
  answer,
  onAnswerChange,
  onSubmit,
}: NativeTutorQuizProps) {
  const question = quiz.questions[pendingQuestionIndex];
  if (!question) return null;

  return (
    <View className={"gap-[8px] py-[11px] border-b border-b-recall-line"}>
      <Text className={"text-recall-ink font-bold text-[13px]"}>{question.prompt}</Text>
      {question.evaluation ? (
        <NativeTutorEvaluation evaluation={question.evaluation} area={area} />
      ) : null}
      <View className={"flex-row gap-[8px] items-center"}>
        <TextInput
          accessibilityLabel="Quiz answer"
          onChangeText={onAnswerChange}
          placeholder="Your answer"
          placeholderTextColor={palette.muted}
          className="flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
          value={answer}
        />
        <NativeButton
          disabled={busy || !answer.trim()}
          onPress={onSubmit}
          label="Submit"
          className="min-h-[40px] justify-center px-[13px] rounded-[10px] bg-recall-darkGreen"
          labelClassName="text-recall-surface text-[12px] font-bold"
        />
      </View>
    </View>
  );
}
