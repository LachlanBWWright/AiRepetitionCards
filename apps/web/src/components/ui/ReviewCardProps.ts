import type { ReactNode } from "react";
import type { summarizeStudySession } from "@recall/application";
import type { LearningArea, Assessment, ReviewerSettings } from "@recall/domain";
import type { SchedulerParameters } from "@recall/scheduler";
import type { ReviewRating } from "./ReviewCard";

export type ReviewCardProps = {
  readonly helpAction?: ReactNode;
  area: Pick<LearningArea, "title" | "color"> | undefined;
  readonly session?: ReturnType<typeof summarizeStudySession>;
  readonly now?: Date;
  readonly schedulerParameters?: SchedulerParameters | undefined;
  readonly onBack?: () => void;
  readonly onNextDeck?: (() => void) | undefined;
  readonly flagged?: boolean;
  readonly flaggedCount?: number;
  readonly onFlag?: (card: Assessment) => void;
  readonly onEditFlagged?: () => void;
  card: Assessment | undefined;
  showAnswer: boolean;
  onReveal: () => void;
  onRate: (rating: ReviewRating) => void;
  onEdit?: (card: Assessment) => void;
  onDelete?: (card: Assessment) => void;
  onAddCard: () => void;
  mediaPreviews?: readonly {
    readonly id?: string;
    readonly mimeType: string;
    readonly url: string;
  }[];
  keyboardActive?: boolean;
  disabled?: boolean;
  saving?: boolean;
  readonly reviewerSettings?: ReviewerSettings | undefined;
};
