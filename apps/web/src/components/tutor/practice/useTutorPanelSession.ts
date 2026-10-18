import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Effect, Either, Fiber } from "effect";
import type {
  AnswerEvaluation,
  CardProposal,
  TargetedQuizSession,
  TutorActionRequest,
  TutorActionResponse,
  TutorContext,
} from "@recall/ai-core";
import {
  tutorApiFailureMessage,
  type CardDuplicateCandidate,
  type KnowledgeNotebook,
} from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { createBrowserKnowledgeNotebookStore } from "@/lib/knowledge-notebook-store";
import { volatileStorage } from "@/lib/volatile-storage";
import type { TutorPanelInitialState } from "./TutorPanel";
import { applyTutorPanelResponse } from "./tutorPanelApplyResponse";
import {
  getInitialTutorPanelSavedApproval,
  getInitialTutorPanelEvidence,
  getTutorPanelProposalKey,
  getTutorPanelDuplicateState,
} from "./proposals/tutorPanelDuplicateState";

type DialogueEntry = TutorContext["history"][number];

export function useTutorPanelSession({
  knowledgeArea,
  duplicateCandidates,
  initialState,
  demo,
  api,
  sessionNamespace,
}: {
  readonly knowledgeArea: KnowledgeArea;
  readonly duplicateCandidates: readonly CardDuplicateCandidate[];
  readonly initialState?: TutorPanelInitialState;
  readonly demo: boolean;
  readonly api: typeof import("@/lib/tutor-api").tutorApi;
  readonly sessionNamespace: string;
}) {
  const restoreEpoch = useRef(0);
  const refinementNamespace = `${sessionNamespace}:card-refinements`;
  const refinementStore = useMemo(
    () => createBrowserKnowledgeNotebookStore(refinementNamespace, knowledgeArea.id),
    [refinementNamespace, knowledgeArea.id],
  );
  const [refinementNotebook, setRefinementNotebook] = useState<KnowledgeNotebook | null>(null);
  const [refinementRevision, setRefinementRevision] = useState(0);
  useEffect(() => {
    if (demo) return;
    let active = true;
    const isActive = () => active;
    void Effect.runPromise(Effect.either(refinementStore.read())).then((result) => {
      if (isActive() && Either.isRight(result)) setRefinementNotebook(result.right);
    });
    return () => {
      active = false;
    };
  }, [demo, refinementStore]);
  const [history, setHistory] = useState<DialogueEntry[]>([...(initialState?.history ?? [])]);
  const [answer, setAnswer] = useState(initialState?.answer ?? "");
  const [evaluation, setEvaluation] = useState<AnswerEvaluation | null>(
    initialState?.evaluation ?? null,
  );
  const [proposal, setProposal] = useState<CardProposal | null>(initialState?.proposal ?? null);
  const [sessionId, setSessionId] = useState<string | null>(initialState?.sessionId ?? null);
  const [proposalId, setProposalId] = useState<string | null>(initialState?.proposalId ?? null);
  const [quiz, setQuiz] = useState<TargetedQuizSession | null>(initialState?.quiz ?? null);
  const [sessionEvidence, setSessionEvidence] = useState<readonly AnswerEvaluation[]>(
    getInitialTutorPanelEvidence(initialState),
  );
  const [busy, setBusy] = useState(false);
  const [pendingQuizQuestionIndex, setPendingQuizQuestionIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(initialState?.message ?? null);

  const proposalKey = getTutorPanelProposalKey(knowledgeArea.id, sessionId, proposalId);
  const [savedApproval, setSavedApproval] = useState(
    getInitialTutorPanelSavedApproval(initialState, proposalKey),
  );
  const approvalSaved = savedApproval?.key === proposalKey;
  const [duplicateAcknowledgement, setDuplicateAcknowledgement] = useState<string | null>(null);
  const duplicateState = getTutorPanelDuplicateState({
    proposal,
    candidates: duplicateCandidates,
    proposalKey,
    approvalSaved,
    acknowledgement: duplicateAcknowledgement,
  });
  const duplicateMatches = duplicateState.matches;
  const duplicateKey = duplicateState.key;
  const duplicatesAllowed = duplicateState.allowed;
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
    const isMounted = () => mounted;
    const epoch = restoreEpoch.current;
    const storageKey = `recall-tutor-session:${sessionNamespace}:${knowledgeArea.id}`;
    const restore = Effect.gen(function* () {
      const storedSessionId = yield* Effect.try({
        try: () => volatileStorage.getItem(storageKey),
        catch: () => ({ _tag: "TutorSessionCacheReadError" }) as const,
      });
      if (!storedSessionId) return { _tag: "NoStoredSession" } as const;
      const state = yield* api.readSession(storedSessionId);
      if (!state) {
        yield* Effect.try({
          try: () => {
            volatileStorage.removeItem(storageKey);
          },
          catch: () => ({ _tag: "TutorSessionCacheWriteError" }) as const,
        });
        return { _tag: "NoStoredSession" } as const;
      }
      const transferred = state.proposal ? yield* refinementStore.read() : null;
      const alreadyTransferred =
        state.proposal &&
        transferred?.proposals.some(
          (entry) =>
            entry.id === state.proposal?.proposalId &&
            entry.status === "discarded" &&
            transferred.proposals.some((child) => child.aiRefinementOf === entry.id),
        );
      return {
        _tag: "Restored",
        state: alreadyTransferred ? { ...state, proposal: null } : state,
      } as const;
    }).pipe(
      Effect.match({
        onFailure: (error) => {
          if (isMounted() && epoch === restoreEpoch.current)
            setMessage(
              error._tag === "TutorApiFailure" || error._tag === "TutorTransportError"
                ? tutorApiFailureMessage(error)
                : "Your previous tutor session could not be restored.",
            );
        },
        onSuccess: (result) => {
          if (!isMounted() || epoch !== restoreEpoch.current) return;
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
  }, [api, demo, knowledgeArea.id, sessionNamespace, refinementStore]);

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
                expectedAnswer: "Use the key concept described in the deck.",
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
      } else if (input.action === "evaluate-quiz-answer") {
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
        onFailure: (error) => {
          setMessage(tutorApiFailureMessage(error));
        },
        onSuccess: (response) => {
          applyResponse(response, submittedAnswer);
        },
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
    applyTutorPanelResponse(response, submittedAnswer, {
      demo,
      knowledgeAreaId: knowledgeArea.id,
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
    });
  }

  const clearTutorState = useCallback(() => {
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
          const keys = Array.from({ length: volatileStorage.length }, (_, index) =>
            volatileStorage.key(index),
          );
          for (const key of keys) if (key?.startsWith(prefix)) volatileStorage.removeItem(key);
        },
        catch: () => ({ _tag: "TutorSessionCacheWriteError" }) as const,
      }).pipe(
        Effect.catchAll(() =>
          Effect.sync(() => {
            setMessage(
              "History cleared. This device could not remove cached session links; they will be checked before restoring.",
            );
          }),
        ),
      ),
    );
  }, [demo, sessionNamespace]);

  useEffect(() => {
    const onCleared = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === sessionNamespace) clearTutorState();
    };
    window.addEventListener("recall-tutor-history-cleared", onCleared);
    return () => {
      window.removeEventListener("recall-tutor-history-cleared", onCleared);
    };
  }, [clearTutorState, sessionNamespace]);

  return {
    restoreEpoch,
    refinementNamespace,
    refinementStore,
    refinementNotebook,
    setRefinementNotebook,
    refinementRevision,
    setRefinementRevision,
    history,
    setHistory,
    answer,
    setAnswer,
    evaluation,
    setEvaluation,
    proposal,
    setProposal,
    sessionId,
    setSessionId,
    proposalId,
    setProposalId,
    quiz,
    setQuiz,
    sessionEvidence,
    setSessionEvidence,
    busy,
    setBusy,
    pendingQuizQuestionIndex,
    setPendingQuizQuestionIndex,
    message,
    setMessage,
    savedApproval,
    setSavedApproval,
    proposalKey,
    approvalSaved,
    duplicateAcknowledgement,
    setDuplicateAcknowledgement,
    duplicateMatches,
    duplicateKey,
    duplicatesAllowed,
    approvalEpoch,
    send,
    applyResponse,
  };
}
