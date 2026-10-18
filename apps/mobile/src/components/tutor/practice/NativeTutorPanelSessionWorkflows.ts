import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Effect, Either } from "effect";
import type { KnowledgeGap, TutorActionRequest, TutorSessionState } from "@recall/ai-core";
import { selectTutorContextHistory } from "@recall/ai-core";
import { selectTutorQuizObjective, tutorApiFailureMessage } from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import type { makeNativeTutorApi } from "../../../storage/ai/native-tutor-api";
import { accumulatedEvidence, emptySession, tutorEvidence } from "./NativeTutorPanelEvidence";

type TutorApi = ReturnType<typeof makeNativeTutorApi>;
type SessionSetter = Dispatch<SetStateAction<TutorSessionState | null>>;

export interface NativeTutorSessionWorkflowDependencies {
  readonly area: KnowledgeArea | null;
  readonly api: TutorApi | null;
  readonly objectiveGaps: readonly KnowledgeGap[];
  readonly selectedObjectiveId: string | null;
  readonly session: TutorSessionState | null;
  readonly sessionId: string | null;
  readonly question: string;
  readonly answer: string;
  readonly quizAnswer: string;
  readonly setSessionId: Dispatch<SetStateAction<string | null>>;
  readonly setSession: SessionSetter;
  readonly setQuestion: Dispatch<SetStateAction<string>>;
  readonly setAnswer: Dispatch<SetStateAction<string>>;
  readonly setQuizAnswer: Dispatch<SetStateAction<string>>;
  readonly setTutorReply: Dispatch<SetStateAction<string>>;
  readonly setNotice: Dispatch<SetStateAction<string | null>>;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
  readonly onSessionIdChange: (sessionId: string) => void;
}

export function useNativeTutorSessionWorkflows({
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
}: NativeTutorSessionWorkflowDependencies) {
  const request = useCallback(
    async (
      action: TutorActionRequest,
      displayHistory: TutorSessionState["history"] | null = null,
    ): Promise<boolean> => {
      if (!api) {
        setNotice("Choose a tutor provider and connect AI in Account settings.");
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
      else if (response.action === "propose-card")
        setSession((current) => ({
          ...(current ?? emptySession(response.sessionId)),
          proposal: { proposalId: response.proposalId, content: response.result },
        }));
      else if (response.action === "targeted-quiz")
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
      else if (response.action === "evaluate-quiz-answer")
        setSession((current) => ({
          ...(current ?? emptySession(response.sessionId)),
          quiz: response.quiz,
          evaluation: response.result,
          observations: accumulatedEvidence(current, response.result),
          proposal: null,
        }));
      return true;
    },
    [api, onSessionIdChange, setBusy, setNotice, setSession, setSessionId, setTutorReply],
  );

  const ask = useCallback(async () => {
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
        context: { knowledgeArea: area, history: selectTutorContextHistory(history) },
      },
      history,
    );
    if (accepted) setQuestion((current) => (current === submitted ? "" : current));
  }, [area, question, request, session?.history, sessionId, setQuestion]);

  const startQuiz = useCallback(async () => {
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
  }, [area, objectiveGaps, request, selectedObjectiveId, session, sessionId, setNotice]);

  const evaluateAnswer = useCallback(async () => {
    if (!sessionId || answer.trim().length === 0) return;
    const submitted = answer;
    const accepted = await request({ action: "evaluate", sessionId, answer: submitted.trim() });
    if (accepted) setAnswer((current) => (current === submitted ? "" : current));
  }, [answer, request, sessionId, setAnswer]);

  const evaluateQuizAnswer = useCallback(async () => {
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
  }, [quizAnswer, request, session, sessionId, setQuizAnswer]);

  return { request, ask, startQuiz, evaluateAnswer, evaluateQuizAnswer };
}
