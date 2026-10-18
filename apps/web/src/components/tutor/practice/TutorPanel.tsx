"use client";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { CardAssistancePanel } from "../assistance/CardAssistancePanel";
import { ProposalDuplicateWarning } from "../notebook/proposals/ProposalDuplicateWarning";
import { TutorAnswerEvaluation } from "./TutorAnswerEvaluation";
import { TutorConversationHistory } from "./TutorConversationHistory";
import { TutorProposalActions } from "./proposals/TutorProposalActions";
import { TutorProposalEditor } from "./proposals/TutorProposalEditor";
import { TutorQuestion } from "./TutorQuestion";
import { TutorQuiz } from "./quiz/TutorQuiz";
import { resolveTutorPanelProposal } from "./proposals/tutorPanelResolveProposal";
import { updateTutorQuizAnswer } from "./quiz/tutorQuizAnswers";

import { tutorApi } from "@/lib/tutor-api";
import { tutorPrivacyApi } from "@/lib/tutor-privacy-api";
import {
  type AnswerEvaluation,
  type CardProposal,
  type KnowledgeGap,
  type TargetedQuizSession,
  type TutorContext,
  combineObjectiveGapsWithTutorEvidence,
  selectTutorContextHistory,
  selectTutorInferenceContext,
} from "@recall/ai-core";
import {
  type CardDuplicateCandidate,
  type WorkspaceSearchTarget,
  knowledgeAreaDuplicateCandidates,
} from "@recall/application";
import type { KnowledgeArea, ReviewEvent } from "@recall/domain";
import { Effect, Either } from "effect";
import { type ComponentProps, type ReactNode, useMemo } from "react";
import { KnowledgeNotebookPanel } from "../notebook/KnowledgeNotebookPanel";
import { TutorQuickQuestions } from "./TutorQuickQuestions";
import { applyTutorPanelAssistance } from "./tutorPanelAssistance";
import { useTutorPanelSession } from "./useTutorPanelSession";

type DialogueEntry = TutorContext["history"][number];
function TutorProposalAssistance(props: ComponentProps<typeof CardAssistancePanel>) {
  return <CardAssistancePanel {...props} />;
}

