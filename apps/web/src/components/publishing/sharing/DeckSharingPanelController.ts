"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { DeckSharingApi } from "@recall/application";
import type { DeckSummary } from "@recall/contracts";
import type { DeckSharingDetail, DeckSharingNotice } from "./DeckSharingPanelTypes";
import type { DeckSharingPanelProps } from "./DeckSharingPanelTypes";
import {
  deckSharingErrorMessage as messageFor,
  runDeckSharingEffect as run,
} from "./DeckSharingPanelSupport";
import { useDeckSharingPanelControllerEffects } from "./DeckSharingPanelControllerEffects";

type Metadata = {
  readonly title: string;
  readonly description: string;
  readonly language: string;
  readonly tags: string;
  readonly authorName: string;
};

type ControllerOptions = {
  readonly api: DeckSharingApi;
  readonly currentArea: DeckSharingPanelProps["currentArea"];
  readonly initialDeckId: string | undefined;
  readonly initialToken: string | undefined;
  readonly ownedOnly: boolean;
  readonly query: string;
  readonly language: string;
  readonly tag: string;
  readonly difficulty: "" | "beginner" | "intermediate" | "advanced";
  readonly activityType: string;
  readonly studyTime: "any" | "short" | "medium" | "long";
  readonly detail: DeckSharingDetail | null;
  readonly setBusy: (busy: boolean) => void;
  readonly setDecks: (
    decks: readonly DeckSummary[] | ((current: readonly DeckSummary[]) => readonly DeckSummary[]),
  ) => void;
  readonly setNextCursor: (cursor: string | null) => void;
  readonly setDetail: (
    detail:
      DeckSharingDetail | null | ((current: DeckSharingDetail | null) => DeckSharingDetail | null),
  ) => void;
  readonly setNotice: (notice: DeckSharingNotice | null) => void;
  readonly setFollowing: (following: boolean) => void;
  readonly setBlocked: (blocked: boolean) => void;
  readonly setSelected: (selected: string | null) => void;
  readonly setMetadata: (metadata: Metadata) => void;
  readonly setVersionId: (versionId: string) => void;
};

