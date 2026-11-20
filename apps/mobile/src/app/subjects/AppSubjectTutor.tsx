import { AppAgentHandover } from "./AppAgentHandover";
import { useMemo } from "react";
import { useSubjectTutor } from "@recall/react";
import { createNativeTutorConversationStore } from "../../storage/ai/native-tutor-conversation-store";
import { Text } from "react-native";
import { NativeChatRoom } from "../../components/tutor/chat/NativeChatRoom";
import type { KnowledgeArea } from "@recall/domain";
import type { AppModel } from "../useAppController";
export function AppSubjectTutor({
  area,
  model,
}: {
  readonly area: KnowledgeArea;
  readonly model: AppModel;
}) {
  const generation = model.operationGeneration;
  const lifetime = model.workspaceLifetime;
  const writable = model.cacheWritable;
  const scope = `${model.accountUserId ?? "local"}:${model.tutorScope}`;
  const store = useMemo(
    () =>
      createNativeTutorConversationStore(
        scope,
        area.id,
        () => !lifetime.isBlocked() && lifetime.generation() === generation && writable,
      ),
    [scope, area.id, lifetime, generation, writable],
  );
  const chat = useSubjectTutor({
    api: model.tutorApi ?? null,
    area,
    disabled: model.reviewPending,
    store,
  });
  const { question, setQuestion, history, busy, ask, message: notice } = chat;
  return (
    <NativeChatRoom
      tools={<AppAgentHandover model={model} areaId={area.id} conversation={history} />}
      label="Tutor"
      greeting="What would you like to understand?"
      placeholder={`Message your ${area.title} tutor…`}
      messages={history.map((entry, index) => ({ ...entry, id: String(index) }))}
      value={question}
      onChange={setQuestion}
      onSend={ask}
      busy={busy}
      disabled={!model.tutorApi || model.reviewPending || chat.loading}
      maxLength={2000}
      pendingMessage={busy ? question : undefined}
      afterMessages={
        <>
          {!model.tutorApi && (
            <Text className="text-recall-muted">Connect AI in Account to begin.</Text>
          )}
          {notice && <Text accessibilityRole="alert">{notice}</Text>}
        </>
      }
    />
  );
}
