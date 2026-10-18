import { Effect } from "effect";
import { selectTutorContextHistory, type TutorContext } from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
import type { createTutorApi } from "../transport/tutor-api";
export type SubjectDialogue = TutorContext["history"];
export function askSubjectTutor(
  api: ReturnType<typeof createTutorApi>,
  area: KnowledgeArea,
  history: SubjectDialogue,
  question: string,
) {
  const nextHistory: SubjectDialogue = [...history, { role: "learner", content: question.trim() }];
  const request = {
    action: "question" as const,
    context: {
      knowledgeArea: area,
      history: selectTutorContextHistory(nextHistory, true),
      ephemeralSession: true,
    },
  };
  return api.request(request).pipe(
    Effect.map((response) => {
      const reply =
        response.action === "question"
          ? [response.result.explanation, response.result.question].filter(Boolean).join("\n\n")
          : "";
      const history: SubjectDialogue = reply
        ? [...nextHistory, { role: "assistant", content: reply }]
        : nextHistory;
      return { sessionId: response.sessionId, history };
    }),
  );
}
