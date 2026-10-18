import { NativeButton } from "../../ui/NativeButton";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { Effect, Either } from "effect";
import type { TutorSessionState } from "@recall/ai-core";
import type { CardProposal, KnowledgeGap } from "@recall/ai-core";
import { NativeKnowledgeNotebookPanel } from "../notebook/NativeKnowledgeNotebookPanel";
import type { ReviewEvent, KnowledgeArea } from "@recall/domain";
import {
  findCardDuplicates,
  knowledgeAreaDuplicateCandidates,
  type CardDuplicateCandidate,
  type WorkspaceSearchTarget,
  tutorApiFailureMessage,
} from "@recall/application";
import { designTokens } from "@recall/design-tokens";
import type { makeNativeTutorApi } from "../../../storage/ai/native-tutor-api";
import { readNativeKnowledgeNotebook } from "../../../storage/ai/native-knowledge-notebook-store";

const palette = designTokens.color;
import { useNativeTutorProposalWorkflows } from "./NativeTutorPanelProposalWorkflows";
import { useNativeTutorSessionWorkflows } from "./NativeTutorPanelSessionWorkflows";
import { NativeTutorPanelConversation } from "./NativeTutorPanelConversation";
import { NativeTutorQuiz, NativeTutorQuizHistory } from "./quiz/NativeTutorQuiz";
import { NativeTutorQuizControls } from "./quiz/NativeTutorQuizControls";
import { NativeTutorPanelProposalEditor } from "./NativeTutorPanelProposalEditor";

type TutorApi = ReturnType<typeof makeNativeTutorApi>;

