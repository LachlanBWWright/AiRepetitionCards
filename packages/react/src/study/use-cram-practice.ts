"use client";

import { useRef, useState } from "react";
import { Effect, Either } from "effect";
import type { StudyCommandSave } from "./use-study-command";
import { createReviewEventId } from "@recall/domain";
import type { FilteredDeck, LearningArea, Workspace } from "@recall/domain";
import { startCramSession, cramCard, rateCramCard } from "@recall/application";
import type { ReviewRating } from "@recall/scheduler";
export function useCramPractice(
  area: LearningArea,
  workspace: Workspace,
  clock: () => number,
  save?: StudyCommandSave,
  createId?: () => string,
) {
  const [deck, setDeck] = useState<FilteredDeck | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  const [studyArea, setStudyArea] = useState(area);
  const [now] = useState(clock);
  const [session, setSession] = useState(() =>
    startCramSession(area, workspace.schedulerSettings?.suspendedCardIds),
  );
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const card = cramCard(session, studyArea);
  const start = (selected: LearningArea, options?: FilteredDeck) => {
    if (saving.current) return;
    setDeck(options);
    setMessage("");
    setStudyArea(selected);
    setSession(startCramSession(selected, workspace.schedulerSettings?.suspendedCardIds));
    setRevealedId(null);
  };
  const reveal = () => {
    if (card) setRevealedId(card.id);
  };
  const rate = (rating: ReviewRating) => {
    if (!card || revealedId !== card.id) return;
    if (saving.current) return;
    const advance = () => {
      setSession((previous) => rateCramCard(previous, card.id, rating));
      setRevealedId(null);
    };
    if (deck?.mode !== "reschedule") {
      advance();
      return;
    }
    if (!save || !createId) {
      setMessage("Saving scheduled practice is unavailable.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setMessage("");
    void Effect.runPromise(
      Effect.either(
        Effect.try({
          try: createId,
          catch: () => ({ message: "Could not create a review identifier." }),
        }).pipe(
          Effect.flatMap((eventId) =>
            save({
              kind: "rate-filtered-card",
              cardId: card.id,
              eventId: createReviewEventId(eventId),
              rating,
              deck,
            }),
          ),
        ),
      ),
    ).then((result) => {
      saving.current = false;
      setBusy(false);
      if (Either.isLeft(result)) setMessage(result.left.message);
      else advance();
    });
  };
  return {
    now,
    busy,
    message,
    mode: deck?.mode ?? "preview",
    session,
    card,
    showAnswer: Boolean(card && revealedId === card.id),
    start,
    reveal,
    rate,
    restart: () => {
      start(studyArea, deck);
    },
  };
}
