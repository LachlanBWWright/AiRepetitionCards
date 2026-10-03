"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Effect, Either, Fiber, Schema } from "effect";
import {
  type AnswerEvaluation,
  type CardProposal,
  type KnowledgeGap,
  type TargetedQuizSession,
  type TutorActionRequest,
  type TutorActionResponse,
  type TutorContext,
  CardProposalSchema,
  cardIdForTutorProposal,
  combineObjectiveGapsWithTutorEvidence,
  selectTutorContextHistory,
  selectTutorInferenceContext,
} from "@recall/ai-core";
import { tutorApiFailureMessage } from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { tutorApi } from "@/lib/tutor-api";
import { tutorPrivacyApi } from "@/lib/tutor-privacy-api";
import {
  coordinateLocalWrite,
  localWritesBlocked,
} from "@/features/workspace/local-write-coordinator";
import { TutorPrivacyControls } from "./TutorPrivacyControls";

type DialogueEntry = TutorContext["history"][number];
export type TutorPanelInitialState = {
  readonly sessionId?: string | null;
  readonly history?: readonly DialogueEntry[];
  readonly evaluation?: AnswerEvaluation | null;
  readonly observations?: readonly AnswerEvaluation[];
  readonly proposal?: CardProposal | null;
  readonly proposalId?: string | null;
  readonly quiz?: TargetedQuizSession | null;
  readonly message?: string | null;
  readonly answer?: string;
  readonly approvalSaved?: boolean;
};