export function NativeTutorPanel({
  area,
  searchTarget,
  duplicateCandidates = area ? knowledgeAreaDuplicateCandidates(area) : [],
  reviewEvents = [],
  mayWrite = () => true,
  api,
  createId,
  initialSessionId,
  onSessionIdChange,
  onApproveProposal,
  onStartReview,
  initialActivity,
  objectiveGaps = [],
  initialProposalDraft,
  initialNotice = null,
  initialAnswer = "",
  storageScope,
}: {
  readonly onStartReview?: () => void;
  readonly initialActivity?: "materials" | undefined;
  readonly initialProposalDraft?: { readonly proposalId: string; readonly content: CardProposal };
  readonly storageScope?: string | undefined;
  readonly initialNotice?: string | null;
  readonly initialAnswer?: string;
  readonly area: KnowledgeArea | null;
  readonly searchTarget?: WorkspaceSearchTarget | undefined;
  readonly duplicateCandidates?: readonly CardDuplicateCandidate[];
  readonly reviewEvents?: readonly ReviewEvent[];
  readonly mayWrite?: () => boolean;
  readonly api: TutorApi | null;
  readonly createId: () => string;
  readonly initialSessionId: string | null;
  readonly objectiveGaps?: readonly KnowledgeGap[];
  readonly onSessionIdChange: (sessionId: string) => void;
  readonly onApproveProposal: (
    proposal: CardProposal,
    proposalId: string,
    sessionId: string,
  ) => Promise<{ readonly cardId: string; readonly content: CardProposal } | null>;
}) {
  const notebookNamespace = storageScope
    ? `knowledge-notebook:${storageScope}`
    : "knowledge-notebook";
  const refinementNamespace = storageScope
    ? `knowledge-notebook:card-refinements:${storageScope}`
    : "knowledge-notebook:card-refinements";
  const [notebookReload, setNotebookReload] = useState(0);
  const [showRefinementNotebook, setShowRefinementNotebook] = useState(false);
  useEffect(() => {
    if (
      !searchTarget ||
      !("namespace" in searchTarget) ||
      searchTarget.namespace !== refinementNamespace
    )
      return;
    const frame = requestAnimationFrame(() => {
      setShowRefinementNotebook(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [searchTarget, refinementNamespace]);
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [session, setSession] = useState<TutorSessionState | null>(null);
  const [question, setQuestion] = useState("");
  const [tutorReply, setTutorReply] = useState("");
  const [answer, setAnswer] = useState(initialAnswer);
  const [quizAnswer, setQuizAnswer] = useState("");
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [busy, setBusy] = useState(false);
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<string | null>(null);

  const proposalKey = session?.proposal
    ? `${String(area?.id)}:${String(sessionId)}:${session.proposal.proposalId}`
    : null;
  const [draft, setDraft] = useState<{
    readonly key: string;
    readonly content: CardProposal;
  } | null>(null);
  const [savedApproval, setSavedApproval] = useState<{
    readonly key: string;
    readonly cardId: string;
    readonly content: CardProposal;
  } | null>(null);
  const proposalContent = session?.proposal
    ? draft?.key === proposalKey
      ? draft.content
      : initialProposalDraft?.proposalId === session.proposal.proposalId
        ? initialProposalDraft.content
        : session.proposal.content
    : null;
  const approvalSaved = savedApproval?.key === proposalKey;
  const [duplicateAcknowledgement, setDuplicateAcknowledgement] = useState<string | null>(null);
  const duplicateMatches = proposalContent
    ? findCardDuplicates(proposalContent, duplicateCandidates)
    : [];
  const duplicateKey = JSON.stringify([
    proposalKey,
    proposalContent?.front,
    proposalContent?.back,
    duplicateMatches.map((match) => match.candidate),
  ]);
  const duplicatesAllowed =
    approvalSaved || duplicateMatches.length === 0 || duplicateAcknowledgement === duplicateKey;
  function editProposal(field: "front" | "back" | "rationale", value: string) {
    if (proposalKey && proposalContent && !approvalSaved)
      setDraft({ key: proposalKey, content: { ...proposalContent, [field]: value } });
  }

  const areaId = area?.id;
  useEffect(() => {
    const currentSessionId = sessionId ?? initialSessionId;
    if (!api || !currentSessionId) return;
    let active = true;
    const isActive = () => active;
    void Effect.runPromise(Effect.either(api.readSession(currentSessionId))).then(
      async (result) => {
        if (!isActive()) return;
        if (Either.isRight(result)) {
          setSessionId(result.right ? currentSessionId : null);
          let restored = result.right;
          if (areaId && restored?.proposal) {
            const restoredProposalId = restored.proposal.proposalId;
            const local = await Effect.runPromise(
              Effect.either(readNativeKnowledgeNotebook(areaId, refinementNamespace)),
            );
            if (!isActive()) return;
            if (Either.isLeft(local))
              setNotice("The refinement notebook could not be read. Its saved data was preserved.");
            else if (
              local.right?.proposals.some(
                (proposal) => proposal.id === restoredProposalId && proposal.status === "discarded",
              ) &&
              local.right.proposals.some(
                (proposal) => proposal.aiRefinementOf === restoredProposalId,
              )
            ) {
              restored = { ...restored, proposal: null };
            }
          }
          setSession(restored);
        } else setNotice(tutorApiFailureMessage(result.left));
      },
    );
    return () => {
      active = false;
    };
  }, [api, sessionId, initialSessionId, areaId, refinementNamespace]);

  const { request, ask, startQuiz, evaluateAnswer, evaluateQuizAnswer } =
    useNativeTutorSessionWorkflows({
      area,
      api,
      objectiveGaps,
      selectedObjectiveId,
      session,
      sessionId,
      question,
      answer,
      quizAnswer,
      setSessionId,
      setSession,
      setQuestion,
      setAnswer,
      setQuizAnswer,
      setTutorReply,
      setNotice,
      setBusy,
      onSessionIdChange,
    });

  const { assistProposal, inspectProposal, keepRefinement, resolveProposal } =
    useNativeTutorProposalWorkflows({
      area,
      api,
      mayWrite,
      proposalContent,
      proposalKey,
      approvalSaved,
      session,
      sessionId,
      refinementNamespace,
      duplicatesAllowed,
      setBusy,
      setNotice,
      setDraft,
      setSession,
      setNotebookReload,
      setShowRefinementNotebook,
      savedApproval,
      setSavedApproval,
      onApproveProposal,
      createId,
    });

  if (!area) return null;
  return (
    <View testID="native-tutor-panel" className={"gap-[10px] mt-[12px]"}>
      <NativeKnowledgeNotebookPanel
        storageNamespace={notebookNamespace}
        area={area}
        searchTarget={
          searchTarget &&
          "namespace" in searchTarget &&
          searchTarget.namespace === notebookNamespace
            ? searchTarget
            : undefined
        }
        duplicateCandidates={duplicateCandidates}
        reviewEvents={reviewEvents}
        api={api}
        createId={createId}
        mayWrite={mayWrite}
        onApproveProposal={onApproveProposal}
        onStartReview={onStartReview}
        initialActivity={initialActivity}
      />
      <NativeButton
        label={showRefinementNotebook ? "Hide split suggestions" : "Split suggestions"}
        onPress={() => {
          setShowRefinementNotebook((previous) => !previous);
        }}
        className={
          "min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
        }
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
      {showRefinementNotebook ? (
        <NativeKnowledgeNotebookPanel
          key={`${area.id}:${refinementNamespace}:${String(notebookReload)}`}
          storageNamespace={refinementNamespace}
          searchTarget={
            searchTarget &&
            "namespace" in searchTarget &&
            searchTarget.namespace === refinementNamespace
              ? searchTarget
              : undefined
          }
          area={area}
          duplicateCandidates={duplicateCandidates}
          reviewEvents={reviewEvents}
          api={api}
          createId={createId}
          mayWrite={mayWrite}
          onApproveProposal={onApproveProposal}
          onStartReview={onStartReview}
        />
      ) : null}
      <NativeTutorPanelConversation
        conversation={{
          area,
          apiAvailable: Boolean(api),
          sessionId,
          busy,
          reply: tutorReply,
          history: session?.history ?? [],
          evaluation: session?.evaluation ?? null,
          quizActive: Boolean(session?.quiz),
          question,
          answer,
        }}
        onResume={() => {
          const nextSessionId = createId();
          setSessionId(nextSessionId);
          onSessionIdChange(nextSessionId);
        }}
        onQuestionChange={setQuestion}
        onAsk={() => void ask()}
        onAnswerChange={setAnswer}
        onEvaluate={() => void evaluateAnswer()}
      >
        <NativeTutorQuizHistory area={area} session={session} />
        <NativeTutorQuizControls
          area={area}
          session={session}
          objectiveGaps={objectiveGaps}
          selectedObjectiveId={selectedObjectiveId}
          onSelectObjective={setSelectedObjectiveId}
          busy={busy}
          hasApi={Boolean(api)}
          sessionId={sessionId}
          canProposeCard={
            session?.evaluation?.suggestedAction === "propose-card" && !session.proposal
          }
          onStartQuiz={() => void startQuiz()}
          onProposeCard={() => {
            if (sessionId) void request({ action: "propose-card", sessionId });
          }}
        />
        {session?.quiz ? (
          <NativeTutorQuiz
            area={area}
            quiz={session.quiz}
            busy={busy || !api}
            pendingQuestionIndex={session.quiz.questions.findIndex(
              (item) => item.learnerAnswer === null,
            )}
            answer={quizAnswer}
            onAnswerChange={setQuizAnswer}
            onSubmit={() => void evaluateQuizAnswer()}
          />
        ) : null}
        <NativeTutorPanelProposalEditor
          area={area}
          api={api}
          busy={busy}
          mayWrite={mayWrite}
          session={session}
          proposalKey={proposalKey}
          proposalContent={proposalContent}
          approvalSaved={approvalSaved}
          editProposal={editProposal}
          setDraft={setDraft}
          duplicateMatches={duplicateMatches}
          duplicateAcknowledgement={duplicateAcknowledgement}
          setDuplicateAcknowledgement={setDuplicateAcknowledgement}
          duplicateKey={duplicateKey}
          duplicatesAllowed={duplicatesAllowed}
          assistProposal={assistProposal}
          inspectProposal={inspectProposal}
          keepRefinement={keepRefinement}
          resolveProposal={resolveProposal}
        />
      </NativeTutorPanelConversation>
      {busy ? <ActivityIndicator color={palette.darkGreen} /> : null}
      {notice ? (
        <Text
          accessibilityRole="alert"
          className={"text-recall-darkGreen bg-recall-paper p-[9px] rounded-[9px] text-[12px]"}
        >
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
