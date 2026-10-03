import { createReviewEventId, type Workspace } from "@recall/domain";
import { mockWorkspace } from "./mock-data";

const sourceReview = mockWorkspace.reviewEvents?.[0];
const sourceArea = mockWorkspace.areas.find((area) => area.id === sourceReview?.areaId);
const pendingReviews = sourceReview
  ? [
      {
        ...sourceReview,
        id: createReviewEventId("offline-deleted-content-review"),
        ratedAt: "2026-10-03T05:00:00.000Z",
      },
    ]
  : [];
const retained = sourceArea
  ? [{ ...sourceArea, cards: sourceArea.cards.filter((card) => card.id === sourceReview?.cardId) }]
  : [];

/** A reviewed card deleted offline before its first sync, with private recovery content. */
export const deletedCardPendingWorkspace: Workspace = {
  ...mockWorkspace,
  reviews: pendingReviews.length,
  reviewEvents: pendingReviews,
  pendingReviewEventIds: pendingReviews.map((event) => event.id),
  retainedReviewAreas: retained,
  areas: mockWorkspace.areas.map((area) =>
    area.id === sourceReview?.areaId
      ? { ...area, cards: area.cards.filter((card) => card.id !== sourceReview.cardId) }
      : area,
  ),
  deletedCards: sourceReview ? [{ areaId: sourceReview.areaId, cardId: sourceReview.cardId }] : [],
  deletedAreas: [],
  syncContentHashes: {},
};

/** The whole area is deleted; it remains absent from the ordinary library. */
export const deletedAreaPendingWorkspace: Workspace = {
  ...deletedCardPendingWorkspace,
  areas: mockWorkspace.areas.filter((area) => area.id !== sourceReview?.areaId),
  deletedCards: [],
  deletedAreas: sourceReview ? [{ areaId: sourceReview.areaId }] : [],
};

/** Older offline data kept the review and tombstone, but lost the deleted card's content. */
export const legacyMissingReviewContentWorkspace: Workspace = {
  ...deletedAreaPendingWorkspace,
  retainedReviewAreas: [],
};
