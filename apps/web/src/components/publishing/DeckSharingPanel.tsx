"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Effect } from "effect";
import type { DeckSharingApi } from "@recall/application";
import type { DeckSummary, DeckVersionSummary } from "@recall/contracts";
import type { KnowledgeArea } from "@recall/domain";
import { Button } from "@/components/ui/Button";
import { Alert, Input, Textarea } from "@recall/ui-web";

type Props = {
  readonly api: DeckSharingApi;
  readonly currentArea?: KnowledgeArea | null;
  readonly onReviewVersion: (versionId: string, token?: string) => void | Promise<void>;
  readonly onOpenDeck?: (deckId: string, token?: string) => void;
  readonly initialDeckId?: string;
  readonly initialToken?: string;
};

type Notice = { readonly kind: "error" | "success"; readonly message: string };
const run = <A,>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(Effect.either(effect));
const messageFor = (error: unknown): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status === 401
      ? "Sign in to use this feature."
      : `The request failed (${error.status}). Please try again.`;
  }
  return "The response could not be loaded. Check your connection and try again.";
};
export function DeckSharingPanel({
  api,
  currentArea,
  onReviewVersion,
  onOpenDeck,
  initialDeckId,
  initialToken,
}: Props) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [tag, setTag] = useState("");
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [decks, setDecks] = useState<readonly DeckSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(initialDeckId ?? null);
  const selectedRef = useRef<string | null>(initialDeckId ?? null);
  const [detail, setDetail] = useState<{
    readonly deck: DeckSummary;
    readonly versions: readonly DeckVersionSummary[];
    readonly canManage: boolean;
  } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
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
  const detailSequence = useRef(0);
  const subscriptionSequence = useRef(0);
  const initialDetailLoaded = useRef("");
  const appliedScope = useRef(0);
  const initialRouteId = useRef(initialDeckId);
  const filtersRef = useRef({ api, ownedOnly, query, language, tag });
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
      previous.tag !== tag
    ) {
      filtersRef.current = { api, ownedOnly, query, language, tag };
      listSequence.current += 1;
    }
  }, [api, ownedOnly, query, language, tag]);
  useLayoutEffect(() => {
    if (initialRouteId.current !== initialDeckId) {
      initialRouteId.current = initialDeckId;
      detailSequence.current += 1;
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
      subscriptionSequence.current += 1;
    }
  }, [currentArea]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listSequence.current += 1;
      detailSequence.current += 1;
    };
  }, []);

  const beginPending = useCallback(() => {
    pendingCount.current += 1;
    if (mounted.current) setBusy(true);
  }, []);
  const endPending = useCallback(() => {
    pendingCount.current = Math.max(0, pendingCount.current - 1);
    if (mounted.current) setBusy(pendingCount.current > 0);
  }, []);
  const isScopeCurrent = useCallback(
    (generation: number) => mounted.current && scopeRef.current.generation === generation,
    [],
  );
  const isDetailCurrent = useCallback(
    (generation: number, sequence: number) =>
      isScopeCurrent(generation) && detailSequence.current === sequence,
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
    [api, ownedOnly, query, language, tag, beginPending, endPending, isScopeCurrent],
  );

  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => {
      if (current) void loadList();
    });
    return () => {
      current = false;
    };
  }, [loadList]);

  const loadDetail = useCallback(
    async (deckId: string) => {
      if (!mounted.current) return;
      const generation = scopeRef.current.generation;
      const sequence = ++detailSequence.current;
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
    [api, initialToken, beginPending, endPending, isDetailCurrent],
  );

  useEffect(() => {
    const sequence = ++subscriptionSequence.current;
    const generation = scopeRef.current.generation;
    const detailRequest = detailSequence.current;
    const deckId = detail?.deck.id;
    let current = true;
    void Promise.resolve().then(async () => {
      if (!current || !isScopeCurrent(generation)) return;
      if (!currentArea || !deckId) {
        setFollowing(false);
        return;
      }
      const result = await run(api.listSubscriptions());
      if (
        !current ||
        subscriptionSequence.current !== sequence ||
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
      subscriptionSequence.current += 1;
    };
  }, [api, currentArea, detail?.deck.id, isDetailCurrent, isScopeCurrent]);

  useEffect(() => {
    const marker = `${scopeRef.current.generation}:${initialDeckId}`;
    if (
      !initialDeckId ||
      (initialDetailLoaded.current === marker && selectedRef.current === initialDeckId)
    )
      return;
    initialDetailLoaded.current = marker;
    const startingSequence = detailSequence.current;
    let current = true;
    void Promise.resolve().then(() => {
      if (current && detailSequence.current === startingSequence) void loadDetail(initialDeckId);
    });
    return () => {
      current = false;
    };
  }, [initialDeckId, loadDetail]);

  useEffect(() => {
    const generation = scopeRef.current.generation;
    if (appliedScope.current === generation) return;
    appliedScope.current = generation;
    let current = true;
    void Promise.resolve().then(() => {
      if (!current || !isScopeCurrent(generation)) return;
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
  }, [api, initialToken, initialDeckId, isScopeCurrent, loadDetail]);

  const canReview = useMemo(
    () => detail?.versions.some((version) => version.id === versionId),
    [detail, versionId],
  );
  const saveMetadata = async () => {
    if (!detail) return;
    const generation = scopeRef.current.generation;
    const sequence = detailSequence.current;
    await runMutation(async () => {
      const result = await run(
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
      if (!isDetailCurrent(generation, sequence)) return;
      if (result._tag === "Left") setNotice({ kind: "error", message: messageFor(result.left) });
      else {
        setDetail((current) => (current ? { ...current, deck: result.right.deck } : current));
        setNotice({ kind: "success", message: "Deck details saved." });
        void loadList();
      }
    });
  };
  const setStatus = async (status: "active" | "withdrawn") => {
    if (!detail) return;
    const generation = scopeRef.current.generation;
    const sequence = detailSequence.current;
    await runMutation(async () => {
      const result = await run(api.updateDeck(detail.deck.id, { status }));
      if (!isDetailCurrent(generation, sequence)) return;
      if (result._tag === "Left") setNotice({ kind: "error", message: messageFor(result.left) });
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
  };
  const toggleFollowing = async () => {
    if (!detail || !currentArea) return;
    const generation = scopeRef.current.generation;
    const sequence = detailSequence.current;
    await runMutation(async () => {
      const result = await run(
        api.putSubscription({
          deckId: detail.deck.id,
          areaId: currentArea.id,
          versionId: currentArea.forkedFromVersionId ?? versionId,
          following: !following,
        }),
      );
      if (!isDetailCurrent(generation, sequence)) return;
      if (result._tag === "Left") setNotice({ kind: "error", message: messageFor(result.left) });
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
  };
  const submitReport = async () => {
    if (!detail || !reportMessage.trim()) return;
    const reportKey = `${detail.deck.id}\u0000${versionId}\u0000${reportReason}\u0000${reportMessage.trim()}`;
    const reportId =
      reportOperation.current?.key === reportKey ? reportOperation.current.id : crypto.randomUUID();
    reportOperation.current = { key: reportKey, id: reportId };
    const generation = scopeRef.current.generation;
    const sequence = detailSequence.current;
    await runMutation(async () => {
      const result = await run(
        api.reportDeck(detail.deck.id, {
          id: reportId,
          versionId,
          reason: reportReason,
          message: reportMessage.trim(),
          ...(initialToken ? { token: initialToken } : {}),
        }),
      );
      if (!isDetailCurrent(generation, sequence)) return;
      if (result._tag === "Left") setNotice({ kind: "error", message: messageFor(result.left) });
      else {
        reportOperation.current = null;
        setReportMessage("");
        setNotice({ kind: "success", message: "Report submitted for review." });
      }
    });
  };
  const toggleBlock = async () => {
    if (!detail) return;
    const generation = scopeRef.current.generation;
    const sequence = detailSequence.current;
    await runMutation(async () => {
      const result = await run(
        blocked
          ? api.unblockDeck(detail.deck.id, initialToken)
          : api.blockDeck(detail.deck.id, initialToken),
      );
      if (!isDetailCurrent(generation, sequence)) return;
      if (result._tag === "Left") setNotice({ kind: "error", message: messageFor(result.left) });
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
  };

  return (
    <section
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]"
      aria-label="Deck discovery and sharing"
    >
      <div className="grid content-start gap-4">
        <header className="space-y-2">
          <h2 className="text-2xl font-semibold">Discover decks</h2>
          <p className="text-sm text-muted-foreground">
            Browse shared study decks, review a version, and choose when to make a personal copy.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            aria-label="Search decks"
            placeholder="Search titles and descriptions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Input
            aria-label="Filter by language"
            placeholder="Language (for example en)"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          />
          <Input
            aria-label="Filter by tag"
            placeholder="Tag"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant={ownedOnly ? "secondary" : "outline"}
              onClick={() => setOwnedOnly((value) => !value)}
            >
              {ownedOnly ? "Showing my decks" : "Browse my decks"}
            </Button>
            <Button variant="outline" onClick={() => void loadList()} disabled={busy}>
              Search
            </Button>
          </div>
        </div>
        {notice && (
          <Alert variant={notice.kind === "error" ? "destructive" : "default"}>
            {notice.message}
          </Alert>
        )}
        <div className="grid gap-3">
          {decks.map((deck) => (
            <article
              key={deck.id}
              className={`rounded-xl border p-4 transition hover:border-primary ${selected === deck.id ? "border-primary bg-muted/40" : "bg-card"}`}
            >
              <button className="w-full text-left" onClick={() => void loadDetail(deck.id)}>
                <span className="flex items-start justify-between gap-3">
                  <span className="font-semibold">{deck.title}</span>
                  <span className="text-xs text-muted-foreground">
                    v{deck.version} · {deck.cardCount} cards
                  </span>
                </span>
                <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">
                  {deck.description || "No description provided."}
                </span>
                <span className="mt-2 block text-xs text-muted-foreground">
                  {deck.authorName} · {deck.language} · {deck.visibility}
                  {deck.status === "withdrawn" ? " · withdrawn" : ""}
                </span>
                {deck.tags.length > 0 && (
                  <span className="mt-2 block text-xs">{deck.tags.join(" · ")}</span>
                )}
              </button>
              {onOpenDeck && (
                <button
                  className="mt-3 inline-block text-left text-sm font-medium text-primary underline-offset-4 hover:underline"
                  type="button"
                  onClick={() => onOpenDeck(deck.id, initialToken)}
                >
                  Open stable deck page
                </button>
              )}
            </article>
          ))}
          {decks.length === 0 && !busy && (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No decks match these filters.
            </p>
          )}
        </div>
        {nextCursor && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void loadList({ cursor: nextCursor, append: true })}
          >
            Load more decks
          </Button>
        )}
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        )}
      </div>

      <div className="grid content-start gap-5 rounded-2xl border bg-card p-5">
        {!detail ? (
          <div>
            <h3 className="text-lg font-semibold">Choose a deck</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Deck details and available versions will appear here.
            </p>
          </div>
        ) : (
          <>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {detail.deck.visibility} deck · {detail.deck.status}
              </p>
              <h3 className="mt-1 text-xl font-semibold">{detail.deck.title}</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {detail.deck.description}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                By {detail.deck.authorName} · {detail.deck.cardCount} cards · v{detail.deck.version}
              </p>
              {(detail.deck.license || detail.deck.attribution) && (
                <p className="mt-2 text-xs">
                  {detail.deck.license && `License: ${detail.deck.license}`}
                  {detail.deck.license && detail.deck.attribution ? " · " : ""}
                  {detail.deck.attribution && `Attribution: ${detail.deck.attribution}`}
                </p>
              )}
            </div>
            <label className="grid gap-1 text-sm font-medium">
              Review a version
              <select
                className="h-10 rounded-md border bg-background px-3"
                value={versionId}
                onChange={(event) => setVersionId(event.target.value)}
              >
                {detail.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    Version {version.version} · {new Date(version.createdAt).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={!canReview || busy}
              onClick={() => void onReviewVersion(versionId, initialToken)}
            >
              Review selected version
            </Button>
            {currentArea?.forkedFromVersionId &&
              currentArea.sourceId === detail.deck.id &&
              detail.deck.status === "active" && (
                <Button variant="outline" disabled={busy} onClick={() => void toggleFollowing()}>
                  {following ? "Stop following updates" : "Follow updates for this copy"}
                </Button>
              )}
            {detail.canManage && (
              <div className="grid gap-3 border-t pt-4">
                <h4 className="font-semibold">Manage this deck</h4>
                <Input
                  aria-label="Deck title"
                  value={metadata.title}
                  onChange={(event) => setMetadata({ ...metadata, title: event.target.value })}
                />
                <Textarea
                  aria-label="Deck description"
                  value={metadata.description}
                  onChange={(event) =>
                    setMetadata({ ...metadata, description: event.target.value })
                  }
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label="Deck language"
                    value={metadata.language}
                    onChange={(event) => setMetadata({ ...metadata, language: event.target.value })}
                  />
                  <Input
                    aria-label="Author name"
                    value={metadata.authorName}
                    onChange={(event) =>
                      setMetadata({ ...metadata, authorName: event.target.value })
                    }
                  />
                </div>
                <Input
                  aria-label="Deck tags, comma separated"
                  value={metadata.tags}
                  onChange={(event) => setMetadata({ ...metadata, tags: event.target.value })}
                />
                <Button disabled={busy} onClick={() => void saveMetadata()}>
                  Save details
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void setStatus(detail.deck.status === "active" ? "withdrawn" : "active")
                  }
                >
                  {detail.deck.status === "active" ? "Withdraw deck" : "Reactivate deck"}
                </Button>
              </div>
            )}
            {!detail.canManage && (
              <div className="grid gap-3 border-t pt-4">
                <h4 className="font-semibold">Report this version</h4>
                <label className="grid gap-1 text-sm">
                  Reason
                  <select
                    className="h-10 rounded-md border bg-background px-3"
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value as typeof reportReason)}
                  >
                    <option value="spam">Spam</option>
                    <option value="harmful">Harmful content</option>
                    <option value="copyright">Copyright</option>
                    <option value="broken">Broken content</option>
                  </select>
                </label>
                <Textarea
                  aria-label="Report details"
                  maxLength={2000}
                  value={reportMessage}
                  onChange={(event) => setReportMessage(event.target.value)}
                  placeholder="Describe the issue with this version"
                />
                <Button
                  disabled={busy || !reportMessage.trim() || !canReview}
                  onClick={() => void submitReport()}
                >
                  Submit report
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void toggleBlock()}>
                  {blocked ? "Unblock publisher" : "Block publisher"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
