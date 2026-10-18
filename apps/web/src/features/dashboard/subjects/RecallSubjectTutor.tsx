import { useRef, useState, useEffect } from "react";
import { Effect, Either } from "effect";
import { askSubjectTutor, tutorApiFailureMessage, type SubjectDialogue } from "@recall/application";
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
  tools,
  unavailableReason,
}: {
  readonly area: KnowledgeArea;
  readonly modelSelection?: ChatModelSelection | undefined;
  readonly api: typeof tutorApi;
  readonly disabled: boolean;
  readonly tools?: ReactNode;
  readonly unavailableReason?: string | null;
}) {
  const [history, setHistory] = useState<SubjectDialogue>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function ask() {
    if (disabled || pending.current || !question.trim()) return;
    pending.current = true;
    setBusy(true);
    setMessage(null);
    const submitted = question;
    Effect.runFork(
      askSubjectTutor(api, area, history, submitted).pipe(
        Effect.either,
        Effect.flatMap((result) =>
          Effect.sync(() => {
            if (!alive.current) return;
            if (Either.isLeft(result)) setMessage(tutorApiFailureMessage(result.left));
            else {
              setHistory(result.right.history);
              setQuestion((value) => (value === submitted ? "" : value));
            }
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            pending.current = false;
            if (alive.current) setBusy(false);
          }),
        ),
      ),
    );
  }
  return (
    <ChatRoom
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
      disabled={disabled}
      maxLength={2000}
      pendingMessage={busy ? question : undefined}
      afterMessages={
        <>
          {unavailableReason && (
            <p className="text-sm text-muted-foreground" role="status">
              {unavailableReason}
            </p>
          )}
          {message && <Alert variant="destructive">{message}</Alert>}
          {tools}
        </>
      }
    />
  );
}
