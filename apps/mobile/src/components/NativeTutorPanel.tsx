import { NativeButton } from "@recall/ui-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { Effect, Either, Schema } from "effect";
import type { TutorSessionState } from "@recall/ai-core";
import type {
  AnswerEvaluation,
  CardProposal,
  KnowledgeGap,
  TutorActionRequest,
} from "@recall/ai-core";
import {
  CardProposalSchema,
  selectTutorContextHistory,
  selectTutorInferenceContext,
} from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
import {
  accumulateTutorObservations,
  selectTutorQuizObjective,
  tutorApiFailureMessage,
} from "@recall/application";
import { designTokens } from "@recall/design-tokens";
import type { makeNativeTutorApi } from "../storage/native-tutor-api";

const palette = designTokens.color;
type TutorApi = ReturnType<typeof makeNativeTutorApi>;

export function NativeTutorPanel({
  area,
  api,
  createId,
  initialSessionId,
  onSessionIdChange,
  onApproveProposal,
  objectiveGaps = [],
  initialProposalDraft,
  initialNotice = null,
  initialAnswer = "",
}: {
  readonly initialProposalDraft?: { readonly proposalId: string; readonly content: CardProposal };
  readonly initialNotice?: string | null;
  readonly initialAnswer?: string;
  readonly area: KnowledgeArea | null;
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
  function editProposal(field: "front" | "back" | "rationale", value: string) {
    if (proposalKey && proposalContent && !approvalSaved)
      setDraft({ key: proposalKey, content: { ...proposalContent, [field]: value } });
  }

  useEffect(() => {
    if (!api || !sessionId) return;
    let active = true;
    void Effect.runPromise(Effect.either(api.readSession(sessionId))).then((result) => {
      if (!active) return;
      if (Either.isRight(result)) setSession(result.right);
      else setNotice(tutorApiFailureMessage(result.left));
    });
    return () => {
      active = false;
    };
  }, [api, sessionId]);

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
    } else
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

  async function resolveProposal(state: "approved" | "rejected") {
    const proposal = session?.proposal;
    if (!api || !proposal || !sessionId) return;
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
    setNotice(state === "approved" ? "Approved and saved to this device." : "Proposal rejected.");
  }

  if (!area) return null;
  const contextPreview = Effect.runSync(
    Effect.either(
      selectTutorInferenceContext(
        {
          knowledgeArea: area,
          history: selectTutorContextHistory(session?.history ?? []),
        },
        undefined,
        session?.quiz?.objectiveId ?? session?.evaluation?.objectiveId,
      ),
    ),
  );
  const quizSelection = Effect.runSync(
    Effect.either(
      selectTutorQuizObjective(area, objectiveGaps, tutorEvidence(session), selectedObjectiveId),
    ),
  );
  const objective = session?.quiz?.questions.find((item) => item.learnerAnswer === null);
  return (
    <View testID="native-tutor-panel" style={styles.panel}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>AI STUDY PARTNER</Text>
          <Text style={styles.title}>Tutor</Text>
        </View>
        {sessionId ? <Text style={styles.session}>Session ready</Text> : null}
      </View>
      {!api && (
        <Text style={styles.response}>
          The AI tutor is not configured on this device. You can keep studying and editing cards in
          Today and Library.
        </Text>
      )}
      <Text accessibilityLiveRegion="polite" style={styles.session}>
        {Either.isRight(contextPreview)
          ? `Tutor context: ${contextPreview.right.knowledgeArea.cards.length} of ${area.cards.length} cards; objectives and AI instructions retained.`
          : "Required context exceeds the tutor budget. Shorten objective descriptions or AI instructions."}
      </Text>
      {!sessionId ? (
        <NativeButton
          disabled={busy || !api}
          onPress={() => {
            const nextSessionId = createId();
            setSessionId(nextSessionId);
            onSessionIdChange(nextSessionId);
          }}
          label={busy ? "Loading…" : "Resume tutor"}
          style={styles.softButton}
          labelStyle={styles.softText}
        />
      ) : null}
      {tutorReply || session?.history.length ? (
        <Text style={styles.response}>
          {tutorReply ||
            [...(session?.history ?? [])].reverse().find((item) => item.role === "assistant")
              ?.content}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Ask the tutor"
          onChangeText={setQuestion}
          placeholder="Ask about this area…"
          placeholderTextColor={palette.muted}
          style={styles.input}
          value={question}
        />
        <NativeButton
          disabled={busy || !api || !question.trim()}
          onPress={() => void ask()}
          label="Ask"
          style={styles.button}
          labelStyle={styles.buttonText}
        />
      </View>
      {sessionId && !session?.quiz ? (
        <View style={styles.row}>
          <TextInput
            accessibilityLabel="Answer the tutor"
            onChangeText={setAnswer}
            placeholder="Try an answer…"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={answer}
          />
          <NativeButton
            disabled={busy || !api || !answer.trim()}
            onPress={() => void evaluateAnswer()}
            label="Check"
            style={styles.softButton}
            labelStyle={styles.softText}
          />
        </View>
      ) : null}
      {session?.evaluation && !session.quiz ? (
        <NativeTutorEvaluation evaluation={session.evaluation} area={area} />
      ) : null}
      {session?.quiz?.questions.map((item, index) =>
        item.evaluation ? (
          <View key={`${session.quiz?.objectiveId}:${index}`} style={styles.quiz}>
            <Text style={styles.quizTitle}>
              Quiz answer {index + 1}: {item.prompt}
            </Text>
            {item.learnerAnswer ? (
              <Text style={styles.response}>Your answer: {item.learnerAnswer}</Text>
            ) : null}
            <NativeTutorEvaluation evaluation={item.evaluation} area={area} />
          </View>
        ) : null,
      )}
      {Either.isRight(quizSelection) && quizSelection.right.objective ? (
        <View style={styles.quiz}>
          <Text style={styles.quizTitle}>
            Practice target: {quizSelection.right.objective.title}
          </Text>
          {quizSelection.right.gap ? (
            <Text style={styles.response}>{quizSelection.right.gap.evidenceSummary}</Text>
          ) : null}
          {quizSelection.right.gaps.map((gap) => (
            <NativeButton
              key={gap.objectiveId}
              disabled={busy}
              onPress={() => setSelectedObjectiveId(gap.objectiveId)}
              label={`Practice ${gap.objectiveTitle}`}
              style={styles.softButton}
              labelStyle={styles.softText}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.row}>
        <NativeButton
          disabled={busy || !api}
          onPress={() => void startQuiz()}
          label="Targeted quiz"
          style={styles.softButton}
          labelStyle={styles.softText}
        />
        {sessionId &&
        session?.evaluation?.suggestedAction === "propose-card" &&
        !session.proposal ? (
          <NativeButton
            disabled={busy || !api}
            onPress={() => void request({ action: "propose-card", sessionId })}
            label="Propose card"
            style={styles.softButton}
            labelStyle={styles.softText}
          />
        ) : null}
      </View>
      {objective ? (
        <View style={styles.quiz}>
          <Text style={styles.quizTitle}>{objective.prompt}</Text>
          {objective.evaluation ? (
            <NativeTutorEvaluation evaluation={objective.evaluation} area={area} />
          ) : null}
          <View style={styles.row}>
            <TextInput
              accessibilityLabel="Quiz answer"
              onChangeText={setQuizAnswer}
              placeholder="Your answer"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={quizAnswer}
            />
            <NativeButton
              disabled={busy || !api || !quizAnswer.trim()}
              onPress={() => void evaluateQuizAnswer()}
              label="Submit"
              style={styles.button}
              labelStyle={styles.buttonText}
            />
          </View>
        </View>
      ) : null}
      {session?.proposal && proposalContent ? (
        <View style={styles.proposal}>
          <Text style={styles.quizTitle}>Proposed card · approval required</Text>
          <Text style={styles.muted}>
            {approvalSaved
              ? "Saved on this device. Retry acknowledgment using this saved content."
              : "Edit the Basic card before saving. Question: 1,000 characters; answer: 3,000; rationale: 1,000."}
          </Text>
          <TextInput
            accessibilityLabel="Proposed card question"
            multiline
            editable={!busy && !approvalSaved}
            value={proposalContent.front}
            onChangeText={(value) => editProposal("front", value)}
            style={styles.input}
          />
          <TextInput
            accessibilityLabel="Proposed card answer"
            multiline
            editable={!busy && !approvalSaved}
            value={proposalContent.back}
            onChangeText={(value) => editProposal("back", value)}
            style={styles.input}
          />
          <Text style={styles.response}>Learning objective</Text>
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
              style={styles.softButton}
              labelStyle={styles.softText}
            />
          ))}
          <TextInput
            accessibilityLabel="Proposed card rationale"
            multiline
            editable={!busy && !approvalSaved}
            value={proposalContent.rationale}
            onChangeText={(value) => editProposal("rationale", value)}
            style={styles.input}
          />
          <View style={styles.row}>
            <NativeButton
              disabled={busy || !api}
              onPress={() => void resolveProposal("approved")}
              label={approvalSaved ? "Retry approval" : "Save & approve"}
              style={styles.button}
              labelStyle={styles.buttonText}
            />
            <NativeButton
              disabled={busy || !api || approvalSaved}
              onPress={() => void resolveProposal("rejected")}
              label="Reject"
              style={styles.softButton}
              labelStyle={styles.softText}
            />
          </View>
        </View>
      ) : null}
      {busy ? <ActivityIndicator color={palette.darkGreen} /> : null}
      {notice ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      <Text style={styles.muted}>AI suggestions stay proposals until you approve them.</Text>
    </View>
  );
}

function NativeTutorEvaluation({
  evaluation,
  area,
}: {
  readonly evaluation: AnswerEvaluation;
  readonly area: KnowledgeArea;
}) {
  const objective = area.objectives.find((item) => item.id === evaluation.objectiveId);
  const assessment = {
    mastered: "Answer understood",
    partial: "Partially understood",
    incorrect: "Needs another attempt",
    uncertain: "Uncertain",
  }[evaluation.result];
  return (
    <View accessibilityLiveRegion="polite" style={styles.quiz}>
      <Text style={styles.quizTitle}>Tutor assessment: {assessment}</Text>
      <Text style={styles.muted}>
        Model-reported confidence: {Math.round(evaluation.confidence * 100)}%. This is an assessment
        signal, not a measured probability of mastery.
      </Text>
      <Text style={styles.muted}>
        Objective: {objective?.title ?? "Not linked to an objective"}
      </Text>
      {evaluation.result === "uncertain" || evaluation.confidence < 0.5 ? (
        <Text style={styles.response}>
          This assessment is tentative. Ask for clarification or try another answer.
        </Text>
      ) : null}
      <Text style={styles.response}>{evaluation.feedback}</Text>
      {evaluation.misconception ? (
        <Text style={styles.muted}>Possible misconception: {evaluation.misconception}</Text>
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

const styles = StyleSheet.create({
  panel: {
    gap: 10,
    marginTop: 28,
    padding: 16,
    borderRadius: 22,
    backgroundColor: palette.surface,
    borderColor: palette.line,
    borderWidth: 1,
  },
  heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { color: palette.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.1 },
  title: { color: palette.ink, fontSize: 19, fontWeight: "700" },
  session: { color: palette.darkGreen, fontSize: 11, fontWeight: "600" },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: palette.paper,
    color: palette.ink,
  },
  button: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 13,
    borderRadius: 10,
    backgroundColor: palette.darkGreen,
  },
  buttonText: { color: palette.surface, fontSize: 12, fontWeight: "700" },
  softButton: {
    minHeight: 38,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: palette.green,
  },
  softText: { color: palette.darkGreen, fontSize: 12, fontWeight: "700" },
  response: { color: palette.ink, fontSize: 13, lineHeight: 19 },
  quiz: { gap: 8, padding: 11, borderRadius: 12, backgroundColor: palette.paper },
  quizTitle: { color: palette.ink, fontWeight: "700", fontSize: 13 },
  proposal: { gap: 7, padding: 11, borderRadius: 12, borderColor: palette.line, borderWidth: 1 },
  muted: { color: palette.muted, fontSize: 11, lineHeight: 16 },
  notice: {
    color: palette.darkGreen,
    backgroundColor: "#eaf3d9",
    padding: 9,
    borderRadius: 9,
    fontSize: 12,
  },
});
