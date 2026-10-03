"use client";

import { useEffect, useState } from "react";
import { Effect, Fiber } from "effect";
import {
  type AnswerEvaluation,
  type CardProposal,
  type KnowledgeGap,
  type TargetedQuizSession,
  type TutorActionRequest,
  type TutorActionResponse,
  type TutorContext,
} from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { tutorApi } from "@/lib/tutor-api";

type DialogueEntry = TutorContext["history"][number];
export type TutorPanelInitialState = {
  readonly history?: readonly DialogueEntry[];
  readonly evaluation?: AnswerEvaluation | null;
  readonly proposal?: CardProposal | null;
  readonly proposalId?: string | null;
  readonly quiz?: TargetedQuizSession | null;
  readonly message?: string | null;
};

export function TutorPanel({
  knowledgeArea,
  onApprove,
  initialState,
  objectiveGaps = [],
  demo = false,
}: {
  knowledgeArea: KnowledgeArea;
  onApprove: (proposal: CardProposal, cardId: string) => void;
  initialState?: TutorPanelInitialState;
  objectiveGaps?: readonly KnowledgeGap[];
  demo?: boolean;
}) {
  const [history, setHistory] = useState<DialogueEntry[]>([...(initialState?.history ?? [])]);
  const [answer, setAnswer] = useState("");
  const [evaluation, setEvaluation] = useState<AnswerEvaluation | null>(
    initialState?.evaluation ?? null,
  );
  const [proposal, setProposal] = useState<CardProposal | null>(initialState?.proposal ?? null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState<string | null>(initialState?.proposalId ?? null);
  const [quiz, setQuiz] = useState<TargetedQuizSession | null>(initialState?.quiz ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialState?.message ?? null);

  useEffect(() => {
    if (demo) return;
    let mounted = true;
    const storageKey = `recall-tutor-session:${knowledgeArea.id}`;
    const restore = Effect.gen(function* () {
      const storedSessionId = yield* Effect.try({
        try: () => window.localStorage.getItem(storageKey),
        catch: () => ({ _tag: "TutorSessionCacheReadError" }) as const,
      });
      if (!storedSessionId) return { _tag: "NoStoredSession" } as const;
      const state = yield* tutorApi.readSession(storedSessionId);
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
        onFailure: () => {
          if (mounted) setMessage("Your previous tutor session could not be restored.");
        },
        onSuccess: (result) => {
          if (!mounted) return;
          if (result._tag === "Restored") {
            setSessionId(result.state.sessionId);
            setHistory([...result.state.history]);
            setEvaluation(result.state.evaluation);
            setProposal(result.state.proposal?.content ?? null);
            setProposalId(result.state.proposal?.proposalId ?? null);
            setQuiz(result.state.quiz);
          }
        },
      }),
    );
    const fiber = Effect.runFork(restore);
    return () => {
      mounted = false;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [demo, knowledgeArea.id]);

  function send(input: TutorActionRequest) {
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
    setMessage(null);
    const program = tutorApi.request(input).pipe(
      Effect.match({
        onFailure: (error) => {
          if (error._tag === "TutorTransportError") {
            setMessage("Connection failed. Try again.");
          } else if (error.reason === "invalid-response") {
            setMessage("The tutor returned an invalid response.");
          } else {
            setMessage(
              error.code === "unauthenticated"
                ? "Sign in to use the AI tutor."
                : (error.code ?? "Tutor request failed."),
            );
          }
        },
        onSuccess: applyResponse,
      }),
      Effect.ensuring(Effect.sync(() => setBusy(false))),
    );
    Effect.runFork(program);
  }

  function applyResponse(response: TutorActionResponse) {
    setSessionId(response.sessionId);
    if (!demo) {
      const persisted = Effect.try({
        try: () =>
          window.localStorage.setItem(
            `recall-tutor-session:${knowledgeArea.id}`,
            response.sessionId,
          ),
        catch: () => ({ _tag: "TutorSessionCacheWriteError" }) as const,
      }).pipe(
        Effect.match({
          onFailure: () =>
            setMessage("Session saved online, but it could not be pinned on this device."),
          onSuccess: () => undefined,
        }),
      );
      Effect.runSync(persisted);
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
      setHistory((current) => [
        ...current,
        { role: "learner", content: answer.trim() },
        { role: "assistant", content: response.result.feedback },
      ]);
      setAnswer("");
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
      setQuiz(response.quiz);
      return;
    }
    setProposalId(response.proposalId);
    setProposal(response.result);
  }

  function resolveProposal(state: "approved" | "rejected") {
    if (!proposalId || !proposal) return;
    const cardId = demo ? "7f07f0d6-6912-48c4-b31b-61a0dbe514ac" : crypto.randomUUID();
    const approvedProposal = {
      ...proposal,
      front: proposal.front.trim(),
      back: proposal.back.trim(),
    };
    if (state === "approved" && (!approvedProposal.front || !approvedProposal.back)) {
      setMessage("Add a question and answer before approving this card.");
      return;
    }
    if (demo) {
      if (state === "approved") onApprove(approvedProposal, cardId);
      setProposal(null);
      setProposalId(null);
      setEvaluation(null);
      return;
    }
    setBusy(true);
    setMessage(null);
    const program = tutorApi
      .resolveProposal({
        proposalId,
        state,
        ...(state === "approved" ? { content: approvedProposal, cardId } : {}),
      })
      .pipe(
        Effect.match({
          onFailure: (error) => {
            setMessage(
              error._tag === "TutorApiFailure" && error.reason === "http" && error.code
                ? error.code
                : "This proposal could not be saved yet. Try again.",
            );
          },
          onSuccess: () => {
            if (state === "approved") onApprove(approvedProposal, cardId);
            setProposal(null);
            setProposalId(null);
            setEvaluation(null);
          },
        }),
        Effect.ensuring(Effect.sync(() => setBusy(false))),
      );
    Effect.runFork(program);
  }

  const context: TutorContext = { knowledgeArea, history };
  const objectiveTitle = (id: string | null) =>
    knowledgeArea.objectives.find((objective) => objective.id === id)?.title ?? "General";
  const visibleGaps = [...objectiveGaps];
  if (evaluation && evaluation.result !== "mastered" && evaluation.objectiveId) {
    const observation = evaluation.misconception ?? evaluation.feedback;
    const existingIndex = visibleGaps.findIndex(
      (gap) => gap.objectiveId === evaluation.objectiveId,
    );
    if (existingIndex < 0) {
      visibleGaps.unshift({
        objectiveId: evaluation.objectiveId,
        objectiveTitle: objectiveTitle(evaluation.objectiveId),
        kind: "tutor-observation",
        severity: evaluation.result === "incorrect" ? "high" : "medium",
        cardCount: 0,
        dueCardCount: 0,
        recentFailureCount: 0,
        evidenceSummary: observation,
      });
    } else {
      const existing = visibleGaps[existingIndex];
      if (existing)
        visibleGaps[existingIndex] = {
          ...existing,
          severity: evaluation.result === "incorrect" ? "high" : existing.severity,
          evidenceSummary: `${existing.evidenceSummary} Tutor feedback: ${observation}`,
        };
    }
  }

  function startTargetedQuiz(gap: KnowledgeGap) {
    send({
      action: "targeted-quiz",
      objectiveId: gap.objectiveId,
      ...(sessionId ? { sessionId } : { context }),
    });
  }

  return (
    <section className="tutor-panel" aria-labelledby="tutor-panel-title">
      <div className="tutor-panel-heading">
        <div>
          <p className="eyebrow">OPTIONAL AI PRACTICE</p>
          <h3 id="tutor-panel-title">Study with a tutor</h3>
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
            disabled={busy}
            onChange={(event) => setProposal({ ...proposal, front: event.target.value })}
          />
          <label htmlFor="tutor-proposal-back">Answer</label>
          <textarea
            id="tutor-proposal-back"
            value={proposal.back}
            maxLength={3000}
            disabled={busy}
            onChange={(event) => setProposal({ ...proposal, back: event.target.value })}
          />
          <small>{proposal.rationale}</small>
          <div>
            <button
              className="text-button"
              type="button"
              disabled={busy || !proposalId}
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
              {busy ? "Saving…" : "Approve card"}
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
