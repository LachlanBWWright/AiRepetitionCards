"use client";

import { useMemo, useRef, useState } from "react";
import type { DeckSummary } from "@recall/contracts";

import type {
  DeckSharingPanelProps,
  DeckSharingNotice,
  DeckSharingDetail,
} from "./DeckSharingPanelTypes";
import { DeckSharingPanelDetail } from "./DeckSharingPanelDetail";
import { DeckSharingPanelBrowse } from "./DeckSharingPanelBrowse";
import { DeckSharingPanelBrowseFilters } from "./DeckSharingPanelBrowseFilters";
import { DeckSharingPanelBrowseResults } from "./DeckSharingPanelBrowseResults";
import { useDeckSharingPanelController } from "./DeckSharingPanelController";
import { useDeckSharingPanelMutations } from "./DeckSharingPanelMutations";
import { useDeckSharingBrowseFilters } from "./useDeckSharingBrowseFilters";
export function DeckSharingPanel({
  api,
  currentArea,
  onReviewVersion,
  onOpenDeck,
  initialDeckId,
  initialToken,
}: DeckSharingPanelProps) {
  const { filters, updateFilter, clearFilters, ownedOnly, setOwnedOnly } =
    useDeckSharingBrowseFilters();
  const [managing, setManaging] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [decks, setDecks] = useState<readonly DeckSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialDeckId ?? null);
  const [detail, setDetail] = useState<DeckSharingDetail | null>(null);
  const [notice, setNotice] = useState<DeckSharingNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [metadata, setMetadata] = useState({
    title: "",
    description: "",
    language: "",
    tags: "",
    authorName: "",
  });
  const [following, setFollowing] = useState(false);
  const [reportReason, setReportReason] = useState<"spam" | "harmful" | "copyright" | "broken">(
    "broken",
  );
  const [reportMessage, setReportMessage] = useState("");
  const [blocked, setBlocked] = useState(false);
  const reportOperation = useRef<{ readonly key: string; readonly id: string } | null>(null);
  const [versionId, setVersionId] = useState("");

  const {
    generation,
    detailSequenceNumber,
    loadList,
    loadDetail,
    runMutation,
    isDetailCurrent,
    closeDetail,
  } = useDeckSharingPanelController({
    api,
    currentArea,
    initialDeckId,
    initialToken,
    ownedOnly,
    query: filters.query,
    language: filters.language,
    tag: filters.tag,
    difficulty: filters.difficulty,
    activityType: filters.activityType,
    studyTime: filters.studyTime,
    detail,
    setBusy,
    setDecks,
    setNextCursor,
    setDetail,
    setNotice,
    setFollowing,
    setBlocked,
    setSelected,
    setMetadata,
    setVersionId,
  });

  const canReview = useMemo(
    () => detail?.versions.some((version) => version.id === versionId),
    [detail, versionId],
  );
  const { saveMetadata, setStatus, toggleFollowing, submitReport, toggleBlock } =
    useDeckSharingPanelMutations({
      api,
      detail,
      metadata,
      currentAreaId: currentArea?.id,
      currentAreaVersionId: currentArea?.forkedFromVersionId,
      following,
      blocked,
      versionId,
      reportReason,
      reportMessage,
      initialToken,
      reportOperationRef: reportOperation,
      generation,
      detailSequence: detailSequenceNumber,
      isDetailCurrent,
      runMutation,
      setDetail,
      setNotice,
      setFollowing,
      setBlocked,
      setReportMessage,
      loadList,
    });

  return (
    <section
      className={`grid min-w-0 gap-6 ${detail ? "lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]" : ""}`}
      aria-label="Deck discovery and sharing"
    >
      <DeckSharingPanelBrowse
        filters={
          <DeckSharingPanelBrowseFilters
            filters={filters}
            onFilterChange={updateFilter}
            onClearFilters={clearFilters}
            ownedOnly={ownedOnly}
            onOwnedOnlyChange={setOwnedOnly}
            decks={decks}
            busy={busy}
            onSearch={() => void loadList()}
          />
        }
        results={
          <DeckSharingPanelBrowseResults
            decks={decks}
            selected={selected}
            detail={detail}
            ownedOnly={ownedOnly}
            busy={busy}
            nextCursor={nextCursor}
            loadList={loadList}
            loadDetail={loadDetail}
            onSelectDeck={() => {
              setManaging(false);
              setReporting(false);
            }}
            {...(onOpenDeck ? { onOpenDeck } : {})}
            {...(initialToken !== undefined ? { initialToken } : {})}
          />
        }
        notice={notice}
      />

      {detail && (
        <DeckSharingPanelDetail
          detail={detail}
          busy={busy}
          versionId={versionId}
          canReview={canReview}
          initialToken={initialToken}
          currentArea={currentArea}
          following={following}
          managing={managing}
          reporting={reporting}
          notice={notice}
          metadata={metadata}
          reportReason={reportReason}
          reportMessage={reportMessage}
          blocked={blocked}
          onClose={closeDetail}
          onVersionChange={setVersionId}
          onReviewVersion={onReviewVersion}
          onToggleFollowing={() => void toggleFollowing()}
          onManageOpenChange={setManaging}
          onMetadataChange={setMetadata}
          onSaveMetadata={() => void saveMetadata()}
          onSetStatus={(status) => void setStatus(status)}
          onReportOpenChange={setReporting}
          onReportReasonChange={setReportReason}
          onReportMessageChange={setReportMessage}
          onSubmitReport={() => void submitReport()}
          onToggleBlock={() => void toggleBlock()}
        />
      )}
    </section>
  );
}
