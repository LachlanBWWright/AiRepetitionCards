import { Effect, Either } from "effect";
import { useState } from "react";
import { compareTypedAnswer, reviewPlainText, clozeAnswerText } from "@recall/application";
import type { Assessment } from "@recall/domain";

export function useTypedAnswer(card: Assessment) {
  const [draft, setDraft] = useState({ id: card.id, text: "" });
  const answer = draft.id === card.id ? draft.text : "";
  const settings = card.presentation?.typedAnswer;
  const cloze = card.cloze ? Effect.runSync(Effect.either(clozeAnswerText(card.cloze))) : undefined;
  const expected = cloze && Either.isRight(cloze) ? cloze.right : card.back;
  return {
    answer,
    setAnswer: (text: string) => {
      setDraft({ id: card.id, text });
    },
    comparison: settings?.enabled
      ? compareTypedAnswer(answer, reviewPlainText(expected), settings)
      : undefined,
    enabled: settings?.enabled === true,
  };
}
