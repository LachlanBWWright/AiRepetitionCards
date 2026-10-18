import { Effect } from "effect";
import {
  addNotebookConcepts,
  appendNotebookReviewEvidence,
  beginNotebookSession,
  updateNotebookGoal,
  controlNotebookSession,
  seedKnowledgeNotebook,
  sendImprovementMessage,
  updateNotebookAnswerDraft,
} from "@recall/application";
import { createObjectiveId } from "@recall/domain";
import type { KnowledgeNotebookState } from "../useKnowledgeNotebookState";
export function createKnowledgeNotebookPracticeActions(
  model: Pick<
    KnowledgeNotebookState,
    | "api"
    | "current"
    | "run"
    | "goal"
    | "knowledgeArea"
    | "reviewEvents"
    | "clock"
    | "save"
    | "setGoal"
    | "currentTutor"
    | "context"
    | "confidence"
    | "setAnswer"
    | "conceptTitle"
    | "parentId"
    | "setConceptTitle"
    | "assessments"
  >,
) {
  const {
    api,
    current,
    run,
    goal,
    knowledgeArea,
    reviewEvents,
    clock,
    save,
    setGoal,
    currentTutor,
    context,
    confidence,
    setAnswer,
    conceptTitle,
    parentId,
    setConceptTitle,
    assessments,
  } = model;
  function sendChatMessage(message: string) {
    run(
      sendImprovementMessage(
        { notebook: current.current, area: knowledgeArea, reviews: reviewEvents, message },
        {
          api,
          save,
          now: clock,
          createId: () => crypto.randomUUID(),
        },
      ),
      () => {
        setAnswer("");
      },
      () => {
        setAnswer(message);
      },
    );
  }
  function createNotebook() {
    if (current.current || !goal.trim()) return;
    run(seedKnowledgeNotebook(knowledgeArea, goal.trim()).pipe(Effect.flatMap(save)));
  }
  function begin() {
    const existing = current.current;
    run(
      Effect.gen(function* () {
        const seeded = existing
          ? yield* updateNotebookGoal(existing, goal)
          : yield* seedKnowledgeNotebook(knowledgeArea, goal.trim());
        const enriched = yield* appendNotebookReviewEvidence(seeded, knowledgeArea, reviewEvents);
        const started = yield* beginNotebookSession(enriched, {
          startedAt: clock(),
        });
        return yield* save(started);
      }),
    );
  }
  function saveGoal() {
    const existing = current.current;
    if (!existing || !goal.trim()) return;
    run(updateNotebookGoal(existing, goal).pipe(Effect.flatMap(save)), () => {
      setGoal(goal.trim());
    });
  }
  function ask() {
    const existing = current.current;
    if (existing) run(currentTutor().ask(existing, context, clock()).pipe(Effect.flatMap(save)));
  }
  function saveAnswerDraft(answer: string) {
    const existing = current.current;
    if (existing)
      run(
        updateNotebookAnswerDraft(existing, { answer, learnerConfidence: confidence }).pipe(
          Effect.flatMap(save),
        ),
      );
  }
  function submitAnswer(value: string, learnerConfidence = confidence) {
    const existing = current.current;
    if (!existing) return;
    const submitted = value;
    const ai = currentTutor();
    run(
      updateNotebookAnswerDraft(existing, { answer: submitted, learnerConfidence }).pipe(
        Effect.flatMap(save),
        Effect.flatMap((saved) =>
          ai.answer(
            saved,
            { answer: submitted, learnerConfidence, evidenceId: crypto.randomUUID() },
            clock(),
          ),
        ),
        Effect.flatMap(save),
      ),
      () => {
        setAnswer((latest) => (latest === submitted ? "" : latest));
      },
    );
  }
  function control(action: "deeper" | "explain" | "skip" | "finish") {
    const existing = current.current;
    if (!existing) return;
    const ai = currentTutor();
    run(
      controlNotebookSession(existing, { action, now: clock() }).pipe(
        Effect.flatMap(save),
        Effect.flatMap((next) =>
          action === "explain"
            ? ai.ask(next, context, clock()).pipe(Effect.flatMap(save))
            : Effect.succeed(next),
        ),
      ),
    );
  }
  function addConcept() {
    const existing = current.current;
    if (!existing) return;
    run(
      addNotebookConcepts(existing, [
        {
          id: createObjectiveId(crypto.randomUUID()),
          title: conceptTitle.trim(),
          description: null,
          parentId: parentId ? createObjectiveId(parentId) : null,
          prerequisiteIds: [],
          objectiveId: null,
        },
      ]).pipe(Effect.flatMap(save)),
      () => {
        setConceptTitle("");
      },
    );
  }
  function acceptSuggestedConcept(title: string, description: string) {
    const existing = current.current;
    if (!existing) return;
    run(
      addNotebookConcepts(existing, [
        {
          id: createObjectiveId(crypto.randomUUID()),
          title,
          description,
          parentId: existing.session.targetConceptId,
          prerequisiteIds: [],
          objectiveId: null,
        },
      ]).pipe(Effect.flatMap(save)),
    );
  }
  function proposeGaps() {
    const ai = currentTutor();
    const existing = current.current;
    if (!existing) return;
    const targets = assessments.filter(
      (entry) => entry.status === "needs-reinforcement" || entry.status === "uncertain",
    );
    run(
      Effect.gen(function* () {
        let next = existing;
        for (const target of targets) {
          const evidence = [...next.evidence]
            .reverse()
            .find(
              (entry) =>
                entry.kind === "tutor" &&
                entry.conceptId === target.conceptId &&
                entry.providerSessionId &&
                entry.evaluation.suggestedAction === "propose-card",
            );
          if (
            !evidence ||
            next.proposals.some(
              (proposal) =>
                proposal.status !== "discarded" && proposal.evidenceIds.includes(evidence.id),
            )
          )
            continue;
          next = yield* ai.propose(next, evidence.id, knowledgeArea.cards, clock());
          next = yield* save(next);
        }
        return next;
      }),
    );
  }
  return {
    sendChatMessage,
    saveAnswerDraft,
    createNotebook,
    begin,
    saveGoal,
    ask,
    submitAnswer,
    control,
    addConcept,
    acceptSuggestedConcept,
    proposeGaps,
  } as const;
}
