import { Effect } from "effect";
import type { Dispatch, SetStateAction } from "react";
import type {
  AnswerEvaluation,
  CardProposal,
  TargetedQuizSession,
  TutorActionResponse,
  TutorContext,
} from "@recall/ai-core";
import {
  coordinateLocalWrite,
  localWritesBlocked,
} from "@/features/workspace/local-write-coordinator";
import { volatileStorage } from "@/lib/volatile-storage";

type DialogueEntry = TutorContext["history"][number];

export function applyTutorPanelResponse(
  response: TutorActionResponse,
  submittedAnswer: string,
  dependencies: {
    readonly demo: boolean;
    readonly knowledgeAreaId: string;
    readonly sessionNamespace: string;
    readonly setSessionId: Dispatch<SetStateAction<string | null>>;
    readonly setMessage: Dispatch<SetStateAction<string | null>>;
    readonly setHistory: Dispatch<SetStateAction<DialogueEntry[]>>;
    readonly setEvaluation: Dispatch<SetStateAction<AnswerEvaluation | null>>;
    readonly setProposal: Dispatch<SetStateAction<CardProposal | null>>;
    readonly setProposalId: Dispatch<SetStateAction<string | null>>;
    readonly setQuiz: Dispatch<SetStateAction<TargetedQuizSession | null>>;
    readonly setSessionEvidence: Dispatch<SetStateAction<readonly AnswerEvaluation[]>>;
    readonly setAnswer: Dispatch<SetStateAction<string>>;
  },
): void {
  const {
    demo,
    knowledgeAreaId,
    sessionNamespace,
    setSessionId,
    setMessage,
    setHistory,
    setEvaluation,
    setProposal,
    setProposalId,
    setQuiz,
    setSessionEvidence,
    setAnswer,
  } = dependencies;

  setSessionId(response.sessionId);
  if (!demo && !localWritesBlocked()) {
    const persisted = coordinateLocalWrite(
      Effect.try({
        try: () => {
          volatileStorage.setItem(
            `recall-tutor-session:${sessionNamespace}:${knowledgeAreaId}`,
            response.sessionId,
          );
        },
        catch: () => ({ _tag: "TutorSessionCacheWriteError" }) as const,
      }),
      () => ({ _tag: "TutorSessionCacheWriteError" }) as const,
    ).pipe(
      Effect.match({
        onFailure: () => {
          setMessage("Session saved, but it could not be pinned on this device.");
        },
        onSuccess: () => undefined,
      }),
    );
    Effect.runFork(persisted);
  }

  if (response.action === "question") {
    setHistory((current) => [...current, { role: "assistant", content: response.result.question }]);
    setEvaluation(null);
    setProposal(null);
    setQuiz(() => null);
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
    setQuiz(() => null);
    return;
  }
  if (response.action === "targeted-quiz") {
    setQuiz(() => ({
      ...response.result,
      questions: response.result.questions.map((item) => ({
        ...item,
        learnerAnswer: null,
        evaluation: null,
      })),
    }));
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
  if (response.action === "propose-card") {
    setProposalId(response.proposalId);
    setProposal(response.result);
  }
}
