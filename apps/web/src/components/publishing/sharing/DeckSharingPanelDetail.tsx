"use client";

import type { KnowledgeArea } from "@recall/domain";
import { Button } from "@/components/ui/Button";
import { Alert, Input, Textarea } from "@recall/ui-web";
import { Flag, Settings, X } from "lucide-react";
import { Label } from "@recall/ui-web/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@recall/ui-web/components/dialog";
import type { DeckSharingDetail, DeckSharingNotice } from "./DeckSharingPanelTypes";
import { DeckSharingPanelMetadataFields } from "./DeckSharingPanelMetadataFields";

export type DeckSharingMetadata = {
  readonly title: string;
  readonly description: string;
  readonly language: string;
  readonly tags: string;
  readonly authorName: string;
};

type DeckSharingReportReason = "spam" | "harmful" | "copyright" | "broken";

function DeckSharingReportReasonSelect({
  reason,
  onChange,
}: {
  readonly reason: DeckSharingReportReason;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Label className="grid gap-2">
      Reason
      <Select value={reason} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label="Report reason">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="spam">Spam</SelectItem>
          <SelectItem value="harmful">Harmful content</SelectItem>
          <SelectItem value="copyright">Copyright</SelectItem>
          <SelectItem value="broken">Broken content</SelectItem>
        </SelectContent>
      </Select>
    </Label>
  );
}

type DeckSharingPanelDetailProps = {
  readonly detail: DeckSharingDetail;
  readonly busy: boolean;
  readonly versionId: string;
  readonly canReview: boolean | undefined;
  readonly initialToken: string | undefined;
  readonly currentArea: KnowledgeArea | null | undefined;
  readonly following: boolean;
  readonly managing: boolean;
  readonly reporting: boolean;
  readonly notice: DeckSharingNotice | null;
  readonly metadata: DeckSharingMetadata;
  readonly reportReason: "spam" | "harmful" | "copyright" | "broken";
  readonly reportMessage: string;
  readonly blocked: boolean;
  readonly onClose: () => void;
  readonly onVersionChange: (versionId: string) => void;
  readonly onReviewVersion: (versionId: string, token?: string) => void | Promise<void>;
  readonly onToggleFollowing: () => void;
  readonly onManageOpenChange: (open: boolean) => void;
  readonly onMetadataChange: (metadata: DeckSharingMetadata) => void;
  readonly onSaveMetadata: () => void;
  readonly onSetStatus: (status: "active" | "withdrawn") => void;
  readonly onReportOpenChange: (open: boolean) => void;
  readonly onReportReasonChange: (reason: DeckSharingPanelDetailProps["reportReason"]) => void;
  readonly onReportMessageChange: (message: string) => void;
  readonly onSubmitReport: () => void;
  readonly onToggleBlock: () => void;
};

