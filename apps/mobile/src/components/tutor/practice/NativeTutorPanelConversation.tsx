import { useState } from "react";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { NativeSelect, NativeTextField } from "@recall/ui-native";
import { NativeCardRichText } from "../../authoring/rich/NativeCardRichText";
import type { AnswerEvaluation, TutorSessionState } from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
import { NativeButton } from "../../ui/NativeButton";
import { NativeCollapsibleContent, NativeCollapsibleTrigger } from "@recall/ui-native";
import { NativeTutorEvaluation } from "./NativeTutorPanelEvidence";

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
  const [composer, setComposer] = useState("question");
  const latestReply =
    conversation.reply ||
    [...conversation.history].reverse().find((item) => item.role === "assistant")?.content;

  return (
    <>
      <NativeCollapsibleTrigger
        open={showConversation}
        title="Ask the tutor"
        onToggle={() => {
          setShowConversation((current) => !current);
        }}
      />
      <NativeCollapsibleContent open={showConversation}>
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
          />
        ) : null}
        {latestReply ? <NativeCardRichText text={latestReply} variant="body" /> : null}
        {conversation.sessionId && !conversation.quizActive && (
          <NativeSelect
            label="Conversation action"
            value={composer}
            options={[
              { value: "question", label: "Ask a question" },
              { value: "answer", label: "Answer the tutor" },
            ]}
            onValueChange={setComposer}
          />
        )}
        {composer === "question" || !conversation.sessionId || conversation.quizActive ? (
          <View className="gap-2">
            <NativeTextField
              label="Your question"
              accessibilityLabel="Ask the tutor"
              onChangeText={onQuestionChange}
              placeholder="Ask about this area…"
              multiline
              value={conversation.question}
            />
            <NativeButton
              disabled={
                conversation.busy || !conversation.apiAvailable || !conversation.question.trim()
              }
              onPress={onAsk}
              label="Ask"
            />
          </View>
        ) : (
          <View className="gap-2">
            <NativeTextField
              label="Your answer"
              accessibilityLabel="Answer the tutor"
              onChangeText={onAnswerChange}
              placeholder="Try an answer…"
              multiline
              value={conversation.answer}
            />
            <NativeButton
              disabled={
                conversation.busy || !conversation.apiAvailable || !conversation.answer.trim()
              }
              onPress={onEvaluate}
              label="Check"
            />
          </View>
        )}
        {conversation.evaluation && !conversation.quizActive ? (
          <NativeTutorEvaluation evaluation={conversation.evaluation} area={conversation.area} />
        ) : null}
        {children}
      </NativeCollapsibleContent>
    </>
  );
}
