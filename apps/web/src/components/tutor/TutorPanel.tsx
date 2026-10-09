"use client";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { Button, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import { NativeSelect } from "@recall/ui-web/components/native-select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
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
import {
  findCardDuplicates,
  knowledgeAreaDuplicateCandidates,
  type CardDuplicateCandidate,
  tutorApiFailureMessage,
  importTutorProposal,
  applyNotebookRefinement,
  seedKnowledgeNotebook,
  type KnowledgeNotebook,
  type WorkspaceSearchTarget,
} from "@recall/application";
import type { KnowledgeArea, ReviewEvent } from "@recall/domain";
import { tutorApi } from "@/lib/tutor-api";
import { tutorPrivacyApi } from "@/lib/tutor-privacy-api";
import {
  coordinateLocalWrite,
  localWritesBlocked,
} from "@/features/workspace/local-write-coordinator";
import { TutorPrivacyControls } from "./TutorPrivacyControls";
import { ProposalDuplicateWarning } from "./ProposalDuplicateWarning";
import { CardAssistancePanel } from "./CardAssistancePanel";
import { createBrowserKnowledgeNotebookStore } from "@/lib/knowledge-notebook-store";
import { volatileStorage } from "@/lib/volatile-storage";
import { KnowledgeNotebookPanel } from "./KnowledgeNotebookPanel";

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
  duplicateCandidates = knowledgeAreaDuplicateCandidates(knowledgeArea),
  onApprove,
  initialState,
  objectiveGaps = [],
  demo = false,
  api = tutorApi,
  sessionNamespace = "hosted",
  privacyApi = tutorPrivacyApi,
  reviewEvents,
  onStartReview,
  clock = Date.now,
  searchTarget,
}: {
  knowledgeArea: KnowledgeArea;
  readonly duplicateCandidates?: readonly CardDuplicateCandidate[];
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
  reviewEvents?: readonly ReviewEvent[];
  onStartReview?: () => void;
  clock?: () => number;
  searchTarget?: WorkspaceSearchTarget;
}) {
  const restoreEpoch = useRef(0);
  const refinementNamespace = `${sessionNamespace}:card-refinements`;
  const refinementStore = useMemo(
    () => createBrowserKnowledgeNotebookStore(refinementNamespace, knowledgeArea.id),
    [refinementNamespace, knowledgeArea.id],
  );
  const [refinementNotebook, setRefinementNotebook] = useState<KnowledgeNotebook | null>(null);
  const [showRefinementNotebook, setShowRefinementNotebook] = useState(false);
  const [refinementRevision, setRefinementRevision] = useState(0);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (
        searchTarget &&
        "namespace" in searchTarget &&
        searchTarget.namespace === refinementNamespace
      )
        setShowRefinementNotebook(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchTarget, refinementNamespace]);
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
  const [duplicateAcknowledgement, setDuplicateAcknowledgement] = useState<string | null>(null);
  const duplicateMatches = proposal ? findCardDuplicates(proposal, duplicateCandidates) : [];
  const duplicateKey = JSON.stringify([
    proposalKey,
    proposal?.front,
    proposal?.back,
    duplicateMatches.map((match) => match.candidate),
  ]);
  const duplicatesAllowed =
    approvalSaved || duplicateMatches.length === 0 || duplicateAcknowledgement === duplicateKey;
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
        try: () => volatileStorage.getItem(storageKey),
        catch: () => ({ _tag: "TutorSessionCacheReadError" }) as const,
      });
      if (!storedSessionId) return { _tag: "NoStoredSession" } as const;
      const state = yield* api.readSession(storedSessionId);
      if (!state) {
        yield* Effect.try({
          try: () => volatileStorage.removeItem(storageKey),
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
            volatileStorage.setItem(
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
    if (response.action === "propose-card") {
      setProposalId(response.proposalId);
      setProposal(response.result);
    }
  }

  function resolveProposal(state: "approved" | "rejected") {
    if (!proposalId || !proposal || !sessionId) return;
    if (state === "approved" && !duplicatesAllowed) {
      setMessage("Review the possible duplicates and choose Keep both before saving.");
      return;
    }
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
          const keys = Array.from({ length: volatileStorage.length }, (_, index) =>
            volatileStorage.key(index),
          );
          for (const key of keys) if (key?.startsWith(prefix)) volatileStorage.removeItem(key);
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
    <>
      <KnowledgeNotebookPanel
        key={`${sessionNamespace}:${knowledgeArea.id}`}
        knowledgeArea={knowledgeArea}
        duplicateCandidates={duplicateCandidates}
        api={api}
        sessionNamespace={sessionNamespace}
        {...(searchTarget ? { searchTarget } : {})}
        demo={demo}
        onApprove={onApprove}
        {...(reviewEvents === undefined ? {} : { reviewEvents })}
        {...(onStartReview === undefined ? {} : { onStartReview })}
      />
      <Collapsible className="my-5 rounded-xl border border-border bg-card p-5">
        <CollapsibleTrigger className="w-full rounded-md text-left text-base font-semibold hover:text-primary">
          Quick practice
        </CollapsibleTrigger>
        <CollapsibleContent>
          <section
            className="space-y-4 pt-5 [&_[data-slot=label]]:grid [&_[data-slot=label]]:items-start [&_[data-slot=label]]:gap-2 [&_[data-slot=label]]:leading-[1.4] [&_[data-slot=textarea]]:w-full [&_[data-slot=input]]:w-full"
            aria-labelledby="tutor-panel-title"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold" id="tutor-panel-title">
                  Quick practice
                </h2>
              </div>
              {history.length === 0 ? (
                <Button
                  variant="secondary"
                  size="small"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    send({ action: "question", context, ...(sessionId ? { sessionId } : {}) })
                  }
                >
                  {busy ? "Starting…" : "Start"}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="small"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    send({ action: "question", context, ...(sessionId ? { sessionId } : {}) })
                  }
                >
                  Ask another
                </Button>
              )}
            </div>
            {Either.isLeft(contextPreview) && (
              <Alert variant="destructive">
                <AlertDescription>
                  Context is too long. Shorten objective descriptions or AI instructions.
                </AlertDescription>
              </Alert>
            )}
            <Collapsible>
              <CollapsibleTrigger className="w-full text-left font-medium">
                Privacy and history
              </CollapsibleTrigger>
              <CollapsibleContent>
                <TutorPrivacyControls
                  api={privacyApi}
                  demo={demo}
                  local={sessionNamespace.startsWith("chatgpt:")}
                  disabled={busy}
                  onBusyChange={setBusy}
                  onCleared={clearTutorState}
                />
              </CollapsibleContent>
            </Collapsible>
            {visibleGaps.length > 0 && (
              <div
                className="mt-4 rounded-lg border bg-muted/30 p-3"
                aria-labelledby="tutor-gaps-title"
              >
                <h3 className="mb-2 text-sm font-semibold" id="tutor-gaps-title">
                  Practice topics
                </h3>
                {visibleGaps.map((gap) => (
                  <div
                    className="flex items-center justify-between gap-2 border-t py-2"
                    key={gap.objectiveId}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <strong>{gap.objectiveTitle}</strong>
                        {gap.severity === "high" && <span>Priority</span>}
                      </div>
                      <p>{gap.evidenceSummary}</p>
                    </div>
                    <Button
                      variant="secondary"
                      size="small"
                      type="button"
                      disabled={busy}
                      onClick={() => startTargetedQuiz(gap)}
                    >
                      Quiz this objective
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {history.length > 1 && (
              <Collapsible>
                <CollapsibleTrigger className="w-full text-left font-medium">
                  Conversation history
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {history.slice(0, -1).map((entry, index) => (
                    <p
                      className={`mt-3 rounded-lg p-3 text-sm leading-relaxed ${entry.role === "learner" ? "bg-primary/10" : "bg-muted/40"}`}
                      key={`${index}-${entry.role}`}
                    >
                      <strong className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {entry.role === "assistant" ? "Tutor" : "You"}
                      </strong>
                      {entry.content}
                    </p>
                  ))}
                </CollapsibleContent>
              </Collapsible>
            )}
            {history.at(-1) && (
              <p
                className={`mt-3 rounded-lg p-3 text-sm leading-relaxed ${history.at(-1)?.role === "learner" ? "bg-primary/10" : "bg-muted/40"}`}
              >
                <strong className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {history.at(-1)?.role === "assistant" ? "Tutor" : "You"}
                </strong>
                {history.at(-1)?.content}
              </p>
            )}
            {history.length > 0 && !busy && !evaluation && (
              <form
                className="mt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!answer.trim()) return;
                  if (sessionId) send({ action: "evaluate", sessionId, answer: answer.trim() });
                }}
              >
                <Label className="sr-only" htmlFor="tutor-answer">
                  Your answer
                </Label>
                <Textarea
                  id="tutor-answer"
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder="Write your answer…"
                  maxLength={8000}
                  required
                />
                <Button
                  variant="secondary"
                  size="small"
                  type="submit"
                  disabled={busy || !answer.trim()}
                >
                  {busy ? "Checking…" : "Check answer"}
                </Button>
              </form>
            )}
            {evaluation && (
              <div className="mt-3 grid gap-2 text-sm" role="status">
                <span
                  className={`w-fit rounded-full bg-muted px-2 py-1 text-xs capitalize ${evaluation.result === "incorrect" ? "text-rose-400" : evaluation.result === "uncertain" ? "text-amber-300" : evaluation.result === "mastered" ? "text-emerald-300" : "text-blue-300"}`}
                >
                  {evaluation.result}
                </span>
                <span>{Math.round(evaluation.confidence * 100)}% confidence</span>
                <span>Objective: {objectiveTitle(evaluation.objectiveId)}</span>
                {evaluation.misconception && <p>{evaluation.misconception}</p>}
                {evaluation.suggestedAction === "propose-card" && !proposal && (
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (sessionId) send({ action: "propose-card", sessionId });
                    }}
                  >
                    {busy ? "Drafting…" : "Suggest a flashcard"}
                  </Button>
                )}
              </div>
            )}
            {quiz && (
              <div className="my-3 rounded-lg border bg-muted/30 p-4">
                <h3 className="mb-3 text-base font-semibold">{quiz.objectiveTitle}</h3>
                {quiz.questions.map((item, index) => (
                  <div className="grid gap-2 border-t py-3" key={`${quiz.objectiveId}-${index}`}>
                    <strong>
                      {index + 1}. {item.prompt}
                    </strong>
                    {!item.evaluation ? (
                      <form
                        className="mt-3"
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
                        <Label className="sr-only" htmlFor={`tutor-quiz-answer-${index}`}>
                          Your answer to question {index + 1}
                        </Label>
                        <Textarea
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
                                    questionIndex === index
                                      ? { ...question, learnerAnswer }
                                      : question,
                                  ),
                                },
                            );
                          }}
                          placeholder="Write your answer…"
                          maxLength={8000}
                          required
                        />
                        <Button
                          variant="secondary"
                          size="small"
                          type="submit"
                          disabled={busy || !item.learnerAnswer?.trim() || !sessionId}
                        >
                          {busy ? "Checking…" : "Check answer"}
                        </Button>
                      </form>
                    ) : (
                      <div className="mt-3 grid gap-2 text-sm" role="status">
                        <span
                          className={`w-fit rounded-full bg-muted px-2 py-1 text-xs capitalize ${item.evaluation.result === "incorrect" ? "text-rose-400" : item.evaluation.result === "uncertain" ? "text-amber-300" : item.evaluation.result === "mastered" ? "text-emerald-300" : "text-blue-300"}`}
                        >
                          {item.evaluation.result}
                        </span>
                        <span>{Math.round(item.evaluation.confidence * 100)}% confidence</span>
                        <p>{item.evaluation.feedback}</p>
                        <Collapsible>
                          <CollapsibleTrigger className="w-full text-left font-medium">
                            Compare with a sample answer
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <p>{item.expectedAnswer}</p>
                          </CollapsibleContent>
                        </Collapsible>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {proposal && (
              <div className="mt-3 grid gap-2 rounded-lg border bg-muted/30 p-4">
                <h3 className="text-base font-semibold">Suggested card</h3>
                <Label htmlFor="tutor-proposal-front">Question</Label>
                <Textarea
                  id="tutor-proposal-front"
                  value={proposal.front}
                  maxLength={1000}
                  disabled={busy || approvalSaved}
                  onChange={(event) => setProposal({ ...proposal, front: event.target.value })}
                />
                <Label htmlFor="tutor-proposal-back">Answer</Label>
                <Textarea
                  id="tutor-proposal-back"
                  value={proposal.back}
                  maxLength={3000}
                  disabled={busy || approvalSaved}
                  onChange={(event) => setProposal({ ...proposal, back: event.target.value })}
                />
                <Label htmlFor="tutor-proposal-objective">Learning objective</Label>
                <NativeSelect
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
                      <option value={proposal.objectiveId}>
                        Unavailable objective: choose another
                      </option>
                    )}
                  {knowledgeArea.objectives.map((objective) => (
                    <option key={objective.id} value={objective.id}>
                      {objective.title}
                    </option>
                  ))}
                </NativeSelect>
                <Label htmlFor="tutor-proposal-rationale">Why this card helps</Label>
                <Textarea
                  id="tutor-proposal-rationale"
                  value={proposal.rationale}
                  maxLength={1000}
                  disabled={busy || approvalSaved}
                  onChange={(event) => setProposal({ ...proposal, rationale: event.target.value })}
                />
                <CardAssistancePanel
                  key={proposalKey ?? "proposal"}
                  proposal={proposal}
                  knowledgeArea={knowledgeArea}
                  duplicateCandidates={duplicateCandidates}
                  api={api}
                  disabled={busy || approvalSaved}
                  onBusyChange={setBusy}
                  onApply={async (result) => {
                    if (result.cards.length === 1) {
                      const card = result.cards[0];
                      if (!card) return false;
                      setProposal({
                        front: card.front,
                        back: card.back,
                        objectiveId: card.objectiveId,
                        rationale: card.rationale,
                      });
                      return true;
                    }
                    if (!proposalId || !sessionId || !evaluation) {
                      setMessage(
                        "The original tutor evidence is unavailable. Keep this proposal and refine it after continuing the tutor session.",
                      );
                      return false;
                    }
                    const matchingQuizAnswers =
                      quiz?.questions.filter(
                        (item) =>
                          item.learnerAnswer !== null &&
                          JSON.stringify(item.evaluation) === JSON.stringify(evaluation),
                      ) ?? [];
                    const quizEvidence =
                      matchingQuizAnswers.length === 1 ? matchingQuizAnswers[0] : undefined;
                    const learnerIndex = history.reduce(
                      (last, entry, index) => (entry.role === "learner" ? index : last),
                      -1,
                    );
                    const learner = history[learnerIndex];
                    const question = history
                      .slice(0, learnerIndex)
                      .reverse()
                      .find((entry) => entry.role === "assistant");
                    const questionText = quizEvidence?.prompt ?? question?.content;
                    const answerText = quizEvidence?.learnerAnswer ?? learner?.content;
                    if (!questionText || answerText === undefined || answerText === null) {
                      setMessage(
                        "The original question and learner answer are required to preserve the evidence for split cards.",
                      );
                      return false;
                    }
                    const transferred = await Effect.runPromise(
                      Effect.either(
                        Effect.gen(function* () {
                          const existing = demo
                            ? refinementNotebook
                            : yield* refinementStore.read();
                          const seeded =
                            existing ??
                            (yield* seedKnowledgeNotebook(
                              knowledgeArea,
                              "Refine cards suggested from my tutor practice.",
                            ));
                          const imported = yield* importTutorProposal(
                            seeded,
                            knowledgeArea,
                            {
                              proposalId,
                              sessionId,
                              proposal,
                              evaluation,
                              question: questionText,
                              answer: answerText,
                              evidenceId: crypto.randomUUID(),
                              now: clock(),
                            },
                            knowledgeArea.cards,
                          );
                          const revised = yield* applyNotebookRefinement(
                            imported,
                            {
                              proposalId,
                              baseline: proposal,
                              cards: result.cards,
                              newProposalIds: result.cards.map(() => crypto.randomUUID()),
                            },
                            knowledgeArea.cards,
                          );
                          if (!demo) yield* refinementStore.write(revised);
                          return revised;
                        }),
                      ),
                    );
                    if (Either.isLeft(transferred)) {
                      setMessage(transferred.left.message);
                      return false;
                    }
                    setRefinementNotebook(transferred.right);
                    setShowRefinementNotebook(false);
                    setRefinementRevision((value) => value + 1);
                    setProposal(null);
                    setProposalId(null);
                    setEvaluation(null);
                    setMessage(
                      "Split proposals are saved in your refinement notebook. Open it below to review and approve each card. The original proposal's tutor confirmation can be retried there.",
                    );
                    return true;
                  }}
                />
                {approvalSaved && (
                  <small>
                    This card is saved on this device. Retry approval using the saved content;
                    another card will not be created.
                  </small>
                )}
                {!approvalSaved && (
                  <ProposalDuplicateWarning
                    matches={duplicateMatches}
                    acknowledged={duplicateAcknowledgement === duplicateKey}
                    disabled={busy}
                    onChange={(value) => setDuplicateAcknowledgement(value ? duplicateKey : null)}
                  />
                )}
                <div>
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    disabled={busy || !proposalId || approvalSaved}
                    onClick={() => resolveProposal("rejected")}
                  >
                    Discard
                  </Button>
                  <Button
                    variant="secondary"
                    size="small"
                    type="button"
                    disabled={busy || !proposalId || !duplicatesAllowed}
                    onClick={() => resolveProposal("approved")}
                  >
                    {busy ? "Saving…" : approvalSaved ? "Retry approval" : "Approve card"}
                  </Button>
                </div>
              </div>
            )}
            {busy && history.length > 0 && (
              <p className="flex items-center gap-2 text-xs">Tutor is thinking…</p>
            )}
            {message && (
              <Alert className="mt-2" variant="destructive">
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
          </section>
        </CollapsibleContent>
      </Collapsible>
      <Collapsible
        open={Boolean(
          searchTarget &&
          "namespace" in searchTarget &&
          searchTarget.namespace === refinementNamespace,
        )}
      >
        <CollapsibleTrigger className="w-full text-left font-medium">
          Quick practice suggestions
        </CollapsibleTrigger>
        <CollapsibleContent>
          <section
            className="py-5 [&_[data-slot=label]]:grid [&_[data-slot=label]]:items-start [&_[data-slot=label]]:gap-2 [&_[data-slot=label]]:leading-[1.4] [&_[data-slot=textarea]]:w-full [&_[data-slot=input]]:w-full"
            aria-label="Refined tutor proposals"
          >
            <Button
              type="button"
              variant="secondary"
              size="small"
              disabled={busy}
              onClick={() => setShowRefinementNotebook((value) => !value)}
            >
              {showRefinementNotebook ? "Close suggestions" : "Review suggestions"}
            </Button>
            {showRefinementNotebook && (
              <KnowledgeNotebookPanel
                key={`${refinementNamespace}:${refinementRevision}`}
                knowledgeArea={knowledgeArea}
                duplicateCandidates={duplicateCandidates}
                api={api}
                sessionNamespace={refinementNamespace}
                {...(searchTarget ? { searchTarget } : {})}
                demo={demo}
                {...(demo && refinementNotebook ? { initialNotebook: refinementNotebook } : {})}
                onApprove={onApprove}
                {...(onStartReview ? { onStartReview } : {})}
              />
            )}
          </section>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
