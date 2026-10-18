import type {
  DeckFeedback,
  DeckSubscription,
  DeckSubscriptionUpdate,
  DeckSummary,
} from "@recall/contracts";
import type { NativeDeckSharingPanelDetail as Detail } from "./NativeDeckSharingPanelDetail";
import { NativeDeckSharingPanelVersionActions } from "../NativeDeckSharingPanelVersionActions";
import { NativeDeckSharingPanelManagement } from "../NativeDeckSharingPanelManagement";
import {
  NativeDeckSharingPanelSafety,
  type NativeDeckSharingFeedbackKind,
  type NativeDeckSharingReportReason,
} from "../NativeDeckSharingPanelSafety";

type Props = {
  readonly detail: Detail | null;
  readonly identity: {
    readonly accountId: string | null;
    readonly currentArea: {
      readonly id: string;
      readonly title: string;
      readonly sourceId?: string;
      readonly sourceVersionId?: string;
    } | null;
  };
  readonly version: {
    readonly busy: boolean;
    readonly selected: string;
    readonly onSelectedChange: (value: string) => void;
    readonly accessToken: string;
    readonly subscriptions: readonly DeckSubscription[];
    readonly onReview: (versionId: string, token?: string) => void;
    readonly onFollow: (versionId: string, following: boolean) => void;
  };
  readonly owner: {
    readonly title: string;
    readonly onTitleChange: (value: string) => void;
    readonly description: string;
    readonly onDescriptionChange: (value: string) => void;
    readonly onSaveMetadata: () => void;
    readonly onWithdraw: () => void;
    readonly updates: readonly DeckSubscriptionUpdate[];
    readonly mine: readonly DeckSummary[];
    readonly onManageDeck: (deckId: string) => void;
    readonly onUnfollow: (areaId: string) => void;
  };
  readonly safety: {
    readonly feedback: readonly DeckFeedback[];
    readonly blocked: boolean;
    readonly reportReason: NativeDeckSharingReportReason;
    readonly onReportReasonChange: (value: NativeDeckSharingReportReason) => void;
    readonly reportMessage: string;
    readonly onReportMessageChange: (value: string) => void;
    readonly onReport: () => void;
    readonly onToggleBlock: () => void;
    readonly feedbackKind: NativeDeckSharingFeedbackKind;
    readonly onFeedbackKindChange: (value: NativeDeckSharingFeedbackKind) => void;
    readonly feedbackMessage: string;
    readonly onFeedbackMessageChange: (value: string) => void;
    readonly onSubmitFeedback: () => void;
    readonly onUpdateFeedback: (item: DeckFeedback) => void;
  };
};

function createActionSlots({ detail, identity, version, owner, safety }: Props) {
  if (!detail) return null;

  return {
    versionActions: (
      <NativeDeckSharingPanelVersionActions
        deckId={detail.deck.id}
        versions={detail.versions}
        accountId={identity.accountId}
        currentArea={identity.currentArea}
        busy={version.busy}
        selectedVersion={version.selected}
        onSelectedVersionChange={version.onSelectedChange}
        accessToken={version.accessToken}
        subscriptions={version.subscriptions}
        onReviewVersion={version.onReview}
        onFollowVersion={version.onFollow}
      />
    ),
    ownerActions: detail.canManage ? (
      <NativeDeckSharingPanelManagement
        deck={detail.deck}
        accountId={identity.accountId}
        busy={version.busy}
        title={owner.title}
        onTitleChange={owner.onTitleChange}
        description={owner.description}
        onDescriptionChange={owner.onDescriptionChange}
        onSaveMetadata={owner.onSaveMetadata}
        onWithdraw={owner.onWithdraw}
        updates={owner.updates}
        mine={owner.mine}
        subscriptions={version.subscriptions}
        onReviewVersion={version.onReview}
        onManageDeck={owner.onManageDeck}
        onUnfollow={owner.onUnfollow}
      />
    ) : null,
    safetyActions: (
      <NativeDeckSharingPanelSafety
        accountId={identity.accountId}
        canManage={detail.canManage}
        versions={detail.versions}
        feedback={safety.feedback}
        blocked={safety.blocked}
        busy={version.busy}
        selectedVersion={version.selected}
        reportReason={safety.reportReason}
        onReportReasonChange={safety.onReportReasonChange}
        reportMessage={safety.reportMessage}
        onReportMessageChange={safety.onReportMessageChange}
        onReport={safety.onReport}
        onToggleBlock={safety.onToggleBlock}
        feedbackKind={safety.feedbackKind}
        onFeedbackKindChange={safety.onFeedbackKindChange}
        feedbackMessage={safety.feedbackMessage}
        onFeedbackMessageChange={safety.onFeedbackMessageChange}
        onSubmitFeedback={safety.onSubmitFeedback}
        onUpdateFeedback={safety.onUpdateFeedback}
      />
    ),
  };
}
import { useMemo } from "react";

export function useNativeDeckSharingPanelDetailSlots(props: Props) {
  return useMemo(() => createActionSlots(props), [props]);
}
