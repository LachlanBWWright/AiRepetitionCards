import { NativeButton } from "./ui/NativeButton";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { Effect, Either, Schema } from "effect";
import type { TutorSessionState } from "@recall/ai-core";
import type {
  AnswerEvaluation,
  CardProposal,
  KnowledgeGap,
  TutorActionRequest,
  CardRefinementInput,
  CardRefinementResult,
  CardInspectionResult,
} from "@recall/ai-core";
import { CardProposalSchema, selectTutorContextHistory } from "@recall/ai-core";
import { NativeProposalDuplicateWarning } from "./NativeProposalDuplicateWarning";
import { NativeCardAssistancePanel } from "./NativeCardAssistancePanel";
import {
  readNativeKnowledgeNotebook,
  writeNativeKnowledgeNotebook,
} from "../storage/native-knowledge-notebook-store";
import { NativeKnowledgeNotebookPanel } from "./NativeKnowledgeNotebookPanel";
import type { ReviewEvent, KnowledgeArea } from "@recall/domain";
import {
  findCardDuplicates,
  knowledgeAreaDuplicateCandidates,
  type CardDuplicateCandidate,
  type WorkspaceSearchTarget,
  accumulateTutorObservations,
  createCardAssistanceTutor,
  importTutorProposal,
  applyNotebookRefinement,
  selectTutorQuizObjective,
  tutorApiFailureMessage,
} from "@recall/application";
import { designTokens } from "@recall/design-tokens";
import type { makeNativeTutorApi } from "../storage/native-tutor-api";

