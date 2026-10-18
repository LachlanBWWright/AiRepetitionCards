import { NativeChatRoom } from "./NativeChatRoom";
import { Text, View } from "react-native";
import { NativeButton } from "@recall/ui-native";
import { improvementMessages, improvementOpening } from "@recall/application";
import { NativeKnowledgeNotebookProposal } from "../notebook/proposals/NativeKnowledgeNotebookProposal";
import { NotebookSection } from "../notebook/NativeKnowledgeNotebookTypes";
import type { NativeNotebookModel } from "../notebook/useNativeKnowledgeNotebookModel";
export function NativeImprovementChat({ model }: { readonly model: NativeNotebookModel }) {
  const history = improvementMessages(model.notebook);
  const messages = history.length
    ? history
    : [{ id: "opening", role: "assistant" as const, content: improvementOpening(model.area) }];
  const proposals = { ...model, section: NotebookSection.ReviewSuggestions };
  const disabled =
    model.busy ||
    !model.loaded ||
    model.loadFailed ||
    !!model.unsaved ||
    !model.mayWrite() ||
    !model.api;
  function retrySave() {
    const next = model.unsaved;
    if (next)
      void model.runAction(async () => {
        await model.save(next);
      });
  }
  return (
    <NativeChatRoom
      label="Improve"
      greeting="What would you like to improve?"
      placeholder="Message Improve…"
      messages={messages}
      value={model.answer}
      onChange={model.setAnswer}
      onSend={() => {
        void model.sendChatMessage(model.answer);
      }}
      busy={model.busy}
      disabled={disabled}
      maxLength={model.notebook ? 8000 : 2000}
      afterMessages={
        <>
          {Boolean(model.pendingProposal) && (
            <View className="gap-3">
              <NativeKnowledgeNotebookProposal
                key={model.pendingProposal?.id}
                model={proposals}
                preview
              />
            </View>
          )}
          {model.notice && (
            <Text accessibilityRole="alert" className="text-recall-muted">
              {model.notice}
            </Text>
          )}
          {model.unsaved && (
            <NativeButton
              label="Retry saving conversation"
              disabled={model.busy}
              onPress={retrySave}
            />
          )}
          {!model.api && (
            <Text className="text-recall-muted">
              Connect AI in Account to start the conversation.
            </Text>
          )}
        </>
      }
    />
  );
}
