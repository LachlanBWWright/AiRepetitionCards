"use client";

import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { DeckSharingApi } from "@recall/application";
import type { DeckSharingDetail, DeckSharingNotice } from "./DeckSharingPanelTypes";
import { deckSharingErrorMessage, runDeckSharingEffect } from "./DeckSharingPanelSupport";

type Metadata = {
  readonly title: string;
  readonly description: string;
  readonly language: string;
  readonly tags: string;
  readonly authorName: string;
};

type ReportReason = "spam" | "harmful" | "copyright" | "broken";

type DeckSharingPanelMutationOptions = {
  readonly api: DeckSharingApi;
  readonly detail: DeckSharingDetail | null;
  readonly metadata: Metadata;
  readonly currentAreaId: string | undefined;
  readonly currentAreaVersionId: string | undefined;
  readonly following: boolean;
  readonly blocked: boolean;
  readonly versionId: string;
  readonly reportReason: ReportReason;
  readonly reportMessage: string;
  readonly initialToken: string | undefined;
  readonly reportOperationRef: {
    current: { readonly key: string; readonly id: string } | null;
  };
  readonly generation: () => number;
  readonly detailSequence: () => number;
  readonly isDetailCurrent: (generation: number, sequence: number) => boolean;
  readonly runMutation: (operation: () => Promise<void>) => Promise<void>;
  readonly setDetail: Dispatch<SetStateAction<DeckSharingDetail | null>>;
  readonly setNotice: Dispatch<SetStateAction<DeckSharingNotice | null>>;
  readonly setFollowing: Dispatch<SetStateAction<boolean>>;
  readonly setBlocked: Dispatch<SetStateAction<boolean>>;
  readonly setReportMessage: Dispatch<SetStateAction<string>>;
  readonly loadList: () => Promise<void>;
};