const palette = designTokens.color;
const refinementNamespace = "knowledge-notebook:card-refinements";
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
  objectiveGaps = [],
  initialProposalDraft,
  initialNotice = null,
  initialAnswer = "",
}: {
  readonly onStartReview?: () => void;
  readonly initialProposalDraft?: { readonly proposalId: string; readonly content: CardProposal };
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
  const [showConversation, setShowConversation] = useState(false);
  const [showProposalDetails, setShowProposalDetails] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [notebookReload, setNotebookReload] = useState(0);
  const [showRefinementNotebook, setShowRefinementNotebook] = useState(false);
  useEffect(() => {
    if (
      !searchTarget ||
      !("namespace" in searchTarget) ||
      searchTarget.namespace !== refinementNamespace
    )
      return;
    const frame = requestAnimationFrame(() => setShowRefinementNotebook(true));
    return () => cancelAnimationFrame(frame);
  }, [searchTarget]);
  const assistanceLocked = useRef(false);
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
    ? `${area?.id}:${sessionId}:${session.proposal.proposalId}`
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
  const approvalEpoch = useRef(0);
  useEffect(() => {
    approvalEpoch.current += 1;
    return () => {
      approvalEpoch.current += 1;
    };
  }, [proposalKey, api]);
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
    if (!api || !sessionId) return;
    let active = true;
    void Effect.runPromise(Effect.either(api.readSession(sessionId))).then(async (result) => {
      if (!active) return;
      if (Either.isRight(result)) {
        let restored = result.right;
        if (areaId && restored?.proposal) {
          const restoredProposalId = restored.proposal.proposalId;
          const local = await Effect.runPromise(
            Effect.either(readNativeKnowledgeNotebook(areaId, refinementNamespace)),
          );
          if (!active) return;
          if (Either.isLeft(local))
            setNotice("The refinement notebook could not be read. Its saved data was preserved.");
          else if (
            local.right?.proposals.some(
              (proposal) => proposal.id === restoredProposalId && proposal.status === "discarded",
            ) &&
            local.right.proposals.some((proposal) => proposal.aiRefinementOf === restoredProposalId)
          ) {
            restored = { ...restored, proposal: null };
          }
        }
        setSession(restored);
      } else setNotice(tutorApiFailureMessage(result.left));
    });
    return () => {
      active = false;
    };
  }, [api, sessionId, areaId]);

  async function request(
    action: TutorActionRequest,
    displayHistory: TutorSessionState["history"] | null = null,
  ): Promise<boolean> {
    if (!api) {
      setNotice("Set the Recall API URL and sign in to use the tutor.");
      return false;
    }
    setBusy(true);
    setNotice(null);
    const result = await Effect.runPromise(Effect.either(api.request(action)));
    setBusy(false);
    if (Either.isLeft(result)) {
      setNotice(tutorApiFailureMessage(result.left));
      return false;
    }
    const response = result.right;
    const questionHistory =
      action.action === "question" ? (displayHistory ?? action.context.history) : null;
    setSessionId(response.sessionId);
    onSessionIdChange(response.sessionId);
    if (response.action === "question") {
      setTutorReply(response.result.question);
      setSession((current) => ({
        ...(current ?? emptySession(response.sessionId)),
        history: [
          ...(questionHistory ?? []),
          { role: "assistant", content: response.result.question },
        ],
        evaluation: null,
        proposal: null,
        quiz: null,
      }));
    } else if (response.action === "evaluate")
      setSession((current) => ({
        ...(current ?? emptySession(response.sessionId)),
        evaluation: response.result,
        observations: accumulatedEvidence(current, response.result),
        proposal: null,
        history: [
          ...(current?.history ?? []),
          ...(action.action === "evaluate"
            ? [{ role: "learner" as const, content: action.answer }]
            : []),
          { role: "assistant", content: response.result.feedback },
        ],
      }));
    else if (response.action === "propose-card") {
      setSession((current) => ({
        ...(current ?? emptySession(response.sessionId)),
        proposal: { proposalId: response.proposalId, content: response.result },
      }));
    } else if (response.action === "targeted-quiz") {
      setSession((current) => ({
        ...(current ?? emptySession(response.sessionId)),
        evaluation: null,
        proposal: null,
        quiz: {
          ...response.result,
          questions: response.result.questions.map((item) => ({
            ...item,
            learnerAnswer: null,
            evaluation: null,
          })),
        },
      }));
    } else if (response.action === "evaluate-quiz-answer")
      setSession((current) => ({
        ...(current ?? emptySession(response.sessionId)),
        quiz: response.quiz,
        evaluation: response.result,
        observations: accumulatedEvidence(current, response.result),
        proposal: null,
      }));
    return true;
  }

  async function ask() {
    if (!area || question.trim().length === 0) return;
    const history: TutorSessionState["history"] = [
      ...(session?.history ?? []),
      { role: "learner", content: question.trim() },
    ];
    const submitted = question;
    const accepted = await request(
      {
        action: "question",
        ...(sessionId ? { sessionId } : {}),
        context: {
          knowledgeArea: area,
          history: selectTutorContextHistory(history),
        },
      },
      history,
    );
    if (accepted) setQuestion((current) => (current === submitted ? "" : current));
  }

  async function startQuiz() {
    if (!area) return;
    const selected = Effect.runSync(
      Effect.either(
        selectTutorQuizObjective(area, objectiveGaps, tutorEvidence(session), selectedObjectiveId),
      ),
    );
    if (Either.isLeft(selected)) {
      setNotice(
        "The learning objective or tutor evidence could not be validated. Refresh the tutor session.",
      );
      return;
    }
    const objective = selected.right.objective;
    if (!objective) {
      setNotice("Add a learning objective before starting a targeted quiz.");
      return;
    }
    await request({
      action: "targeted-quiz",
      objectiveId: objective.id,
      ...(sessionId ? { sessionId } : { context: { knowledgeArea: area, history: [] } }),
    });
  }

  async function evaluateAnswer() {
    if (!sessionId || answer.trim().length === 0) return;
    const submitted = answer;
    const accepted = await request({ action: "evaluate", sessionId, answer: submitted.trim() });
    if (accepted) setAnswer((current) => (current === submitted ? "" : current));
  }

  async function evaluateQuizAnswer() {
    if (!sessionId || !session?.quiz || quizAnswer.trim().length === 0) return;
    const index = session.quiz.questions.findIndex((item) => item.learnerAnswer === null);
    if (index < 0) return;
    const submitted = quizAnswer;
    const accepted = await request({
      action: "evaluate-quiz-answer",
      sessionId,
      questionIndex: index,
      answer: submitted.trim(),
    });
    if (accepted) setQuizAnswer((current) => (current === submitted ? "" : current));
  }

  async function assistProposal(mode: CardRefinementInput["mode"], instructions: string) {
    if (
      !area ||
      !api ||
      !proposalContent ||
      !mayWrite() ||
      approvalSaved ||
      assistanceLocked.current
    )
      return null;
    assistanceLocked.current = true;
    const epoch = approvalEpoch.current;
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(
        createCardAssistanceTutor(api).refine(
          null,
          { knowledgeArea: area, history: selectTutorContextHistory(session?.history ?? []) },
          { ...proposalContent, mode, instructions, sources: [] },
          Date.now(),
        ),
      ),
    );
    assistanceLocked.current = false;
    if (approvalEpoch.current !== epoch || !mayWrite()) return null;
    setBusy(false);
    if (Either.isLeft(result)) {
      setNotice(result.left.message);
      return null;
    }
    return result.right.result;
  }

  async function inspectProposal(): Promise<CardInspectionResult | null> {
    if (
      !area ||
      !api ||
      !proposalContent ||
      !mayWrite() ||
      approvalSaved ||
      assistanceLocked.current
    )
      return null;
    assistanceLocked.current = true;
    const epoch = approvalEpoch.current;
    setBusy(true);
    const result = await Effect.runPromise(
      Effect.either(
        createCardAssistanceTutor(api).inspect(
          null,
          { knowledgeArea: area, history: selectTutorContextHistory(session?.history ?? []) },
          { ...proposalContent, sources: [] },
          Date.now(),
        ),
      ),
    );
    assistanceLocked.current = false;
    if (approvalEpoch.current !== epoch || !mayWrite()) return null;
    setBusy(false);
    if (Either.isLeft(result)) {
      setNotice(result.left.message);
      return null;
    }
    return result.right.result;
  }

  async function keepRefinement(result: CardRefinementResult): Promise<boolean> {
    if (
      !area ||
      !session?.proposal ||
      !proposalContent ||
      !proposalKey ||
      !sessionId ||
      !mayWrite() ||
      approvalSaved ||
      assistanceLocked.current
    )
      return false;
    if (result.cards.length === 1 && result.cards[0]) {
      setDraft({ key: proposalKey, content: result.cards[0] });
      return true;
    }
    assistanceLocked.current = true;
    const epoch = approvalEpoch.current;
    const sourceProposal = session.proposal;
    const sourceArea = area;
    const matchingQuizAnswers =
      session.quiz?.questions.filter(
        (item) =>
          item.evaluation &&
          session.evaluation &&
          JSON.stringify(item.evaluation) === JSON.stringify(session.evaluation),
      ) ?? [];
    const quizEvidence = matchingQuizAnswers.length === 1 ? matchingQuizAnswers[0] : undefined;
    const learnerIndex = session.history.reduce(
      (last, item, index) => (item.role === "learner" ? index : last),
      -1,
    );
    const observedAnswer = quizEvidence?.learnerAnswer ?? session.history[learnerIndex]?.content;
    const observedQuestion =
      quizEvidence?.prompt ??
      session.history
        .slice(0, learnerIndex)
        .reverse()
        .find((item) => item.role === "assistant")?.content;
    if (
      !observedAnswer ||
      !observedQuestion ||
      !session.evaluation ||
      matchingQuizAnswers.length > 1
    ) {
      assistanceLocked.current = false;
      setNotice(
        "The original question, answer and evaluation are required to retain evidence for split proposals. Evaluate a fresh answer first.",
      );
      return false;
    }
    setBusy(true);
    const transferred = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const stored = yield* readNativeKnowledgeNotebook(
            sourceArea.id,
            refinementNamespace,
          ).pipe(
            Effect.mapError(() => ({
              message: "Your notebook could not be read. Its saved data was preserved.",
            })),
          );
          const notebook = stored;
          const imported = yield* importTutorProposal(
            notebook,
            sourceArea,
            {
              proposalId: sourceProposal.proposalId,
              sessionId,
              proposal: proposalContent,
              evaluation: session.evaluation,
              question: observedQuestion,
              answer: observedAnswer,
              evidenceId: createId(),
              now: Date.now(),
            },
            sourceArea.cards,
          );
          const next = yield* applyNotebookRefinement(
            imported,
            {
              proposalId: sourceProposal.proposalId,
              baseline: {
                front: proposalContent.front,
                back: proposalContent.back,
                objectiveId: proposalContent.objectiveId,
              },
              cards: result.cards,
              newProposalIds: result.cards.map(() => createId()),
            },
            sourceArea.cards,
          );
          yield* writeNativeKnowledgeNotebook(
            sourceArea.id,
            next,
            () => approvalEpoch.current === epoch && mayWrite(),
            refinementNamespace,
          ).pipe(
            Effect.mapError(() => ({
              message:
                "The split proposals could not be saved. The original proposal remains available.",
            })),
          );
        }),
      ),
    );
    assistanceLocked.current = false;
    if (approvalEpoch.current !== epoch || !mayWrite()) return false;
    setBusy(false);
    if (Either.isLeft(transferred)) {
      setNotice(transferred.left.message);
      return false;
    }
    setNotebookReload((previous) => previous + 1);
    setShowRefinementNotebook(true);
    setSession((current) => (current ? { ...current, proposal: null } : current));
    setNotice("Split suggestions saved. Open Split suggestions to review them.");
    return true;
  }

  async function resolveProposal(state: "approved" | "rejected") {
    const proposal = session?.proposal;
    if (!api || !proposal || !sessionId) return;
    if (state === "approved" && !duplicatesAllowed) {
      setNotice("Review the possible duplicates and choose Keep both before saving.");
      return;
    }
    const key = proposalKey;
    const epoch = approvalEpoch.current;
    if (!key) return;
    const currentApproval = () => approvalEpoch.current === epoch;
    const edited = Schema.decodeUnknownEither(CardProposalSchema)({
      ...proposalContent,
      front: proposalContent?.front.trim(),
      back: proposalContent?.back.trim(),
      rationale: proposalContent?.rationale.trim(),
    });
    if (
      state === "approved" &&
      (Either.isLeft(edited) ||
        (edited.right.objectiveId !== null &&
          !area?.objectives.some((objective) => objective.id === edited.right.objectiveId)))
    ) {
      setNotice(
        "Enter a question, answer and rationale within the field limits, and choose an objective from this area.",
      );
      return;
    }
    setBusy(true);
    setNotice(null);
    let cardId: string | undefined;
    let content = proposal.content;
    if (state === "approved" && Either.isRight(edited)) {
      const saved =
        savedApproval?.key === key
          ? savedApproval
          : await onApproveProposal(edited.right, proposal.proposalId, sessionId);
      if (!currentApproval()) return;
      if (!saved) {
        setBusy(false);
        setNotice(
          "The card could not be saved locally, so approval was not sent. Your edits remain available to retry.",
        );
        return;
      }
      cardId = saved.cardId;
      content = saved.content;
      setSavedApproval({ key, cardId, content });
      setDraft({ key, content });
      if (
        content.front !== edited.right.front ||
        content.back !== edited.right.back ||
        content.objectiveId !== edited.right.objectiveId ||
        content.rationale !== edited.right.rationale
      ) {
        setBusy(false);
        setNotice(
          "This proposal already has a saved card. Its durable content has been restored without overwriting it. Retry approval to acknowledge that saved card.",
        );
        return;
      }
    }
    const result = await Effect.runPromise(
      Effect.either(
        api.resolveProposal({
          proposalId: proposal.proposalId,
          state,
          ...(state === "approved" && cardId ? { cardId, content } : {}),
        }),
      ),
    );
    if (!currentApproval()) return;
    setBusy(false);
    if (Either.isLeft(result)) {
      setNotice(
        state === "approved"
          ? `The card is saved locally. ${tutorApiFailureMessage(result.left)} Retry approval to acknowledge the saved card.`
          : tutorApiFailureMessage(result.left),
      );
      return;
    }
    setSession((current) => (current ? { ...current, proposal: null } : current));
    setNotice(state === "approved" ? "Saved." : "Discarded.");
  }

  if (!area) return null;
  const quizSelection = Effect.runSync(
    Effect.either(
      selectTutorQuizObjective(area, objectiveGaps, tutorEvidence(session), selectedObjectiveId),
    ),
  );
  const objective = session?.quiz?.questions.find((item) => item.learnerAnswer === null);
  return (
    <View testID="native-tutor-panel" className={"gap-[10px] mt-[12px]"}>
      <NativeKnowledgeNotebookPanel
        area={area}
        searchTarget={
          searchTarget &&
          "namespace" in searchTarget &&
          searchTarget.namespace === "knowledge-notebook"
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
      />
      <NativeButton
        label={showRefinementNotebook ? "Hide split suggestions" : "Split suggestions"}
        onPress={() => setShowRefinementNotebook((previous) => !previous)}
        className={
          "min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
        }
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
      {showRefinementNotebook ? (
        <NativeKnowledgeNotebookPanel
          key={`${area.id}:${refinementNamespace}:${notebookReload}`}
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
      <NativeButton
        label={showConversation ? "Close tutor conversation" : "Ask the tutor"}
        onPress={() => setShowConversation((current) => !current)}
        className={"py-[9px] px-[4px]"}
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
      <View className={showConversation ? "gap-[10px]" : "hidden"}>
        {!api ? (
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
            Connect AI in settings to ask questions.
          </Text>
        ) : null}
        {!sessionId ? (
          <NativeButton
            disabled={busy || !api}
            onPress={() => {
              const nextSessionId = createId();
              setSessionId(nextSessionId);
              onSessionIdChange(nextSessionId);
            }}
            label={busy ? "Loading…" : "Resume tutor"}
            className={
              "min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
            }
            labelClassName="text-recall-darkGreen text-[11px] font-bold"
          />
        ) : null}
        {tutorReply || session?.history.length ? (
          <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
            {tutorReply ||
              [...(session?.history ?? [])].reverse().find((item) => item.role === "assistant")
                ?.content}
          </Text>
        ) : null}
        <View className={"flex-row gap-[8px] items-center"}>
          <TextInput
            accessibilityLabel="Ask the tutor"
            onChangeText={setQuestion}
            placeholder="Ask about this area…"
            placeholderTextColor={palette.muted}
            className={
              "flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
            value={question}
          />
          <NativeButton
            disabled={busy || !api || !question.trim()}
            onPress={() => void ask()}
            label="Ask"
            className={"min-h-[40px] justify-center px-[13px] rounded-[10px] bg-recall-darkGreen"}
            labelClassName="text-recall-surface text-[12px] font-bold"
          />
        </View>
        {sessionId && !session?.quiz ? (
          <View className={"flex-row gap-[8px] items-center"}>
            <TextInput
              accessibilityLabel="Answer the tutor"
              onChangeText={setAnswer}
              placeholder="Try an answer…"
              placeholderTextColor={palette.muted}
              className={
                "flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
              }
              value={answer}
            />
            <NativeButton
              disabled={busy || !api || !answer.trim()}
              onPress={() => void evaluateAnswer()}
              label="Check"
              className={
                "min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
              }
              labelClassName="text-recall-darkGreen text-[11px] font-bold"
            />
          </View>
        ) : null}
        {session?.evaluation && !session.quiz ? (
          <NativeTutorEvaluation evaluation={session.evaluation} area={area} />
        ) : null}
        {session?.quiz?.questions.map((item, index) =>
          item.evaluation ? (
            <View
              key={`${session.quiz?.objectiveId}:${index}`}
              className={"gap-[8px] py-[11px] border-b border-b-recall-line"}
            >
              <Text className={"text-recall-ink font-bold text-[13px]"}>
                Quiz answer {index + 1}: {item.prompt}
              </Text>
              {item.learnerAnswer ? (
                <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                  Your answer: {item.learnerAnswer}
                </Text>
              ) : null}
              <NativeTutorEvaluation evaluation={item.evaluation} area={area} />
            </View>
          ) : null,
        )}
        <NativeButton
          label={showTargets ? "Hide practice targets" : "Practice targets"}
          onPress={() => setShowTargets((current) => !current)}
          className={"py-[9px] px-[4px]"}
          labelClassName="text-recall-darkGreen text-[11px] font-bold"
        />
        {showTargets && Either.isRight(quizSelection) && quizSelection.right.objective ? (
          <View className={"gap-[8px] py-[11px] border-b border-b-recall-line"}>
            <Text className={"text-recall-ink font-bold text-[13px]"}>
              Practice target: {quizSelection.right.objective.title}
            </Text>
            {quizSelection.right.gap ? (
              <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                {quizSelection.right.gap.evidenceSummary}
              </Text>
            ) : null}
            {quizSelection.right.gaps.map((gap) => (
              <NativeButton
                key={gap.objectiveId}
                disabled={busy}
                onPress={() => setSelectedObjectiveId(gap.objectiveId)}
                label={`Practice ${gap.objectiveTitle}`}
                className={
                  "min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
                }
                labelClassName="text-recall-darkGreen text-[11px] font-bold"
              />
            ))}
          </View>
        ) : null}
        <View className={"flex-row gap-[8px] items-center"}>
          <NativeButton
            disabled={busy || !api}
            onPress={() => void startQuiz()}
            label="Targeted quiz"
            className={
              "min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
            }
            labelClassName="text-recall-darkGreen text-[11px] font-bold"
          />
          {sessionId &&
          session?.evaluation?.suggestedAction === "propose-card" &&
          !session.proposal ? (
            <NativeButton
              disabled={busy || !api}
              onPress={() => void request({ action: "propose-card", sessionId })}
              label="Propose card"
              className={
                "min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
              }
              labelClassName="text-recall-darkGreen text-[11px] font-bold"
            />
          ) : null}
        </View>
        {objective ? (
          <View className={"gap-[8px] py-[11px] border-b border-b-recall-line"}>
            <Text className={"text-recall-ink font-bold text-[13px]"}>{objective.prompt}</Text>
            {objective.evaluation ? (
              <NativeTutorEvaluation evaluation={objective.evaluation} area={area} />
            ) : null}
            <View className={"flex-row gap-[8px] items-center"}>
              <TextInput
                accessibilityLabel="Quiz answer"
                onChangeText={setQuizAnswer}
                placeholder="Your answer"
                placeholderTextColor={palette.muted}
                className={
                  "flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
                }
                value={quizAnswer}
              />
              <NativeButton
                disabled={busy || !api || !quizAnswer.trim()}
                onPress={() => void evaluateQuizAnswer()}
                label="Submit"
                className={
                  "min-h-[40px] justify-center px-[13px] rounded-[10px] bg-recall-darkGreen"
                }
                labelClassName="text-recall-surface text-[12px] font-bold"
              />
            </View>
          </View>
        ) : null}
        {session?.proposal && proposalContent ? (
          <View className={"gap-[7px] py-[11px]"}>
            <Text className={"text-recall-ink font-bold text-[13px]"}>Suggested card</Text>
            {approvalSaved ? (
              <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                Saved. Retry approval to finish.
              </Text>
            ) : null}
            <TextInput
              accessibilityLabel="Proposed card question"
              multiline
              editable={!busy && !approvalSaved}
              value={proposalContent.front}
              onChangeText={(value) => editProposal("front", value)}
              className={
                "flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
              }
            />
            <TextInput
              accessibilityLabel="Proposed card answer"
              multiline
              editable={!busy && !approvalSaved}
              value={proposalContent.back}
              onChangeText={(value) => editProposal("back", value)}
              className={
                "flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
              }
            />
            <NativeButton
              label={showProposalDetails ? "Hide details" : "Details"}
              onPress={() => setShowProposalDetails((current) => !current)}
              className={"py-[9px] px-[4px]"}
              labelClassName="text-recall-darkGreen text-[11px] font-bold"
            />
            <View className={showProposalDetails ? "gap-[10px]" : "hidden"}>
              <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                Learning objective
              </Text>
              {[{ id: null, title: "No objective" }, ...area.objectives].map((objective) => (
                <NativeButton
                  key={objective.id ?? "none"}
                  disabled={busy || approvalSaved}
                  label={`${proposalContent.objectiveId === objective.id ? "✓ " : ""}${objective.title}`}
                  onPress={() => {
                    if (proposalKey)
                      setDraft({
                        key: proposalKey,
                        content: { ...proposalContent, objectiveId: objective.id },
                      });
                  }}
                  className={
                    "min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
                  }
                  labelClassName="text-recall-darkGreen text-[11px] font-bold"
                />
              ))}
              <TextInput
                accessibilityLabel="Proposed card rationale"
                multiline
                editable={!busy && !approvalSaved}
                value={proposalContent.rationale}
                onChangeText={(value) => editProposal("rationale", value)}
                className={
                  "flex-1 min-h-[42px] px-[11px] rounded-[10px] bg-recall-paper text-recall-ink"
                }
              />
            </View>
            <NativeCardAssistancePanel
              key={proposalKey}
              content={proposalContent}
              proposalOnly
              disabled={busy || approvalSaved || !mayWrite()}
              onRefine={api ? assistProposal : undefined}
              onInspect={api ? inspectProposal : undefined}
              onApply={keepRefinement}
            />
            {!approvalSaved && (
              <NativeProposalDuplicateWarning
                matches={duplicateMatches}
                acknowledged={duplicateAcknowledgement === duplicateKey}
                disabled={busy}
                onChange={(value) => setDuplicateAcknowledgement(value ? duplicateKey : null)}
              />
            )}
            <View className={"flex-row gap-[8px] items-center"}>
              <NativeButton
                disabled={busy || !api || !duplicatesAllowed}
                onPress={() => void resolveProposal("approved")}
                label={approvalSaved ? "Retry approval" : "Save & approve"}
                className={
                  "min-h-[40px] justify-center px-[13px] rounded-[10px] bg-recall-darkGreen"
                }
                labelClassName="text-recall-surface text-[12px] font-bold"
              />
              <NativeButton
                disabled={busy || !api || approvalSaved}
                onPress={() => void resolveProposal("rejected")}
                label="Reject"
                className={
                  "min-h-[38px] justify-center items-center px-[12px] rounded-[10px] bg-transparent"
                }
                labelClassName="text-recall-darkGreen text-[11px] font-bold"
              />
            </View>
          </View>
        ) : null}
      </View>
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

function NativeTutorEvaluation({
  evaluation,
}: {
  readonly evaluation: AnswerEvaluation;
  readonly area: KnowledgeArea;
}) {
  const assessment = {
    mastered: "Answer understood",
    partial: "Partially understood",
    incorrect: "Needs another attempt",
    uncertain: "Uncertain",
  }[evaluation.result];
  return (
    <View
      accessibilityLiveRegion="polite"
      className={"gap-[8px] py-[11px] border-b border-b-recall-line"}
    >
      <Text className={"text-recall-ink font-bold text-[13px]"}>{assessment}</Text>
      {evaluation.result === "uncertain" || evaluation.confidence < 0.5 ? (
        <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
          This assessment is tentative. Ask for clarification or try another answer.
        </Text>
      ) : null}
      <Text className={"text-recall-ink text-[13px] leading-[19px]"}>{evaluation.feedback}</Text>
      {evaluation.misconception ? (
        <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
          Possible misconception: {evaluation.misconception}
        </Text>
      ) : null}
    </View>
  );
}

function tutorEvidence(session: TutorSessionState | null) {
  const previous = session?.observations ?? [];
  return previous.length > 0 || !session?.evaluation ? previous : [session.evaluation];
}
function accumulatedEvidence(
  session: TutorSessionState | null,
  observation: TutorSessionState["evaluation"],
) {
  const result = Effect.runSync(
    Effect.either(accumulateTutorObservations(tutorEvidence(session), observation)),
  );
  return Either.isRight(result) ? result.right : tutorEvidence(session);
}

function emptySession(sessionId: string): TutorSessionState {
  return { sessionId, history: [], evaluation: null, proposal: null, quiz: null };
}