export function TutorPanel({
  knowledgeArea,
  onApprove,
  initialState,
  objectiveGaps = [],
  demo = false,
  api = tutorApi,
  sessionNamespace = "hosted",
  privacyApi = tutorPrivacyApi,
}: {
  knowledgeArea: KnowledgeArea;
  onApprove: (
    proposal: CardProposal,
    cardId: string,
    proposalId: string,
    sessionId: string,
  ) => Promise<CardProposal | null>;
  initialState?: TutorPanelInitialState;
  objectiveGaps?: readonly KnowledgeGap[];
  demo?: boolean;
  api?: typeof tutorApi;
  sessionNamespace?: string;
  privacyApi?: typeof tutorPrivacyApi;
}) {
  const restoreEpoch = useRef(0);
  const [history, setHistory] = useState<DialogueEntry[]>([...(initialState?.history ?? [])]);
  const [answer, setAnswer] = useState(initialState?.answer ?? "");
  const [evaluation, setEvaluation] = useState<AnswerEvaluation | null>(
    initialState?.evaluation ?? null,
  );
  const [proposal, setProposal] = useState<CardProposal | null>(initialState?.proposal ?? null);
  const [sessionId, setSessionId] = useState<string | null>(initialState?.sessionId ?? null);
  const [proposalId, setProposalId] = useState<string | null>(initialState?.proposalId ?? null);
  const [quiz, setQuiz] = useState<TargetedQuizSession | null>(initialState?.quiz ?? null);
  const [sessionEvidence, setSessionEvidence] = useState<readonly AnswerEvaluation[]>([
    ...(initialState?.observations ?? []),
    ...(initialState?.evaluation ? [initialState.evaluation] : []),
    ...(initialState?.quiz?.questions.flatMap((question) =>
      question.evaluation ? [question.evaluation] : [],
    ) ?? []),
  ]);
  const [busy, setBusy] = useState(false);
  const [pendingQuizQuestionIndex, setPendingQuizQuestionIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(initialState?.message ?? null);

  const proposalKey =
    proposalId && sessionId ? `${knowledgeArea.id}:${sessionId}:${proposalId}` : null;
  const [savedApproval, setSavedApproval] = useState<{
    readonly key: string;
    readonly content: CardProposal;
  } | null>(
    initialState?.approvalSaved && initialState.proposal && proposalKey
      ? { key: proposalKey, content: initialState.proposal }
      : null,
  );
  const approvalSaved = savedApproval?.key === proposalKey;
  const approvalEpoch = useRef(0);
  useEffect(() => {
    approvalEpoch.current += 1;
    return () => {
      approvalEpoch.current += 1;
    };
  }, [proposalKey]);

  useEffect(() => {
    if (demo) return;
    let mounted = true;
    const epoch = restoreEpoch.current;
    const storageKey = `recall-tutor-session:${sessionNamespace}:${knowledgeArea.id}`;
    const restore = Effect.gen(function* () {
      const storedSessionId = yield* Effect.try({
        try: () => window.localStorage.getItem(storageKey),
        catch: () => ({ _tag: "TutorSessionCacheReadError" }) as const,
      });
      if (!storedSessionId) return { _tag: "NoStoredSession" } as const;
      const state = yield* api.readSession(storedSessionId);
      if (!state) {
        yield* Effect.try({
          try: () => window.localStorage.removeItem(storageKey),
          catch: () => ({ _tag: "TutorSessionCacheWriteError" }) as const,
        });
        return { _tag: "NoStoredSession" } as const;
      }
      return { _tag: "Restored", state } as const;
    }).pipe(
      Effect.match({
        onFailure: (error) => {
          if (mounted && epoch === restoreEpoch.current)
            setMessage(
              error._tag === "TutorApiFailure" || error._tag === "TutorTransportError"
                ? tutorApiFailureMessage(error)
                : "Your previous tutor session could not be restored.",
            );
        },
        onSuccess: (result) => {
          if (!mounted || epoch !== restoreEpoch.current) return;
          if (result._tag === "Restored") {
            setSessionId(result.state.sessionId);
            setHistory([...result.state.history]);
            setEvaluation(result.state.evaluation);
            setProposal(result.state.proposal?.content ?? null);
            setProposalId(result.state.proposal?.proposalId ?? null);
            setQuiz(result.state.quiz);
            setSessionEvidence([
              ...(result.state.observations ?? []),
              ...(result.state.evaluation ? [result.state.evaluation] : []),
              ...(result.state.quiz?.questions.flatMap((question) =>
                question.evaluation ? [question.evaluation] : [],
              ) ?? []),
            ]);
          }
        },
      }),
    );
    const fiber = Effect.runFork(restore);
    return () => {
      mounted = false;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [api, demo, knowledgeArea.id, sessionNamespace]);

  function send(input: TutorActionRequest) {
    const submittedAnswer = answer;
    if (demo) {
      const mockedSessionId = "bcb3aeb4-91be-4c65-bcb6-2e52041a6824";
      if (input.action === "question") {
        applyResponse({
          action: "question",
          sessionId: mockedSessionId,
          result: {
            question: "What does the mitochondrion provide for a cell?",
            objectiveId: knowledgeArea.objectives[0]?.id ?? null,
            teachingIntent: "Recall the role of a cell structure.",
          },
        });
      } else if (input.action === "evaluate") {
        applyResponse({
          action: "evaluate",
          sessionId: mockedSessionId,
          result: {
            result: "partial",
            confidence: 0.86,
            feedback: "Good start. Name ATP to make the answer more precise.",
            misconception: null,
            objectiveId: knowledgeArea.objectives[0]?.id ?? null,
            suggestedAction: "propose-card",
          },
        });
      } else if (input.action === "propose-card") {
        applyResponse({
          action: "propose-card",
          sessionId: mockedSessionId,
          proposalId: "f82fd14a-3766-498c-8bcb-7114859258da",
          result: {
            front: "What molecule do mitochondria produce to power cell processes?",
            back: "ATP (adenosine triphosphate).",
            objectiveId: knowledgeArea.objectives[0]?.id ?? null,
            rationale: "Targets the missing detail in the learner's answer.",
          },
        });
      } else if (input.action === "targeted-quiz") {
        applyResponse({
          action: "targeted-quiz",
          sessionId: mockedSessionId,
          result: {
            objectiveId: input.objectiveId,
            objectiveTitle:
              knowledgeArea.objectives.find((item) => item.id === input.objectiveId)?.title ??
              "Learning objective",
            questions: [
              {
                prompt: "What key idea explains this objective?",
                expectedAnswer: "Use the key concept described in the learning area.",
              },
              {
                prompt: "How would you apply this idea to a new example?",
                expectedAnswer: "Explain the concept and connect it to the example.",
              },
              {
                prompt: "What detail distinguishes this from a related concept?",
                expectedAnswer: "Name a defining feature from the learning material.",
              },
            ],
          },
        });
      } else {
        const currentQuiz = quiz;
        const question = currentQuiz?.questions[input.questionIndex];
        if (!currentQuiz || !question) return;
        const result: AnswerEvaluation = {
          result: "partial",
          confidence: 0.93,
          feedback: "Good recall. Add how cellular respiration makes ATP for a complete answer.",
          misconception: null,
          objectiveId: currentQuiz.objectiveId,
          suggestedAction: "explain",
        };
        applyResponse({
          action: "evaluate-quiz-answer",
          sessionId: mockedSessionId,
          questionIndex: input.questionIndex,
          result,
          quiz: {
            ...currentQuiz,
            questions: currentQuiz.questions.map((item, index) =>
              index === input.questionIndex
                ? { ...item, learnerAnswer: input.answer, evaluation: result }
                : item,
            ),
          },
        });
      }
      return;
    }
    setBusy(true);
    setPendingQuizQuestionIndex(
      input.action === "evaluate-quiz-answer" ? input.questionIndex : null,
    );
    setMessage(null);
    const program = api.request(input).pipe(
      Effect.match({
        onFailure: (error) => setMessage(tutorApiFailureMessage(error)),
        onSuccess: (response) => applyResponse(response, submittedAnswer),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          setBusy(false);
          setPendingQuizQuestionIndex(null);
        }),
      ),
    );
    Effect.runFork(program);
  }

  function applyResponse(response: TutorActionResponse, submittedAnswer = answer) {
    setSessionId(response.sessionId);
    if (!demo && !localWritesBlocked()) {
      const persisted = coordinateLocalWrite(
        Effect.try({
          try: () =>
            window.localStorage.setItem(
              `recall-tutor-session:${sessionNamespace}:${knowledgeArea.id}`,
              response.sessionId,
            ),
          catch: () => ({ _tag: "TutorSessionCacheWriteError" }) as const,
        }),
        () => ({ _tag: "TutorSessionCacheWriteError" }) as const,
      ).pipe(
        Effect.match({
          onFailure: () => setMessage("Session saved, but it could not be pinned on this device."),
          onSuccess: () => undefined,
        }),
      );
      Effect.runFork(persisted);
    }
    if (response.action === "question") {
      setHistory((current) => [
        ...current,
        { role: "assistant", content: response.result.question },
      ]);
      setEvaluation(null);
      setProposal(null);
      setQuiz(null);
      return;
    }
    if (response.action === "evaluate") {
      setEvaluation(response.result);
      setSessionEvidence((current) => [...current, response.result]);
      setHistory((current) => [
        ...current,
        { role: "learner", content: submittedAnswer.trim() },
        { role: "assistant", content: response.result.feedback },
      ]);
      setAnswer((current) => (current === submittedAnswer ? "" : current));
      setQuiz(null);
      return;
    }
    if (response.action === "targeted-quiz") {
      setQuiz({
        ...response.result,
        questions: response.result.questions.map((item) => ({
          ...item,
          learnerAnswer: null,
          evaluation: null,
        })),
      });
      setEvaluation(null);
      setProposal(null);
      return;
    }
    if (response.action === "evaluate-quiz-answer") {
      setQuiz((current) => {
        const sameQuiz =
          current?.objectiveId === response.quiz.objectiveId &&
          current.questions.length === response.quiz.questions.length &&
          current.questions.every((question, index) => {
            const returned = response.quiz.questions[index];
            return (
              returned?.prompt === question.prompt &&
              returned.expectedAnswer === question.expectedAnswer
            );
          });
        if (!sameQuiz) return response.quiz;
        return {
          ...response.quiz,
          questions: response.quiz.questions.map((question, index) => {
            const local = current.questions[index];
            if (!question.evaluation && local?.evaluation) return local;
            return !question.evaluation &&
              local?.learnerAnswer !== null &&
              local?.learnerAnswer !== undefined
              ? { ...question, learnerAnswer: local.learnerAnswer }
              : question;
          }),
        };
      });
      setEvaluation(response.result);
      setSessionEvidence((current) => [...current, response.result]);
      return;
    }
    setProposalId(response.proposalId);
    setProposal(response.result);
  }

  function resolveProposal(state: "approved" | "rejected") {
    if (!proposalId || !proposal || !sessionId) return;
    const cardId = demo
      ? "7f07f0d6-6912-48c4-b31b-61a0dbe514ac"
      : cardIdForTutorProposal(proposalId);
    if (!cardId) {
      setMessage("This proposal has an invalid identifier and cannot be approved.");
      return;
    }
    const decoded = Schema.decodeUnknownEither(CardProposalSchema)({
      ...proposal,
      front: proposal.front.trim(),
      back: proposal.back.trim(),
      rationale: proposal.rationale.trim(),
    });
    if (
      state === "approved" &&
      (Either.isLeft(decoded) ||
        (decoded.right.objectiveId !== null &&
          !knowledgeArea.objectives.some(
            (objective) => objective.id === decoded.right.objectiveId,
          )))
    ) {
      setMessage(
        "Write a question, answer and rationale within the field limits, and choose an objective from this area.",
      );
      return;
    }
    const approvedProposal = Either.isRight(decoded) ? decoded.right : proposal;
    const epoch = approvalEpoch.current;
    const key = proposalKey;
    if (!key) return;
    const currentApproval = () => approvalEpoch.current === epoch;
    setBusy(true);
    setMessage(null);
    const program = Effect.gen(function* () {
      let savedProposal = approvedProposal;
      if (state === "approved") {
        const saved =
          savedApproval?.key === key
            ? savedApproval.content
            : yield* Effect.tryPromise({
                try: () => onApprove(approvedProposal, cardId, proposalId, sessionId),
                catch: () => ({ _tag: "TutorLocalApprovalFailed" }) as const,
              });
        if (!currentApproval()) return yield* Effect.fail({ _tag: "TutorApprovalStale" } as const);
        if (!saved) return yield* Effect.fail({ _tag: "TutorLocalApprovalFailed" } as const);
        savedProposal = saved;
        setSavedApproval({ key, content: saved });
        setProposal(saved);
        if (
          saved.front !== approvedProposal.front ||
          saved.back !== approvedProposal.back ||
          saved.objectiveId !== approvedProposal.objectiveId ||
          saved.rationale !== approvedProposal.rationale
        )
          return yield* Effect.fail({ _tag: "TutorSavedContentRestored" } as const);
      }
      if (demo) return;
      return yield* api.resolveProposal({
        proposalId,
        state,
        ...(state === "approved" ? { content: savedProposal, cardId } : {}),
      });
    }).pipe(
      Effect.match({
        onFailure: (error) => {
          if (!currentApproval()) return;
          setMessage(
            error._tag === "TutorSavedContentRestored"
              ? "This proposal already has a saved card. Its durable content has been restored without overwriting it. Retry approval to confirm that saved card."
              : error._tag === "TutorLocalApprovalFailed"
                ? "The card could not be saved locally. Your proposal and edits are still available to retry."
                : error._tag === "TutorApiFailure" || error._tag === "TutorTransportError"
                  ? tutorApiFailureMessage(error)
                  : "This proposal could not be saved yet. Try again.",
          );
        },
        onSuccess: () => {
          if (!currentApproval()) return;
          setProposal(null);
          setProposalId(null);
          setEvaluation(null);
        },
      }),
      Effect.ensuring(
        Effect.sync(() => {
          if (currentApproval()) setBusy(false);
        }),
      ),
    );
    Effect.runFork(program);
  }

  const contextPreview = useMemo(
    () =>
      Effect.runSync(
        Effect.either(
          selectTutorInferenceContext(
            {
              knowledgeArea,
              history: selectTutorContextHistory(history),
            },
            undefined,
            evaluation?.objectiveId,
          ),
        ),
      ),
    [knowledgeArea, history, evaluation?.objectiveId],
  );
  const context: TutorContext = {
    knowledgeArea,
    history: selectTutorContextHistory(history),
  };
  const objectiveTitle = (id: string | null) =>
    knowledgeArea.objectives.find((objective) => objective.id === id)?.title ?? "General";
  const visibleGaps = combineObjectiveGapsWithTutorEvidence(knowledgeArea, objectiveGaps, [
    ...sessionEvidence,
    ...(quiz?.questions.flatMap((question) => (question.evaluation ? [question.evaluation] : [])) ??
      []),
  ]);

  function startTargetedQuiz(gap: KnowledgeGap) {
    send({
      action: "targeted-quiz",
      objectiveId: gap.objectiveId,
      ...(sessionId ? { sessionId } : { context }),
    });
  }

  function clearTutorState() {
    restoreEpoch.current += 1;
    setHistory([]);
    setAnswer("");
    setEvaluation(null);
    setProposal(null);
    setSessionId(null);
    setProposalId(null);
    setQuiz(null);
    setSessionEvidence([]);
    setMessage(null);
    if (demo) return;
    Effect.runFork(
      Effect.try({
        try: () => {
          const prefix = `recall-tutor-session:${sessionNamespace}:`;
          const keys = Array.from({ length: window.localStorage.length }, (_, index) =>
            window.localStorage.key(index),
          );
          for (const key of keys) if (key?.startsWith(prefix)) window.localStorage.removeItem(key);
        },
        catch: () => ({ _tag: "TutorSessionCacheWriteError" }) as const,
      }).pipe(
        Effect.catchAll(() =>
          Effect.sync(() =>
            setMessage(
              "History cleared. This device could not remove cached session links; they will be checked before restoring.",
            ),
          ),
        ),
      ),
    );
  }

  return (
    <section className="tutor-panel" aria-labelledby="tutor-panel-title">
      <div className="tutor-panel-heading">
        <div>
          <p className="eyebrow">OPTIONAL AI PRACTICE</p>
          <h2 id="tutor-panel-title">Study with a tutor</h2>
        </div>
        {history.length === 0 ? (
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() =>
              send({ action: "question", context, ...(sessionId ? { sessionId } : {}) })
            }
          >
            {busy ? "Starting…" : "Start"}
          </button>
        ) : (
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() =>
              send({ action: "question", context, ...(sessionId ? { sessionId } : {}) })
            }
          >
            Ask another
          </button>
        )}
      </div>
      <p className="tutor-context-status" role="status">
        {Either.isRight(contextPreview)
          ? `Tutor context: ${contextPreview.right.knowledgeArea.cards.length} of ${knowledgeArea.cards.length} cards, with objective definitions and AI instructions retained.`
          : "Required context exceeds the tutor budget. Shorten objective descriptions or AI instructions."}
      </p>
      <TutorPrivacyControls
        api={privacyApi}
        demo={demo}
        local={sessionNamespace.startsWith("chatgpt:")}
        disabled={busy}
        onBusyChange={setBusy}
        onCleared={clearTutorState}
      />
      {visibleGaps.length > 0 && (
        <div className="tutor-gaps" aria-labelledby="tutor-gaps-title">
          <p className="eyebrow" id="tutor-gaps-title">
            OBJECTIVES TO PRACTICE
          </p>
          {visibleGaps.map((gap) => (
            <div className="tutor-gap" key={gap.objectiveId}>
              <div>
                <div className="tutor-gap-heading">
                  <strong>{gap.objectiveTitle}</strong>
                  <StatusBadge tone={gap.severity === "high" ? "warning" : "neutral"}>
                    {gap.severity === "high" ? "Priority" : "Practice"}
                  </StatusBadge>
                </div>
                <p>{gap.evidenceSummary}</p>
              </div>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => startTargetedQuiz(gap)}
              >
                Quiz this objective
              </button>
            </div>
          ))}
        </div>
      )}
      {history.map((entry, index) => (
        <p className={`tutor-message tutor-${entry.role}`} key={`${index}-${entry.role}`}>
          <strong>{entry.role === "assistant" ? "Tutor" : "You"}</strong>
          {entry.content}
        </p>
      ))}
      {history.length > 0 && !busy && !evaluation && (
        <form
          className="tutor-answer-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!answer.trim()) return;
            if (sessionId) send({ action: "evaluate", sessionId, answer: answer.trim() });
          }}
        >
          <label className="visually-hidden" htmlFor="tutor-answer">
            Your answer
          </label>
          <textarea
            id="tutor-answer"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Write your answer…"
            maxLength={8000}
            required
          />
          <button className="text-button" type="submit" disabled={busy || !answer.trim()}>
            {busy ? "Checking…" : "Check answer"}
          </button>
        </form>
      )}
      {evaluation && (
        <div className="tutor-evaluation" role="status">
          <span className={`history-rating rating-${evaluation.result}`}>{evaluation.result}</span>
          <span>{Math.round(evaluation.confidence * 100)}% confidence</span>
          <span>Objective: {objectiveTitle(evaluation.objectiveId)}</span>
          {evaluation.misconception && <p>{evaluation.misconception}</p>}
          {evaluation.suggestedAction === "propose-card" && !proposal && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                if (sessionId) send({ action: "propose-card", sessionId });
              }}
            >
              {busy ? "Drafting…" : "Suggest a flashcard"}
            </button>
          )}
        </div>
      )}
      {quiz && (
        <div className="tutor-quiz">
          <p className="eyebrow">TARGETED SELF-CHECK · {quiz.objectiveTitle}</p>
          {quiz.questions.map((item, index) => (
            <div className="tutor-quiz-question" key={`${quiz.objectiveId}-${index}`}>
              <strong>
                {index + 1}. {item.prompt}
              </strong>
              {!item.evaluation ? (
                <form
                  className="tutor-answer-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const submittedAnswer = item.learnerAnswer?.trim();
                    if (!submittedAnswer || !sessionId) return;
                    send({
                      action: "evaluate-quiz-answer",
                      sessionId,
                      questionIndex: index,
                      answer: submittedAnswer,
                    });
                  }}
                >
                  <label className="visually-hidden" htmlFor={`tutor-quiz-answer-${index}`}>
                    Your answer to question {index + 1}
                  </label>
                  <textarea
                    id={`tutor-quiz-answer-${index}`}
                    disabled={busy && pendingQuizQuestionIndex === index}
                    value={item.learnerAnswer ?? ""}
                    onChange={(event) => {
                      const learnerAnswer = event.target.value;
                      setQuiz(
                        (current) =>
                          current && {
                            ...current,
                            questions: current.questions.map((question, questionIndex) =>
                              questionIndex === index ? { ...question, learnerAnswer } : question,
                            ),
                          },
                      );
                    }}
                    placeholder="Write your answer…"
                    maxLength={8000}
                    required
                  />
                  <button
                    className="text-button"
                    type="submit"
                    disabled={busy || !item.learnerAnswer?.trim() || !sessionId}
                  >
                    {busy ? "Checking…" : "Check answer"}
                  </button>
                </form>
              ) : (
                <div className="tutor-evaluation" role="status">
                  <span className={`history-rating rating-${item.evaluation.result}`}>
                    {item.evaluation.result}
                  </span>
                  <span>{Math.round(item.evaluation.confidence * 100)}% confidence</span>
                  <p>{item.evaluation.feedback}</p>
                  <details>
                    <summary>Compare with a sample answer</summary>
                    <p>{item.expectedAnswer}</p>
                  </details>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {proposal && (
        <div className="tutor-proposal">
          <p className="eyebrow">CARD PROPOSAL · REVIEW BEFORE ADDING</p>
          <label htmlFor="tutor-proposal-front">Question</label>
          <textarea
            id="tutor-proposal-front"
            value={proposal.front}
            maxLength={1000}
            disabled={busy || approvalSaved}
            onChange={(event) => setProposal({ ...proposal, front: event.target.value })}
          />
          <label htmlFor="tutor-proposal-back">Answer</label>
          <textarea
            id="tutor-proposal-back"
            value={proposal.back}
            maxLength={3000}
            disabled={busy || approvalSaved}
            onChange={(event) => setProposal({ ...proposal, back: event.target.value })}
          />
          <label htmlFor="tutor-proposal-objective">Learning objective</label>
          <select
            id="tutor-proposal-objective"
            value={proposal.objectiveId ?? ""}
            disabled={busy || approvalSaved}
            onChange={(event) =>
              setProposal({ ...proposal, objectiveId: event.target.value || null })
            }
          >
            <option value="">No objective</option>
            {proposal.objectiveId &&
              !knowledgeArea.objectives.some(
                (objective) => objective.id === proposal.objectiveId,
              ) && (
                <option value={proposal.objectiveId}>Unavailable objective: choose another</option>
              )}
            {knowledgeArea.objectives.map((objective) => (
              <option key={objective.id} value={objective.id}>
                {objective.title}
              </option>
            ))}
          </select>
          <label htmlFor="tutor-proposal-rationale">Why this card helps</label>
          <textarea
            id="tutor-proposal-rationale"
            value={proposal.rationale}
            maxLength={1000}
            disabled={busy || approvalSaved}
            onChange={(event) => setProposal({ ...proposal, rationale: event.target.value })}
          />
          {approvalSaved && (
            <small>
              This card is saved on this device. Retry approval using the saved content; another
              card will not be created.
            </small>
          )}
          <div>
            <button
              className="text-button"
              type="button"
              disabled={busy || !proposalId || approvalSaved}
              onClick={() => resolveProposal("rejected")}
            >
              Discard
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy || !proposalId}
              onClick={() => resolveProposal("approved")}
            >
              {busy ? "Saving…" : approvalSaved ? "Retry approval" : "Approve card"}
            </button>
          </div>
        </div>
      )}
      {busy && history.length > 0 && <p className="saved-state">Tutor is thinking…</p>}
      {message && (
        <p className="tutor-error" role="alert">
          {message}
        </p>
      )}
    </section>
  );
}