export function useDeckSharingPanelController(options: ControllerOptions) {
  const {
    api,
    currentArea,
    initialDeckId,
    initialToken,
    ownedOnly,
    query,
    language,
    tag,
    difficulty,
    activityType,
    studyTime,
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
  } = options;
  const selectedRef = useRef<string | null>(initialDeckId ?? null);
  const mounted = useRef(true);
  const scopeRef = useRef({ api, token: initialToken, generation: 0 });
  useLayoutEffect(() => {
    if (scopeRef.current.api !== api || scopeRef.current.token !== initialToken) {
      scopeRef.current = {
        api,
        token: initialToken,
        generation: scopeRef.current.generation + 1,
      };
    }
  }, [api, initialToken]);
  const listSequence = useRef(0);
  const detailSequenceRef = useRef(0);
  const subscriptionSequenceRef = useRef(0);
  const initialDetailLoadedRef = useRef("");
  const appliedScopeRef = useRef(0);
  const initialRouteId = useRef(initialDeckId);
  const filtersRef = useRef({
    api,
    ownedOnly,
    query,
    language,
    tag,
    difficulty,
    activityType,
    studyTime,
  });
  const areaContextRef = useRef({
    id: currentArea?.id,
    sourceId: currentArea?.sourceId,
    forkedFromVersionId: currentArea?.forkedFromVersionId,
  });
  const pendingCount = useRef(0);
  const mutationPending = useRef(false);

  useLayoutEffect(() => {
    const previous = filtersRef.current;
    if (
      previous.api !== api ||
      previous.ownedOnly !== ownedOnly ||
      previous.query !== query ||
      previous.language !== language ||
      previous.tag !== tag ||
      previous.difficulty !== difficulty ||
      previous.activityType !== activityType ||
      previous.studyTime !== studyTime
    ) {
      filtersRef.current = {
        api,
        ownedOnly,
        query,
        language,
        tag,
        difficulty,
        activityType,
        studyTime,
      };
      listSequence.current += 1;
    }
  }, [api, ownedOnly, query, language, tag, difficulty, activityType, studyTime]);
  useLayoutEffect(() => {
    if (initialRouteId.current !== initialDeckId) {
      initialRouteId.current = initialDeckId;
      detailSequenceRef.current += 1;
    }
  }, [initialDeckId]);
  useLayoutEffect(() => {
    const previous = areaContextRef.current;
    if (
      previous.id !== currentArea?.id ||
      previous.sourceId !== currentArea?.sourceId ||
      previous.forkedFromVersionId !== currentArea?.forkedFromVersionId
    ) {
      areaContextRef.current = {
        id: currentArea?.id,
        sourceId: currentArea?.sourceId,
        forkedFromVersionId: currentArea?.forkedFromVersionId,
      };
      subscriptionSequenceRef.current += 1;
    }
  }, [currentArea]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listSequence.current += 1;
      detailSequenceRef.current += 1;
    };
  }, []);

  const beginPending = useCallback(() => {
    pendingCount.current += 1;
    if (mounted.current) setBusy(true);
  }, [setBusy]);
  const endPending = useCallback(() => {
    pendingCount.current = Math.max(0, pendingCount.current - 1);
    if (mounted.current) setBusy(pendingCount.current > 0);
  }, [setBusy]);
  const isScopeCurrent = useCallback(
    (generation: number) => mounted.current && scopeRef.current.generation === generation,
    [],
  );
  const isDetailCurrent = useCallback(
    (generation: number, sequence: number) =>
      isScopeCurrent(generation) && detailSequenceRef.current === sequence,
    [isScopeCurrent],
  );

  const runMutation = async (operation: () => Promise<void>) => {
    if (mutationPending.current || !mounted.current) return;
    mutationPending.current = true;
    beginPending();
    try {
      await operation();
    } finally {
      mutationPending.current = false;
      endPending();
    }
  };

  const loadList = useCallback(
    async (options: { readonly cursor?: string; readonly append?: boolean } = {}) => {
      if (!mounted.current) return;
      const generation = scopeRef.current.generation;
      const sequence = ++listSequence.current;
      beginPending();
      try {
        const list = ownedOnly
          ? await run(
              api.listMine({ limit: 20, ...(options.cursor ? { cursor: options.cursor } : {}) }),
            )
          : await run(
              api.discover({
                q: query,
                language,
                tag,
                ...(difficulty ? { difficulty } : {}),
                ...(activityType ? { activityType } : {}),
                ...(studyTime === "short" ? { maxMinutes: 10 } : {}),
                ...(studyTime === "medium" ? { minMinutes: 11, maxMinutes: 30 } : {}),
                ...(studyTime === "long" ? { minMinutes: 31 } : {}),
                limit: 20,
                ...(options.cursor ? { cursor: options.cursor } : {}),
              }),
            );
        if (!isScopeCurrent(generation) || listSequence.current !== sequence) return;
        if (list._tag === "Left") setNotice({ kind: "error", message: messageFor(list.left) });
        else {
          setDecks((current) =>
            options.append ? [...current, ...list.right.decks] : list.right.decks,
          );
          setNextCursor(list.right.nextCursor);
          setNotice(null);
        }
      } finally {
        endPending();
      }
    },
    [
      api,
      ownedOnly,
      query,
      language,
      tag,
      difficulty,
      activityType,
      studyTime,
      beginPending,
      endPending,
      isScopeCurrent,
      setDecks,
      setNextCursor,
      setNotice,
    ],
  );

  useEffect(() => {
    let current = true;
    const isCurrent = () => current;
    void Promise.resolve().then(() => {
      if (isCurrent()) void loadList();
    });
    return () => {
      current = false;
    };
  }, [loadList]);

  const loadDetail = useCallback(
    async (deckId: string) => {
      if (!mounted.current) return;
      const generation = scopeRef.current.generation;
      const sequence = ++detailSequenceRef.current;
      setDetail(null);
      setFollowing(false);
      setBlocked(false);
      setNotice(null);
      selectedRef.current = deckId;
      setSelected(deckId);
      beginPending();
      try {
        const result = await run(api.read(deckId, initialToken));
        if (!isDetailCurrent(generation, sequence)) return;
        if (result._tag === "Left") {
          setNotice({ kind: "error", message: messageFor(result.left) });
          return;
        }
        setDetail(result.right);
        setMetadata({
          title: result.right.deck.title,
          description: result.right.deck.description,
          language: result.right.deck.language,
          tags: result.right.deck.tags.join(", "),
          authorName: result.right.deck.authorName,
        });
        setVersionId(result.right.deck.latestVersionId);
      } finally {
        endPending();
      }
    },
    [
      api,
      initialToken,
      beginPending,
      endPending,
      isDetailCurrent,
      setDetail,
      setFollowing,
      setBlocked,
      setNotice,
      setSelected,
      setMetadata,
      setVersionId,
    ],
  );

  const closeDetail = useCallback(() => {
    detailSequenceRef.current += 1;
    selectedRef.current = null;
    setSelected(null);
    setDetail(null);
  }, [setSelected, setDetail]);

  useDeckSharingPanelControllerEffects({
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
  });

  return {
    generation: () => scopeRef.current.generation,
    detailSequenceNumber: () => detailSequenceRef.current,
    loadList,
    loadDetail,
    runMutation,
    isDetailCurrent,
    closeDetail,
  };
}
