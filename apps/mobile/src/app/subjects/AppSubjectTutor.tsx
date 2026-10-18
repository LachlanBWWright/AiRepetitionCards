import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import { NativeChatRoom } from "../../components/tutor/chat/NativeChatRoom";
import { Effect, Either } from "effect";
import { askSubjectTutor, tutorApiFailureMessage, type SubjectDialogue } from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import type { AppModel } from "../useAppController";
export function AppSubjectTutor({
  area,
  model,
}: {
  readonly area: KnowledgeArea;
  readonly model: AppModel;
}) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<SubjectDialogue>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function ask() {
    const api = model.tutorApi;
    if (!api || model.reviewPending || pending.current || !question.trim()) return;
    pending.current = true;
    setBusy(true);
    setNotice(null);
    const submitted = question;
    Effect.runFork(
      askSubjectTutor(api, area, history, submitted).pipe(
        Effect.either,
        Effect.flatMap((result) =>
          Effect.sync(() => {
            if (!alive.current) return;
            if (Either.isLeft(result)) setNotice(tutorApiFailureMessage(result.left));
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
    <NativeChatRoom
      label="Tutor"
      greeting="What would you like to understand?"
      placeholder={`Message your ${area.title} tutor…`}
      messages={history.map((entry, index) => ({ ...entry, id: String(index) }))}
      value={question}
      onChange={setQuestion}
      onSend={ask}
      busy={busy}
      disabled={!model.tutorApi || model.reviewPending}
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
