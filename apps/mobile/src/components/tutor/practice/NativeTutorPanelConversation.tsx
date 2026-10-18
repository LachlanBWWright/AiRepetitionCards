import { useState } from "react";
import type { ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import type { AnswerEvaluation, TutorSessionState } from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
import { designTokens } from "@recall/design-tokens";
import { NativeButton } from "../../ui/NativeButton";
import { NativeTutorEvaluation } from "./NativeTutorPanelEvidence";

const palette = designTokens.color;

export interface NativeTutorConversationState {
  readonly area: KnowledgeArea;
  readonly apiAvailable: boolean;
  readonly sessionId: string | null;
  readonly busy: boolean;
  readonly reply: string;
  readonly history: TutorSessionState["history"];
  readonly evaluation: AnswerEvaluation | null;
  readonly quizActive: boolean;
  readonly question: string;
  readonly answer: string;
}

export interface NativeTutorPanelConversationProps {
  readonly conversation: NativeTutorConversationState;
  readonly onResume: () => void;
  readonly onQuestionChange: (question: string) => void;
  readonly onAsk: () => void;
  readonly onAnswerChange: (answer: string) => void;
  readonly onEvaluate: () => void;
  readonly children?: ReactNode;
}

export function NativeTutorPanelConversation({
  conversation,
  onResume,
  onQuestionChange,
  onAsk,
  onAnswerChange,
  onEvaluate,
  children,
}: NativeTutorPanelConversationProps) {
  const [showConversation, setShowConversation] = useState(false);
  const latestReply =
    conversation.reply ||
    [...conversation.history].reverse().find((item) => item.role === "assistant")?.content;

  return (
    <>
      <NativeButton
        label={showConversation ? "Close tutor conversation" : "Ask the tutor"}
        onPress={() => {
          setShowConversation((current) => !current);
        }}
        className="py-[9px] px-[4px]"
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
      <View className={showConversation ? "gap-[10px]" : "hidden"}>
        {!conversation.apiAvailable ? (
          <Text className="text-recall-muted text-[11px] leading-[16px]">
            Connect AI in settings to ask questions.
          </Text>
        ) : null}
        {!conversation.sessionId ? (
          <NativeButton
            disabled={conversation.busy || !conversation.apiAvailable}
            onPress={onResume}
            label={conversation.busy ? "Loading…" : "Resume tutor"}
            className="min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
            labelClassName="text-recall-darkGreen text-[11px] font-bold"
          />
        ) : null}
        {latestReply ? (
          <Text className="text-recall-ink text-[13px] leading-[19px]">{latestReply}</Text>
        ) : null}
        <View className="flex-row gap-[8px] items-center">
          <TextInput
            accessibilityLabel="Ask the tutor"
            onChangeText={onQuestionChange}
            placeholder="Ask about this area…"
            placeholderTextColor={palette.muted}
            className="flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
            value={conversation.question}
          />
          <NativeButton
            disabled={
              conversation.busy || !conversation.apiAvailable || !conversation.question.trim()
            }
            onPress={onAsk}
            label="Ask"
            className="min-h-[40px] justify-center px-[13px] rounded-[10px] bg-recall-darkGreen"
            labelClassName="text-recall-surface text-[12px] font-bold"
          />
        </View>
        {conversation.sessionId && !conversation.quizActive ? (
          <View className="flex-row gap-[8px] items-center">
            <TextInput
              accessibilityLabel="Answer the tutor"
              onChangeText={onAnswerChange}
              placeholder="Try an answer…"
              placeholderTextColor={palette.muted}
              className="flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
              value={conversation.answer}
            />
            <NativeButton
              disabled={
                conversation.busy || !conversation.apiAvailable || !conversation.answer.trim()
              }
              onPress={onEvaluate}
              label="Check"
              className="min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
              labelClassName="text-recall-darkGreen text-[11px] font-bold"
            />
          </View>
        ) : null}
        {conversation.evaluation && !conversation.quizActive ? (
          <NativeTutorEvaluation evaluation={conversation.evaluation} area={conversation.area} />
        ) : null}
        {children}
      </View>
    </>
  );
}
