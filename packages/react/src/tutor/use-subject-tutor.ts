"use client";
import { useEffect, useRef, useState } from "react";
import { Effect, Fiber } from "effect";
import {
  askSubjectTutor,
  tutorApiFailureMessage,
  type SubjectDialogue,
  type TutorConversationStore,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";

export function useSubjectTutor({
  api,
  area,
  disabled,
  store,
}: {
  readonly api: Parameters<typeof askSubjectTutor>[0] | null;
  readonly area: KnowledgeArea;
  readonly disabled: boolean;
  readonly store: TutorConversationStore;
}) {
  const [history, setHistory] = useState<SubjectDialogue>([]);
  const [question, setQuestion] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [observedStore, setObservedStore] = useState(store);
  const pending = useRef(false);
  const currentStore = useRef(store);
  if (observedStore !== store) {
    setObservedStore(store);
    setBusy(false);
    setLoading(true);
    setHistory([]);
    setQuestion("");
    setLoadFailed(false);
    setMessage(null);
  }
  const alive = useRef(false);
  useEffect(() => {
    currentStore.current = store;
    pending.current = false;
    alive.current = true;
    const fiber = Effect.runFork(
      store.read.pipe(
        Effect.match({
          onFailure: (error) => {
            if (alive.current && currentStore.current === store) {
              setMessage(error.message);
              setLoadFailed(true);
              setLoading(false);
            }
          },
          onSuccess: (value) => {
            if (!alive.current || currentStore.current !== store) return;
            setHistory(value?.history ?? []);
            setQuestion(value?.draft ?? "");
            setLoading(false);
          },
        }),
      ),
    );
    return () => {
      alive.current = false;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [store]);
  useEffect(() => {
    if (loading || loadFailed) return;
    const fiber = Effect.runFork(
      Effect.sleep("300 millis").pipe(
        Effect.flatMap(() => store.write(history, question)),
        Effect.catchAll((error) =>
          Effect.sync(() => {
            if (alive.current && currentStore.current === store) setMessage(error.message);
          }),
        ),
      ),
    );
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [store, history, question, loadFailed, loading]);
  const ask = () => {
    if (!api || disabled || loading || pending.current || !question.trim()) return;
    pending.current = true;
    setBusy(true);
    setMessage(null);
    const submitted = question;
    Effect.runFork(
      askSubjectTutor(api, area, history, submitted).pipe(
        Effect.match({
          onFailure: (error) => {
            if (alive.current && currentStore.current === store)
              setMessage(tutorApiFailureMessage(error));
          },
          onSuccess: (result) => {
            if (alive.current && currentStore.current === store) {
              setHistory(result.history);
              setQuestion((current) => (current === submitted ? "" : current));
            }
          },
        }),
        Effect.ensuring(
          Effect.sync(() => {
            if (currentStore.current !== store) return;
            pending.current = false;
            if (alive.current && currentStore.current === store) setBusy(false);
          }),
        ),
      ),
    );
  };
  return {
    history,
    question,
    setQuestion,
    busy,
    loading,
    message,
    ask,
  };
}