export function useDeckSharingPanelMutations(options: DeckSharingPanelMutationOptions) {
  const {
    api,
    detail,
    metadata,
    currentAreaId,
    currentAreaVersionId,
    following,
    blocked,
    versionId,
    reportReason,
    reportMessage,
    initialToken,
    reportOperationRef,
    generation,
    detailSequence,
    isDetailCurrent,
    runMutation,
    setDetail,
    setNotice,
    setFollowing,
    setBlocked,
    setReportMessage,
    loadList,
  } = options;

  const saveMetadata = useCallback(async () => {
    if (!detail) return;
    const currentGeneration = generation();
    const sequence = detailSequence();
    await runMutation(async () => {
      const result = await runDeckSharingEffect(
        api.updateDeck(detail.deck.id, {
          title: metadata.title,
          description: metadata.description,
          language: metadata.language,
          tags: metadata.tags
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          authorName: metadata.authorName,
        }),
      );
      if (!isDetailCurrent(currentGeneration, sequence)) return;
      if (result._tag === "Left")
        setNotice({ kind: "error", message: deckSharingErrorMessage(result.left) });
      else {
        setDetail((current) => (current ? { ...current, deck: result.right.deck } : current));
        setNotice({ kind: "success", message: "Deck details saved." });
        void loadList();
      }
    });
  }, [
    api,
    detail,
    metadata,
    generation,
    detailSequence,
    runMutation,
    isDetailCurrent,
    setNotice,
    setDetail,
    loadList,
  ]);

  const setStatus = useCallback(
    async (status: "active" | "withdrawn") => {
      if (!detail) return;
      const currentGeneration = generation();
      const sequence = detailSequence();
      await runMutation(async () => {
        const result = await runDeckSharingEffect(api.updateDeck(detail.deck.id, { status }));
        if (!isDetailCurrent(currentGeneration, sequence)) return;
        if (result._tag === "Left")
          setNotice({ kind: "error", message: deckSharingErrorMessage(result.left) });
        else {
          setDetail((current) => (current ? { ...current, deck: result.right.deck } : current));
          setNotice({
            kind: "success",
            message:
              status === "withdrawn"
                ? "Deck withdrawn. Existing personal copies remain available."
                : "Deck is active again.",
          });
          void loadList();
        }
      });
    },
    [
      api,
      detail,
      generation,
      detailSequence,
      runMutation,
      isDetailCurrent,
      setNotice,
      setDetail,
      loadList,
    ],
  );

  const toggleFollowing = useCallback(async () => {
    if (!detail || !currentAreaId) return;
    const currentGeneration = generation();
    const sequence = detailSequence();
    await runMutation(async () => {
      const result = await runDeckSharingEffect(
        api.putSubscription({
          deckId: detail.deck.id,
          areaId: currentAreaId,
          versionId: currentAreaVersionId ?? versionId,
          following: !following,
        }),
      );
      if (!isDetailCurrent(currentGeneration, sequence)) return;
      if (result._tag === "Left")
        setNotice({ kind: "error", message: deckSharingErrorMessage(result.left) });
      else {
        setFollowing(!following);
        setNotice({
          kind: "success",
          message: following
            ? "Following stopped."
            : "You’ll be notified when this deck has updates.",
        });
      }
    });
  }, [
    api,
    detail,
    currentAreaId,
    currentAreaVersionId,
    versionId,
    following,
    generation,
    detailSequence,
    runMutation,
    isDetailCurrent,
    setNotice,
    setFollowing,
  ]);

  const submitReport = useCallback(async () => {
    if (!detail || !reportMessage.trim()) return;
    const reportKey = `${detail.deck.id}\u0000${versionId}\u0000${reportReason}\u0000${reportMessage.trim()}`;
    const reportId =
      reportOperationRef.current?.key === reportKey
        ? reportOperationRef.current.id
        : crypto.randomUUID();
    reportOperationRef.current = { key: reportKey, id: reportId };
    const currentGeneration = generation();
    const sequence = detailSequence();
    await runMutation(async () => {
      const result = await runDeckSharingEffect(
        api.reportDeck(detail.deck.id, {
          id: reportId,
          versionId,
          reason: reportReason,
          message: reportMessage.trim(),
          ...(initialToken ? { token: initialToken } : {}),
        }),
      );
      if (!isDetailCurrent(currentGeneration, sequence)) return;
      if (result._tag === "Left")
        setNotice({ kind: "error", message: deckSharingErrorMessage(result.left) });
      else {
        reportOperationRef.current = null;
        setReportMessage("");
        setNotice({ kind: "success", message: "Report submitted for review." });
      }
    });
  }, [
    api,
    detail,
    reportMessage,
    versionId,
    reportReason,
    reportOperationRef,
    generation,
    detailSequence,
    runMutation,
    isDetailCurrent,
    initialToken,
    setNotice,
    setReportMessage,
  ]);

  const toggleBlock = useCallback(async () => {
    if (!detail) return;
    const currentGeneration = generation();
    const sequence = detailSequence();
    await runMutation(async () => {
      const result = await runDeckSharingEffect(
        blocked
          ? api.unblockDeck(detail.deck.id, initialToken)
          : api.blockDeck(detail.deck.id, initialToken),
      );
      if (!isDetailCurrent(currentGeneration, sequence)) return;
      if (result._tag === "Left")
        setNotice({ kind: "error", message: deckSharingErrorMessage(result.left) });
      else {
        setBlocked(result.right.blocked);
        setNotice({
          kind: "success",
          message: blocked
            ? "Publisher unblocked."
            : "Publisher blocked from your discovery and updates.",
        });
      }
    });
  }, [
    api,
    detail,
    blocked,
    initialToken,
    generation,
    detailSequence,
    runMutation,
    isDetailCurrent,
    setNotice,
    setBlocked,
  ]);

  return { saveMetadata, setStatus, toggleFollowing, submitReport, toggleBlock };
}
