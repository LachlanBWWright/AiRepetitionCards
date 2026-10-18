import { useState } from "react";
import { Text, View } from "react-native";
import type { KnowledgeGap, TutorSessionState } from "@recall/ai-core";
import { Effect, Either } from "effect";
import { selectTutorQuizObjective } from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { NativeButton } from "../../../ui/NativeButton";
import { tutorEvidence } from "../NativeTutorPanelEvidence";

function PracticeGapButtons({
  gaps,
  busy,
  onSelect,
}: {
  readonly gaps: readonly KnowledgeGap[];
  readonly busy: boolean;
  readonly onSelect: (objectiveId: string) => void;
}) {
  return (
    <>
      {gaps.map((gap) => (
        <NativeButton
          key={gap.objectiveId}
          disabled={busy}
          onPress={() => {
            onSelect(gap.objectiveId);
          }}
          label={`Practice ${gap.objectiveTitle}`}
          className="min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
          labelClassName="text-recall-darkGreen text-[11px] font-bold"
        />
      ))}
    </>
  );
}

export interface NativeTutorQuizControlsProps {
  readonly area: KnowledgeArea;
  readonly session: TutorSessionState | null;
  readonly objectiveGaps: readonly KnowledgeGap[];
  readonly selectedObjectiveId: string | null;
  readonly onSelectObjective: (objectiveId: string) => void;
  readonly busy: boolean;
  readonly hasApi: boolean;
  readonly sessionId: string | null;
  readonly canProposeCard: boolean;
  readonly onStartQuiz: () => void;
  readonly onProposeCard: () => void;
}

export function NativeTutorQuizControls({
  area,
  session,
  objectiveGaps,
  selectedObjectiveId,
  onSelectObjective,
  busy,
  hasApi,
  sessionId,
  canProposeCard,
  onStartQuiz,
  onProposeCard,
}: NativeTutorQuizControlsProps) {
  const [showTargets, setShowTargets] = useState(false);
  const quizSelection = Effect.runSync(
    Effect.either(
      selectTutorQuizObjective(area, objectiveGaps, tutorEvidence(session), selectedObjectiveId),
    ),
  );

  return (
    <>
      <NativeButton
        label={showTargets ? "Hide practice targets" : "Practice targets"}
        onPress={() => {
          setShowTargets((current) => !current);
        }}
        className="py-[9px] px-[4px]"
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
      {showTargets && Either.isRight(quizSelection) && quizSelection.right.objective ? (
        <View className="gap-[8px] py-[11px] border-b border-b-recall-line">
          <Text className="text-recall-ink font-bold text-[13px]">
            Practice target: {quizSelection.right.objective.title}
          </Text>
          {quizSelection.right.gap ? (
            <Text className="text-recall-ink text-[13px] leading-[19px]">
              {quizSelection.right.gap.evidenceSummary}
            </Text>
          ) : null}
          <PracticeGapButtons
            gaps={quizSelection.right.gaps}
            busy={busy}
            onSelect={onSelectObjective}
          />
        </View>
      ) : null}
      <View className="flex-row gap-[8px] items-center">
        <NativeButton
          disabled={busy || !hasApi}
          onPress={onStartQuiz}
          label="Targeted quiz"
          className="min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
          labelClassName="text-recall-darkGreen text-[11px] font-bold"
        />
        {sessionId && canProposeCard ? (
          <NativeButton
            disabled={busy || !hasApi}
            onPress={onProposeCard}
            label="Propose card"
            className="min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
            labelClassName="text-recall-darkGreen text-[11px] font-bold"
          />
        ) : null}
      </View>
    </>
  );
}
