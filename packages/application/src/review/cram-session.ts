import type { Assessment, LearningArea } from "@recall/domain";
import type { ReviewRating } from "@recall/scheduler";

export type CramSession = {
  readonly areaId: string;
  readonly remainingIds: readonly string[];
  readonly answered: number;
  readonly recalled: number;
};
export function startCramSession(
  area: LearningArea,
  suspendedIds: readonly string[] = [],
): CramSession {
  return {
    areaId: area.id,
    remainingIds: area.cards
      .filter((card) => !suspendedIds.includes(card.id))
      .map((card) => card.id),
    answered: 0,
    recalled: 0,
  };
}
export function cramCard(session: CramSession, area: LearningArea): Assessment | undefined {
  return session.remainingIds
    .map((id) => area.cards.find((card) => card.id === id))
    .find((card) => card !== undefined);
}
/** Practice is transient and never creates scheduler evidence or updates a workspace. */
export function rateCramCard(
  session: CramSession,
  cardId: string,
  rating: ReviewRating,
): CramSession {
  if (!session.remainingIds.includes(cardId)) return session;
  return {
    ...session,
    remainingIds: [
      ...session.remainingIds.filter((id) => id !== cardId),
      ...(rating === "again" ? [cardId] : []),
    ],
    answered: session.answered + 1,
    recalled: session.recalled + (rating === "again" ? 0 : 1),
  };
}
