"use client";

import { useEffect } from "react";
import type { DeckSharingApi } from "@recall/application";
import type { DeckSharingDetail, DeckSharingNotice } from "./DeckSharingPanelTypes";
import {
  deckSharingErrorMessage as messageFor,
  runDeckSharingEffect as run,
} from "./DeckSharingPanelSupport";

type MutableRef<T> = { current: T };
type ControllerEffectOptions = {
  readonly api: DeckSharingApi;
  readonly currentArea: { readonly id: string } | null | undefined;
  readonly detail: DeckSharingDetail | null;
  readonly initialDeckId: string | undefined;
  readonly initialToken: string | undefined;
  readonly scopeRef: MutableRef<{ readonly generation: number }>;
  readonly detailSequenceRef: MutableRef<number>;
  readonly subscriptionSequenceRef: MutableRef<number>;
  readonly initialDetailLoadedRef: MutableRef<string>;
  readonly appliedScopeRef: MutableRef<number>;
  readonly selectedRef: MutableRef<string | null>;
  readonly loadDetail: (deckId: string) => Promise<void>;
  readonly isScopeCurrent: (generation: number) => boolean;
  readonly isDetailCurrent: (generation: number, sequence: number) => boolean;
  readonly setDetail: (detail: DeckSharingDetail | null) => void;
  readonly setFollowing: (following: boolean) => void;
  readonly setNotice: (notice: DeckSharingNotice | null) => void;
  readonly setSelected: (selected: string | null) => void;
};

export function useDeckSharingPanelControllerEffects(options: ControllerEffectOptions) {
  const {
    api,
    currentArea,
    detail,
    initialDeckId,
    initialToken,
    scopeRef,
    detailSequenceRef,
    subscriptionSequenceRef,
    initialDetailLoadedRef,
    appliedScopeRef,
    selectedRef,
    loadDetail,
    isScopeCurrent,
    isDetailCurrent,
    setDetail,
    setFollowing,
    setNotice,
    setSelected,
  } = options;
  useEffect(() => {
    const sequence = ++subscriptionSequenceRef.current;
    const generation = scopeRef.current.generation;
    const detailRequest = detailSequenceRef.current;
    const deckId = detail?.deck.id;
    let current = true;
    const isCurrent = () => current;
    void Promise.resolve().then(async () => {
      if (!isCurrent() || !isScopeCurrent(generation)) return;
      if (!currentArea || !deckId) {
        setFollowing(false);
        return;
      }
      const result = await run(api.listSubscriptions());
      if (
        !isCurrent() ||
        subscriptionSequenceRef.current !== sequence ||
        !isDetailCurrent(generation, detailRequest)
      )
        return;
      if (result._tag === "Left") {
        setNotice({
          kind: "error",
          message: `Following status could not be loaded. ${messageFor(result.left)}`,
        });
      } else {
        setFollowing(
          result.right.subscriptions.some(
            (item) => item.deckId === deckId && item.areaId === currentArea.id && item.following,
          ),
        );
      }
    });
    return () => {
      current = false;
      subscriptionSequenceRef.current += 1;
    };
  }, [
    api,
    currentArea,
    detail?.deck.id,
    detailSequenceRef,
    isDetailCurrent,
    isScopeCurrent,
    scopeRef,
    setFollowing,
    setNotice,
    subscriptionSequenceRef,
  ]);

  useEffect(() => {
    const marker = `${String(scopeRef.current.generation)}:${String(initialDeckId)}`;
    if (
      !initialDeckId ||
      (initialDetailLoadedRef.current === marker && selectedRef.current === initialDeckId)
    )
      return;
    initialDetailLoadedRef.current = marker;
    const startingSequence = detailSequenceRef.current;
    let current = true;
    const isCurrent = () => current;
    void Promise.resolve().then(() => {
      if (isCurrent() && detailSequenceRef.current === startingSequence)
        void loadDetail(initialDeckId);
    });
    return () => {
      current = false;
    };
  }, [detailSequenceRef, initialDeckId, initialDetailLoadedRef, loadDetail, scopeRef, selectedRef]);

  useEffect(() => {
    const generation = scopeRef.current.generation;
    if (appliedScopeRef.current === generation) return;
    appliedScopeRef.current = generation;
    let current = true;
    const isCurrent = () => current;
    void Promise.resolve().then(() => {
      if (!isCurrent() || !isScopeCurrent(generation)) return;
      const reloadId = initialDeckId ?? selectedRef.current;
      setDetail(null);
      setFollowing(false);
      setNotice(null);
      if (reloadId && !initialDeckId) void loadDetail(reloadId);
      else {
        selectedRef.current = null;
        setSelected(null);
      }
    });
    return () => {
      current = false;
    };
  }, [
    api,
    initialToken,
    initialDeckId,
    isScopeCurrent,
    loadDetail,
    appliedScopeRef,
    scopeRef,
    selectedRef,
    setDetail,
    setFollowing,
    setNotice,
    setSelected,
  ]);
}
