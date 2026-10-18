import { type TutorHistoryMessage } from "@recall/ai-core";
import type { KnowledgeNotebook } from "./knowledge-notebook";

/** Encode recorded content as data, with explicit truncation rather than interpreting instructions. */
function evidenceMessage(
  role: TutorHistoryMessage["role"],
  fields: Readonly<Record<string, string | number | null>>,
): TutorHistoryMessage {
  let limit = 6000;
  let content = "";
  do {
    const data = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        typeof value === "string" ? value.slice(0, limit) : value,
      ]),
    );
    content = JSON.stringify({
      untrustedRecordedLearningData: data,
      truncated: Object.values(fields).some(
        (value) => typeof value === "string" && value.length > limit,
      ),
    });
    limit = Math.floor(limit / 2);
  } while (content.length > 8000 && limit > 0);
  return { role, content };
}

export function knowledgeNotebookInvestigationHistory(
  notebook: KnowledgeNotebook,
  conceptId: string,
): readonly TutorHistoryMessage[] {
  const concept = notebook.concepts.find((item) => item.id === conceptId);
  const prerequisites = new Set(concept?.prerequisiteIds ?? []);
  const chronological = [...notebook.evidence].sort(
    (left, right) => left.at - right.at || left.id.localeCompare(right.id),
  );
  // Selected-concept records follow prerequisite context so the bounded window retains its newest evidence.
  const related = [
    ...chronological.filter((entry) => prerequisites.has(entry.conceptId)).slice(-4),
    ...chronological.filter((entry) => entry.conceptId === conceptId).slice(-6),
  ];
  return related.flatMap((entry): readonly TutorHistoryMessage[] => {
    const title = notebook.concepts.find((item) => item.id === entry.conceptId)?.title ?? "";
    const shared = { conceptId: entry.conceptId, conceptTitle: title, recordedAt: entry.at };
    if (entry.kind === "review")
      return [
        evidenceMessage("assistant", {
          ...shared,
          recordKind: "recorded-review",
          rating: entry.reviewEvent.rating,
        }),
      ];
    return [
      evidenceMessage("assistant", {
        ...shared,
        recordKind: "recorded-question",
        question: entry.question,
      }),
      evidenceMessage("learner", {
        ...shared,
        recordKind: "recorded-answer",
        answer: entry.answer,
        learnerConfidence: entry.learnerConfidence,
      }),
      evidenceMessage("assistant", {
        ...shared,
        recordKind: "recorded-evaluation",
        result: entry.evaluation.result,
        confidence: entry.evaluation.confidence,
        feedback: entry.evaluation.feedback,
        misconception: entry.evaluation.misconception,
        suggestedAction: entry.evaluation.suggestedAction,
      }),
    ];
  });
}
