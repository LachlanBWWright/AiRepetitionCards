import { Schema } from "effect";
import type { LearningArea, ReviewEvent } from "@recall/domain";

export const KnowledgeGapSchema = Schema.Struct({
  objectiveId: Schema.String.pipe(Schema.minLength(1)),
  objectiveTitle: Schema.String.pipe(Schema.minLength(1)),
  kind: Schema.Union(
    Schema.Literal("uncovered"),
    Schema.Literal("retention-risk"),
    Schema.Literal("due-practice"),
    Schema.Literal("tutor-observation"),
  ),
  severity: Schema.Union(Schema.Literal("high"), Schema.Literal("medium")),
  cardCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  dueCardCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  recentFailureCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  evidenceSummary: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(500)),
});

export type KnowledgeGap = typeof KnowledgeGapSchema.Type;

export function identifyObjectiveGaps(
  area: LearningArea,
  reviewEvents: readonly ReviewEvent[],
  now: Date,
): ReadonlyArray<KnowledgeGap> {
  const objectives = area.objectives?.length
    ? area.objectives
    : Array.from(new Set(area.cards.map((card) => card.objective))).map((title, index) => {
        const slug = title
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        return { id: `objective-${slug || "learning"}-${String(index + 1)}`, title };
      });
  const gaps: KnowledgeGap[] = [];
  for (const objective of objectives) {
    // Tutor actions target this learner's objective; source identities are provenance only.
    const objectiveId = objective.id;
    const cards = area.cards.filter((card) =>
      card.objectiveIds?.length
        ? card.objectiveIds.some((id) => id === objective.id)
        : card.objective === objective.title,
    );
    const cardIds = new Set(cards.map((card) => card.id));
    const dueCardCount = cards.filter(
      (card) => Date.parse(card.schedule.due) <= now.getTime(),
    ).length;
    const recent = reviewEvents
      .filter((event) => event.areaId === area.id && cardIds.has(event.cardId))
      .sort((left, right) => right.ratedAt.localeCompare(left.ratedAt))
      .slice(0, 5);
    const recentFailureCount = recent.filter((event) => event.rating === "again").length;
    if (cards.length === 0) {
      gaps.push({
        objectiveId,
        objectiveTitle: objective.title,
        kind: "uncovered",
        severity: "high",
        cardCount: 0,
        dueCardCount: 0,
        recentFailureCount: 0,
        evidenceSummary: "No study cards are linked to this objective yet.",
      });
      continue;
    }
    if (recentFailureCount >= 2) {
      gaps.push({
        objectiveId,
        objectiveTitle: objective.title,
        kind: "retention-risk",
        severity: "high",
        cardCount: cards.length,
        dueCardCount,
        recentFailureCount,
        evidenceSummary: `${String(recentFailureCount)} of the last ${String(recent.length)} reviews were rated Again.`,
      });
      continue;
    }
    if (dueCardCount > 0) {
      gaps.push({
        objectiveId,
        objectiveTitle: objective.title,
        kind: "due-practice",
        severity: "medium",
        cardCount: cards.length,
        dueCardCount,
        recentFailureCount,
        evidenceSummary: `${String(dueCardCount)} linked ${dueCardCount === 1 ? "card is" : "cards are"} due for review.`,
      });
    }
  }
  return gaps;
}