function TutorProposalDuplicateReview({
  approvalSaved,
  ...warningProps
}: Pick<
  ComponentProps<typeof ProposalDuplicateWarning>,
  "matches" | "acknowledged" | "disabled" | "onChange"
> & {
  readonly approvalSaved: boolean;
}) {
  if (approvalSaved) {
    return (
      <small>
        This card is saved on this device. Retry approval using the saved content; another card will
        not be created.
      </small>
    );
  }
  return <ProposalDuplicateWarning {...warningProps} />;
}
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
  reviewEvents,
  onStartReview,
  initialActivity,
  research,
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
  readonly initialActivity?: "materials" | undefined;
  readonly research?: ReactNode;
  clock?: () => number;
  searchTarget?: WorkspaceSearchTarget;
}) {
  const {
    refinementNamespace,
    refinementStore,
    refinementNotebook,
    setRefinementNotebook,
    refinementRevision,
    setRefinementRevision,
    history,
    answer,
    setAnswer,
    evaluation,
    setEvaluation,
    proposal,
    setProposal,
    sessionId,
    proposalId,
    setProposalId,
    quiz,
    setQuiz,
    sessionEvidence,
    busy,
    setBusy,
    pendingQuizQuestionIndex,
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
  } = useTutorPanelSession({
    knowledgeArea,
    duplicateCandidates,
    ...(initialState ? { initialState } : {}),
    demo,
    api,
    sessionNamespace,
  });

  function resolveProposal(state: "approved" | "rejected") {
    resolveTutorPanelProposal(state, {
      proposalId,
      proposal,
      sessionId,
      duplicatesAllowed,
      setMessage,
      approvalEpoch,
      proposalKey,
      setBusy,
      savedApproval,
      setSavedApproval,
      setProposal,
      setProposalId,
      setEvaluation,
      demo,
      api,
      knowledgeArea,
      onApprove,
    });
  }
  const updateDuplicateAcknowledgement = (value: boolean) => {
    setDuplicateAcknowledgement(value ? duplicateKey : null);
  };
  const approveProposal = () => {
    resolveProposal("approved");
  };
  const discardProposal = () => {
    resolveProposal("rejected");
  };
  const changeQuizAnswer = (index: number, learnerAnswer: string) => {
    setQuiz((current) => updateTutorQuizAnswer(current, index, learnerAnswer));
  };
  const submitQuizAnswer = (questionIndex: number) => {
    if (!quiz) return;
    const submittedAnswer = quiz.questions[questionIndex]?.learnerAnswer?.trim();
    if (!submittedAnswer || !sessionId) return;
    send({ action: "evaluate-quiz-answer", sessionId, questionIndex, answer: submittedAnswer });
  };
  const applyAssistance = (result: import("@recall/ai-core").CardRefinementResult) =>
    applyTutorPanelAssistance(result, {
      proposal,
      proposalId,
      sessionId,
      evaluation,
      quiz,
      history,
      demo,
      refinementNotebook,
      refinementStore,
      knowledgeArea,
      clock,
      setProposal,
      setMessage: (nextMessage) => {
        setMessage(nextMessage);
      },
      setRefinementNotebook: (notebook) => {
        setRefinementNotebook(notebook);
      },
      incrementRefinementRevision: () => {
        setRefinementRevision((value) => value + 1);
      },
      clearProposal: () => {
        setProposal(null);
        setProposalId(null);
        setEvaluation(null);
      },
    });

  const proposalAssistance = proposal ? (
    <TutorProposalAssistance
      key={proposalKey ?? "proposal"}
      proposal={proposal}
      knowledgeArea={knowledgeArea}
      duplicateCandidates={duplicateCandidates}
      api={api}
      disabled={busy || approvalSaved}
      onBusyChange={setBusy}
      onApply={applyAssistance}
    />
  ) : undefined;
  const proposalDuplicateReview = proposal ? (
    <TutorProposalDuplicateReview
      approvalSaved={approvalSaved}
      matches={duplicateMatches}
      acknowledged={duplicateAcknowledgement === duplicateKey}
      disabled={busy}
      onChange={updateDuplicateAcknowledgement}
    />
  ) : undefined;
  const proposalActions = proposal ? (
    <TutorProposalActions
      busy={busy}
      approvalSaved={approvalSaved}
      hasProposalId={Boolean(proposalId)}
      duplicatesAllowed={duplicatesAllowed}
      onApprove={approveProposal}
      onDiscard={discardProposal}
    />
  ) : undefined;

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

  return (
    <KnowledgeNotebookPanel
      key={`${sessionNamespace}:${knowledgeArea.id}`}
      knowledgeArea={knowledgeArea}
      initialActivity={initialActivity ?? (initialState ? "quick" : "practice")}
      research={research}
      practiceTopics={visibleGaps}
      onPracticeTopic={startTargetedQuiz}
      quickQuestionsBusy={busy}
      duplicateCandidates={duplicateCandidates}
      api={api}
      sessionNamespace={sessionNamespace}
      {...(searchTarget ? { searchTarget } : {})}
      demo={demo}
      onApprove={onApprove}
      {...(reviewEvents === undefined ? {} : { reviewEvents })}
      {...(onStartReview === undefined ? {} : { onStartReview })}
      additionalSuggestions={
        refinementNotebook?.proposals.length ||
        (searchTarget &&
          "namespace" in searchTarget &&
          searchTarget.namespace === refinementNamespace) ? (
          <KnowledgeNotebookPanel
            key={`${refinementNamespace}:${String(refinementRevision)}`}
            initialActivity="suggestions"
            showActivityNavigation={false}
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
        ) : undefined
      }
      quickQuestions={
        <TutorQuickQuestions>
          <TutorQuestion
            history={history}
            hasQuiz={Boolean(quiz)}
            areaTitle={knowledgeArea.title}
            busy={busy}
            contextValid={!Either.isLeft(contextPreview)}
            answer={answer}
            onAnswerChange={setAnswer}
            showAnswerInput={history.length > 0 && !busy && !evaluation}
            onAskQuestion={() => {
              send({ action: "question", context, ...(sessionId ? { sessionId } : {}) });
            }}
            onCheckAnswer={(submittedAnswer) => {
              if (sessionId) send({ action: "evaluate", sessionId, answer: submittedAnswer });
            }}
          />
          {evaluation && (
            <TutorAnswerEvaluation
              evaluation={evaluation}
              objectiveTitle={objectiveTitle(evaluation.objectiveId)}
              busy={busy}
              canPropose={!proposal}
              onPropose={() => {
                if (sessionId) send({ action: "propose-card", sessionId });
              }}
            />
          )}
          {quiz && (
            <TutorQuiz
              quiz={quiz}
              busy={busy}
              pendingQuestionIndex={pendingQuizQuestionIndex}
              canSubmit={Boolean(sessionId)}
              onAnswerChange={changeQuizAnswer}
              onSubmit={submitQuizAnswer}
            />
          )}
          {proposal && (
            <TutorProposalEditor
              proposal={proposal}
              objectives={knowledgeArea.objectives}
              disabled={busy || approvalSaved}
              onChange={setProposal}
              assistance={proposalAssistance}
              duplicateReview={proposalDuplicateReview}
              actions={proposalActions}
            />
          )}
          <TutorConversationHistory history={history} />
          {busy && history.length > 0 && (
            <p className="flex items-center gap-2 text-xs">Tutor is thinking…</p>
          )}
          {message && (
            <Alert className="mt-2" variant="destructive">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
        </TutorQuickQuestions>
      }
    />
  );
}