export function DeckSharingPanelDetail({
  detail,
  busy,
  versionId,
  canReview,
  initialToken,
  currentArea,
  following,
  managing,
  reporting,
  notice,
  metadata,
  reportReason,
  reportMessage,
  blocked,
  onClose,
  onVersionChange,
  onReviewVersion,
  onToggleFollowing,
  onManageOpenChange,
  onMetadataChange,
  onSaveMetadata,
  onSetStatus,
  onReportOpenChange,
  onReportReasonChange,
  onReportMessageChange,
  onSubmitReport,
  onToggleBlock,
}: DeckSharingPanelDetailProps) {
  const updateMetadata = (field: keyof DeckSharingMetadata, value: string) => {
    onMetadataChange({ ...metadata, [field]: value });
  };
  const updateReportReason = (value: string) => {
    if (value === "spam" || value === "harmful" || value === "copyright" || value === "broken")
      onReportReasonChange(value);
  };

  return (
    <div className="grid min-w-0 content-start gap-5 break-words rounded-xl border bg-card p-5">
      <div>
        <p className="text-xs text-muted-foreground">
          {detail.deck.visibility} deck · {detail.deck.status}
        </p>
        <div className="flex items-start justify-between gap-3">
          <h3 className="mt-1 text-xl font-semibold">{detail.deck.title}</h3>
          <Button
            type="button"
            variant="link"
            size="icon"
            className="shrink-0 text-muted-foreground"
            aria-label="Close deck details"
            disabled={busy}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
          {detail.deck.description}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          By {detail.deck.authorName} · {detail.deck.cardCount} cards · v{detail.deck.version}
        </p>
        {detail.deck.catalog && (
          <div className="mt-3 grid gap-2 rounded-lg bg-muted/40 p-3 text-sm">
            <p>
              {detail.deck.catalog.difficulty ?? "Difficulty unspecified"} · about{" "}
              {detail.deck.catalog.estimatedMinutes} minutes
            </p>
            <p className="text-xs text-muted-foreground">
              Time estimate uses the published card and activity counts.
            </p>
            {detail.deck.catalog.preview.map((card, index) => (
              <p key={`${String(index)}-${card.prompt}`} className="border-t pt-2 text-xs">
                {card.prompt}
                {card.answer ? ` → ${card.answer}` : ""}
              </p>
            ))}
          </div>
        )}
        {(detail.deck.license || detail.deck.attribution) && (
          <p className="mt-2 text-xs">
            {detail.deck.license && `License: ${detail.deck.license}`}
            {detail.deck.license && detail.deck.attribution ? " · " : ""}
            {detail.deck.attribution && `Attribution: ${detail.deck.attribution}`}
          </p>
        )}
      </div>
      <Label className="grid gap-2 text-sm">
        Version
        <Select value={versionId} onValueChange={onVersionChange} disabled={busy}>
          <SelectTrigger className="w-full" aria-label="Review a version">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {detail.versions.map((version) => (
              <SelectItem key={version.id} value={version.id}>
                Version {version.version} · {new Date(version.createdAt).toLocaleDateString()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
      <Button
        disabled={!canReview || busy}
        onClick={() => void onReviewVersion(versionId, initialToken)}
      >
        Review selected version
      </Button>
      {currentArea?.forkedFromVersionId &&
        currentArea.sourceId === detail.deck.id &&
        detail.deck.status === "active" && (
          <Button variant="outline" disabled={busy} onClick={onToggleFollowing}>
            {following ? "Stop following updates" : "Follow updates for this copy"}
          </Button>
        )}
      {detail.canManage && (
        <Dialog open={managing} onOpenChange={onManageOpenChange}>
          <Button
            variant="outline"
            onClick={() => {
              onManageOpenChange(true);
            }}
          >
            <Settings className="size-4" aria-hidden="true" />
            Manage published deck
          </Button>
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Manage published deck</DialogTitle>
              <DialogDescription>Edit the listing for {detail.deck.title}.</DialogDescription>
            </DialogHeader>
            {notice && (
              <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
                {notice.message}
              </Alert>
            )}
            <Label>Title</Label>
            <Input
              aria-label="Deck title"
              value={metadata.title}
              onChange={(event) => {
                updateMetadata("title", event.target.value);
              }}
            />
            <Label>Description</Label>
            <Textarea
              aria-label="Deck description"
              value={metadata.description}
              onChange={(event) => {
                updateMetadata("description", event.target.value);
              }}
            />
            <DeckSharingPanelMetadataFields metadata={metadata} onChange={updateMetadata} />
            <Label>Tags</Label>
            <Input
              aria-label="Deck tags, comma separated"
              value={metadata.tags}
              onChange={(event) => {
                updateMetadata("tags", event.target.value);
              }}
            />
            <Button disabled={busy} onClick={onSaveMetadata}>
              Save details
            </Button>
            <Button
              variant={detail.deck.status === "active" ? "destructive" : "outline"}
              disabled={busy}
              onClick={() => {
                onSetStatus(detail.deck.status === "active" ? "withdrawn" : "active");
              }}
            >
              {detail.deck.status === "active" ? "Withdraw deck" : "Reactivate deck"}
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {!detail.canManage && (
        <Dialog open={reporting} onOpenChange={onReportOpenChange}>
          <Button
            variant="link"
            className="justify-start px-0 text-muted-foreground"
            onClick={() => {
              onReportOpenChange(true);
            }}
          >
            <Flag className="size-4" aria-hidden="true" />
            Report a problem
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Report this version</DialogTitle>
              <DialogDescription>Describe a problem with {detail.deck.title}.</DialogDescription>
            </DialogHeader>
            {notice && (
              <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
                {notice.message}
              </Alert>
            )}
            <DeckSharingReportReasonSelect reason={reportReason} onChange={updateReportReason} />
            <Textarea
              aria-label="Report details"
              maxLength={2000}
              value={reportMessage}
              onChange={(event) => {
                onReportMessageChange(event.target.value);
              }}
              placeholder="Describe the issue with this version"
            />
            <Button disabled={busy || !reportMessage.trim() || !canReview} onClick={onSubmitReport}>
              Submit report
            </Button>
            <Button variant="outline" disabled={busy} onClick={onToggleBlock}>
              {blocked ? "Unblock publisher" : "Block publisher"}
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
