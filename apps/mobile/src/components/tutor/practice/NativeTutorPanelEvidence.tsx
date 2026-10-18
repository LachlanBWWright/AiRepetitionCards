import { View, Text } from "react-native";
import type { AnswerEvaluation, TutorSessionState } from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
import { Effect, Either } from "effect";
import { accumulateTutorObservations } from "@recall/application";

export function NativeTutorEvaluation({
  evaluation,
}: {
  readonly evaluation: AnswerEvaluation;
  readonly area: KnowledgeArea;
}) {
  const assessment = {
    mastered: "Answer understood",
    partial: "Partially understood",
    incorrect: "Needs another attempt",
    uncertain: "Uncertain",
  }[evaluation.result];
  return (
    <View
      accessibilityLiveRegion="polite"
      className={"gap-[8px] py-[11px] border-b border-b-recall-line"}
    >
      <Text className={"text-recall-ink font-bold text-[13px]"}>{assessment}</Text>
      {evaluation.result === "uncertain" || evaluation.confidence < 0.5 ? (
        <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
          This assessment is tentative. Ask for clarification or try another answer.
        </Text>
      ) : null}
      <Text className={"text-recall-ink text-[13px] leading-[19px]"}>{evaluation.feedback}</Text>
      {evaluation.misconception ? (
        <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
          Possible misconception: {evaluation.misconception}
        </Text>
      ) : null}
    </View>
  );
}

export function tutorEvidence(session: TutorSessionState | null) {
  const previous = session?.observations ?? [];
  return previous.length > 0 || !session?.evaluation ? previous : [session.evaluation];
}

export function accumulatedEvidence(
  session: TutorSessionState | null,
  observation: TutorSessionState["evaluation"],
) {
  const previous = tutorEvidence(session);
  const result = Effect.runSync(Effect.either(accumulateTutorObservations(previous, observation)));
  return Either.isRight(result) ? result.right : previous;
}

export function emptySession(sessionId: string): TutorSessionState {
  return { sessionId, history: [], evaluation: null, proposal: null, quiz: null };
}
