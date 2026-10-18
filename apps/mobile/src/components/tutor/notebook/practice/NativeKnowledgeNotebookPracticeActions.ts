import { Effect, Either } from "effect";
import {
  addNotebookConcepts,
  beginNotebookSession,
  controlNotebookSession,
  createKnowledgeNotebookTutor,
  seedKnowledgeNotebook,
  sendImprovementMessage,
  updateNotebookAnswerDraft,
} from "@recall/application";
import { createObjectiveId } from "@recall/domain";
import { writeNativeKnowledgeNotebook } from "../../../../storage/ai/native-knowledge-notebook-store";
import { failureMessage } from "../NativeKnowledgeNotebookTypes";
import type { NativeNotebookState } from "../useNativeKnowledgeNotebookState";
export function createNativeKnowledgeNotebookPracticeActions(context: NativeNotebookState) {
  const {
    notebook,
    area,
    goal,
    setNotice,
    save,
    conceptTitle,
    createId,
    setConceptTitle,
    runAction,
    api,
    mayWrite,
    unsaved,
    setNotebook,
    setAnswer,
    mounted,
    storageNamespace,
    confidence,
    answer,
  } = context;
  async function sendChatMessage(message: string) {
    if (!api || unsaved || !mayWrite()) return;
    await runAction(async (isCurrent) => {
      const persist = (next: import("@recall/application").KnowledgeNotebook) =>
        Effect.tryPromise({
          try: () => (isCurrent() ? save(next) : Promise.resolve(false)),
          catch: () => ({ message: failureMessage, notebook: next }),
        }).pipe(
          Effect.flatMap((saved) =>
            saved ? Effect.succeed(next) : Effect.fail({ message: failureMessage, notebook: next }),
          ),
        );
      const result = await Effect.runPromise(
        Effect.either(
          sendImprovementMessage(
            { notebook: context.notebookRef.current, area, reviews: context.reviewEvents, message },
            { api, save: persist, now: Date.now, createId },
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(result)) {
        if ("notebook" in result.left && result.left.notebook) await save(result.left.notebook);
        setAnswer(message);
        setNotice(result.left.message);
      } else setAnswer("");
    });
  }
  async function start() {
    const seeded = notebook
      ? Either.right(notebook)
      : Effect.runSync(Effect.either(seedKnowledgeNotebook(area, goal.trim())));
    if (Either.isLeft(seeded)) {
      setNotice("Add a learning goal first.");
      return;
    }
    const begun = Effect.runSync(
      Effect.either(
        beginNotebookSession(seeded.right, {
          startedAt: Date.now(),
        }),
      ),
    );
    if (Either.isRight(begun)) await save(begun.right);
    else setNotice("Practice could not start. Try again.");
  }
  async function addManualConcept() {
    if (!notebook || conceptTitle.trim().length === 0) return;
    const result = Effect.runSync(
      Effect.either(
        addNotebookConcepts(notebook, [
          {
            id: createObjectiveId(createId()),
            title: conceptTitle.trim(),
            description: null,
            parentId: null,
            prerequisiteIds: [],
          },
        ]),
      ),
    );
    if (Either.isLeft(result)) {
      setNotice("Concepts must have a unique title of at most 200 characters.");
      return;
    }
    if (await save(result.right)) setConceptTitle("");
  }
  async function approveSuggestedConcept(suggestion: {
    readonly title: string;
    readonly description: string;
  }) {
    if (!notebook) return;
    const conceptId = createObjectiveId(createId());
    const result = Effect.runSync(
      Effect.either(
        addNotebookConcepts(notebook, [
          {
            id: conceptId,
            title: suggestion.title,
            description: suggestion.description,
            parentId: null,
            prerequisiteIds: [],
          },
        ]),
      ),
    );
    if (Either.isLeft(result)) {
      setNotice("The suggested concept could not be validated.");
      return;
    }
    if (await save(result.right))
      setNotice(`Added “${suggestion.title}” to the notebook for your next investigation.`);
  }
  async function ask() {
    await runAction(async (isCurrent) => askAction(isCurrent));
  }
  async function askAction(isCurrent: () => boolean) {
    if (!notebook || !api || !mayWrite() || unsaved) {
      setNotice(
        api
          ? failureMessage
          : "The tutor is unavailable offline. Your local notebook remains available.",
      );
      return;
    }
    setNotice(null);
    const tutor = createKnowledgeNotebookTutor(api, persistBeforeRequest);
    const response = await Effect.runPromise(
      Effect.either(tutor.ask(notebook, { knowledgeArea: area }, Date.now())),
    );
    if (!isCurrent()) return;
    if (Either.isLeft(response)) {
      if (response.left.notebook) {
        setNotebook(response.left.notebook);
        await save(response.left.notebook);
      }
      setNotice(response.left.message);
      return;
    }
    await save(response.right);
  }
  async function answerQuestion(
    value: string,
    learnerConfidence: "guess" | "unsure" | "confident",
  ) {
    await runAction(async (isCurrent) => answerQuestionAction(value, learnerConfidence, isCurrent));
  }
  async function answerQuestionAction(
    value: string,
    learnerConfidence: "guess" | "unsure" | "confident",
    isCurrent: () => boolean,
  ) {
    if (!notebook || !api || !mayWrite() || unsaved) return;
    setNotice(null);
    const draft = Effect.runSync(
      Effect.either(updateNotebookAnswerDraft(notebook, { answer: value, learnerConfidence })),
    );
    if (Either.isLeft(draft) || !(await save(draft.right)) || !isCurrent()) return;
    const tutor = createKnowledgeNotebookTutor(api, persistBeforeRequest);
    const evidenceId = createId();
    const response = await Effect.runPromise(
      Effect.either(
        tutor.answer(draft.right, { answer: value, learnerConfidence, evidenceId }, Date.now()),
      ),
    );
    if (!isCurrent()) return;
    if (Either.isLeft(response)) {
      if (response.left.notebook) {
        setNotebook(response.left.notebook);
        await save(response.left.notebook);
      }
      setNotice(response.left.message);
      return;
    }
    setAnswer("");
    await save(response.right);
  }
  function persistBeforeRequest(value: unknown) {
    return writeNativeKnowledgeNotebook(
      area.id,
      value,
      () => mounted.current && mayWrite(),
      storageNamespace,
    ).pipe(Effect.mapError(() => ({ message: failureMessage }) as const));
  }
  async function saveAnswerDraft() {
    if (!notebook) return;
    const result = Effect.runSync(
      Effect.either(updateNotebookAnswerDraft(notebook, { answer, learnerConfidence: confidence })),
    );
    if (Either.isLeft(result)) setNotice(result.left.message);
    else if (await save(result.right)) setNotice("Answer draft saved privately on this device.");
  }
  async function control(action: "deeper" | "explain" | "skip" | "finish") {
    if (!notebook) return;
    const result = Effect.runSync(
      Effect.either(controlNotebookSession(notebook, { action, now: Date.now() })),
    );
    if (Either.isRight(result)) await save(result.right);
  }
  return {
    sendChatMessage,
    start,
    addManualConcept,
    approveSuggestedConcept,
    ask,
    answerQuestion,
    persistBeforeRequest,
    saveAnswerDraft,
    control,
  } as const;
}
