import type { AgentDialogue } from "@recall/application";
import { useMemo } from "react";
import { useSubjectTutor } from "@recall/react";
import { createBrowserTutorConversationStore } from "@/lib/tutor-conversation-store";
import type { KnowledgeArea } from "@recall/domain";
import { Alert } from "@recall/ui-web/components/alert";
import type { ChatModelSelection } from "@/components/tutor/chat/ChatModelPicker";
import { ChatRoom } from "@/components/tutor/chat/ChatRoom";
import type { ReactNode } from "react";
import type { tutorApi } from "@/lib/tutor-api";
export function RecallSubjectTutor({
  area,
  modelSelection,
  api,
  disabled,
  unavailableReason,
  connectionPrompt,
  conversationScope,
  renderHandover,
}: {
  readonly renderHandover?: ((history: AgentDialogue) => ReactNode) | undefined;
  readonly area: KnowledgeArea;
  readonly conversationScope: string;
  readonly modelSelection?: ChatModelSelection | undefined;
  readonly api: typeof tutorApi;
  readonly disabled: boolean;
  readonly unavailableReason?: string | null;
  readonly connectionPrompt?: ReactNode;
}) {
  const store = useMemo(
    () => createBrowserTutorConversationStore(conversationScope, area.id),
    [conversationScope, area.id],
  );
  const chat = useSubjectTutor({ api, area, disabled, store });
  const { history, question, setQuestion, busy, message, ask } = chat;
  return (
    <ChatRoom
      tools={renderHandover?.(history)}
      label="Tutor"
      modelSelection={modelSelection}
      inputId={`subject-question-${area.id}`}
      greeting="What would you like to understand?"
      placeholder={`Message your ${area.title} tutor…`}
      messages={history.map((entry, index) => ({ ...entry, id: String(index) }))}
      value={question}
      onChange={setQuestion}
      onSend={ask}
      busy={busy}
      disabled={disabled || chat.loading}
      maxLength={2000}
      pendingMessage={busy ? question : undefined}
      afterMessages={
        <>
          {unavailableReason && (
            <p className="text-sm text-muted-foreground" role="status">
              {unavailableReason}
            </p>
          )}
          {connectionPrompt}
          {message && <Alert variant="destructive">{message}</Alert>}
        </>
      }
    />
  );
}
