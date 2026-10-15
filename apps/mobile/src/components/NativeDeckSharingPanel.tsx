import { Effect } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { DeckSharingApi } from "@recall/application";
import type {
  DeckFeedback,
  DeckSubscription,
  DeckSubscriptionUpdate,
  DeckSummary,
  DeckVersionSummary,
} from "@recall/contracts";
import { NativeSelect } from "@recall/ui-native";
import { NativeButton } from "./ui/NativeButton";
import { NativeTextField } from "./ui/NativeTextField";

export type NativeDeckSharingPanelProps = {
  readonly api: DeckSharingApi;
  readonly accountId: string | null;
  readonly currentArea: {
    readonly id: string;
    readonly title: string;
    readonly sourceId?: string;
    readonly sourceVersionId?: string;
  } | null;
  readonly onReviewVersion: (versionId: string, token?: string) => void;
};

const pageSize = 20;

export function NativeDeckSharingPanel({
  api,
  accountId,
  currentArea,
  onReviewVersion,
}: NativeDeckSharingPanelProps) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [tag, setTag] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [decks, setDecks] = useState<readonly DeckSummary[]>([]);
  const [mine, setMine] = useState<readonly DeckSummary[]>([]);
  const [mineAccount, setMineAccount] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    readonly deck: DeckSummary;
    readonly versions: readonly DeckVersionSummary[];
    readonly canManage: boolean;
  } | null>(null);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [subscriptions, setSubscriptions] = useState<readonly DeckSubscription[]>([]);
  const [subscriptionsAccount, setSubscriptionsAccount] = useState<string | null>(null);
  const [updates, setUpdates] = useState<readonly DeckSubscriptionUpdate[]>([]);
  const [updatesScope, setUpdatesScope] = useState<{
    readonly accountId: string;
    readonly api: DeckSharingApi;
  } | null>(null);
  const [feedback, setFeedback] = useState<readonly DeckFeedback[]>([]);
  const [feedbackScope, setFeedbackScope] = useState<{
    readonly accountId: string | null;
    readonly deckId: string;
  } | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [blockedDecks, setBlockedDecks] = useState<{
    readonly accountId: string | null;
    readonly api: DeckSharingApi;
    readonly ids: readonly string[];
  } | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<"issue" | "suggestion">("suggestion");
  const [reportReason, setReportReason] = useState<"spam" | "harmful" | "copyright" | "broken">(
    "broken",
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const fence = useRef(0);
  const currentAccount = useRef(accountId);
  const currentApi = useRef(api);
  const [detailAccount, setDetailAccount] = useState<string | null>(null);
  const selectedDeck = detail?.deck;

  const run = useCallback(
    async <A,>(effect: Effect.Effect<A, unknown>, onSuccess: (value: A) => void) => {
      const requestFence = fence.current;
      const requestAccount = currentAccount.current;
      const requestApi = currentApi.current;
      setBusy(true);
      setError(null);
      const result = await Effect.runPromise(Effect.either(effect));
      if (
        requestFence !== fence.current ||
        requestAccount !== currentAccount.current ||
        requestApi !== currentApi.current
      )
        return;
      setBusy(false);
      if (result._tag === "Left") {
        setError("The deck sharing request failed. Check your connection and try again.");
        return;
      }
      onSuccess(result.right);
    },
    [],
  );

  const loadDiscovery = useCallback(
    (requestedCursor: string | null) => {
      void run(
        api.discover({
          ...(query.trim() ? { q: query.trim() } : {}),
          ...(language.trim() ? { language: language.trim() } : {}),
          ...(tag.trim() ? { tag: tag.trim() } : {}),
          limit: pageSize,
          ...(requestedCursor ? { cursor: requestedCursor } : {}),
        }),
        (result) => {
          setDecks((current) => (requestedCursor ? [...current, ...result.decks] : result.decks));
          setNextCursor(result.nextCursor);
        },
      );
    },
    [api, language, query, run, tag],
  );

  const loadOwned = useCallback(() => {
    if (!accountId) return;
    void run(api.listMine(), (result) => {
      setMine(result.decks);
      setMineAccount(currentAccount.current);
    });
  }, [accountId, api, run]);

  const loadDetail = useCallback(
    (deckId: string) => {
      setSelectedId(deckId);
      setDetail(null);
      setDetailAccount(null);
      setFeedbackScope(null);
      const requestAccount = currentAccount.current;
      void run(api.read(deckId, accessToken.trim() || undefined), (result) => {
        setDetail(result);
        setDetailAccount(currentAccount.current);
        setSelectedVersion(result.deck.latestVersionId);
        setTitle(result.deck.title);
        setDescription(result.deck.description);
        void run(api.listFeedback(deckId), (items) => {
          setFeedback(items.feedback);
          setFeedbackScope({ accountId: requestAccount, deckId });
        });
      });
    },
    [accessToken, api, run],
  );

  useEffect(() => {
    currentAccount.current = accountId;
    currentApi.current = api;
    fence.current += 1;
    const identity = fence.current;
    void Effect.runPromise(
      Effect.either(
        api.discover({
          ...(query.trim() ? { q: query.trim() } : {}),
          ...(language.trim() ? { language: language.trim() } : {}),
          ...(tag.trim() ? { tag: tag.trim() } : {}),
          limit: pageSize,
        }),
      ),
    ).then((result) => {
      if (identity !== fence.current || result._tag === "Left") return;
      setDecks(result.right.decks);
      setNextCursor(result.right.nextCursor);
    });
    if (!accountId) return;
    void Effect.runPromise(Effect.either(api.listSubscriptions())).then((result) => {
      if (identity !== fence.current || result._tag === "Left") return;
      setSubscriptions(result.right.subscriptions);
      setSubscriptionsAccount(accountId);
    });
    void Effect.runPromise(Effect.either(api.listSubscriptionUpdates())).then((result) => {
      if (identity !== fence.current || result._tag === "Left") return;
      setUpdates(result.right.updates);
      setUpdatesScope({ accountId, api });
    });
    void Effect.runPromise(Effect.either(api.listMine())).then((result) => {
      if (identity !== fence.current || result._tag === "Left") return;
      setMine(result.right.decks);
      setMineAccount(accountId);
    });
  }, [accountId, api, language, query, tag]);

  const versionOptions = useMemo(
    () =>
      (detail?.versions ?? []).map((version) => ({
        label: `Version ${version.version} · ${new Date(version.createdAt).toLocaleDateString()}`,
        value: version.id,
      })),
    [detail],
  );

  const visibleDetail = detailAccount === accountId ? detail : null;
  const visibleMine = accountId && mineAccount === accountId ? mine : [];
  const visibleSubscriptions = accountId && subscriptionsAccount === accountId ? subscriptions : [];
  const visibleUpdates =
    accountId && updatesScope?.accountId === accountId && updatesScope.api === api ? updates : [];
  const visibleBlockedDecks =
    blockedDecks?.accountId === accountId && blockedDecks.api === api ? blockedDecks.ids : [];
  const visibleFeedback =
    visibleDetail &&
    feedbackScope?.accountId === accountId &&
    feedbackScope.deckId === visibleDetail.deck.id
      ? feedback
      : [];

  const followVersion = (versionId: string, following: boolean) => {
    if (!selectedDeck || !currentArea || !accountId) return;
    void run(
      api.putSubscription({
        deckId: selectedDeck.id,
        areaId: currentArea.id,
        versionId,
        following,
      }),
      (result) => {
        setSubscriptions(result.subscriptions);
        setSubscriptionsAccount(currentAccount.current);
      },
    );
  };

  const submitFeedback = () => {
    if (!selectedId || !selectedVersion || !feedbackMessage.trim()) return;
    const id = globalThis.crypto?.randomUUID?.();
    if (!id) {
      setError("Feedback could not be prepared on this device.");
      return;
    }
    void run(
      api.submitFeedback(selectedId, {
        id,
        versionId: selectedVersion,
        cardId: null,
        message: feedbackMessage.trim(),
        kind: feedbackKind,
      }),
      (result) => {
        setFeedback(result.feedback);
        setFeedbackScope({ accountId: currentAccount.current, deckId: selectedId });
        setFeedbackMessage("");
      },
    );
  };

  return (
    <View className="gap-4 rounded-xl border border-recall-line bg-recall-surface p-4">
      <Text accessibilityRole="header" className="text-lg font-bold">
        Shared decks
      </Text>
      <Text className="text-sm text-recall-muted">
        Find decks, review a specific version, and follow updates in a personal area.
      </Text>
      {accountId ? (
        <View className="gap-3 rounded-xl border border-recall-line p-3">
          <Text className="font-semibold">Followed deck updates</Text>
          {visibleUpdates.length === 0 ? (
            <Text className="text-sm text-recall-muted">No new public releases.</Text>
          ) : (
            visibleUpdates.map((update) => (
              <View
                key={`${update.areaId}:${update.latestVersionId}`}
                className="gap-2 border-t border-recall-line pt-3"
              >
                <Text className="font-medium">
                  {update.title} · v{update.latestVersion}
                </Text>
                {update.releaseNotes ? (
                  <Text className="text-sm">{update.releaseNotes}</Text>
                ) : null}
                <Text className="text-xs text-recall-muted">
                  {update.seen ? "Reviewed" : "New release"} ·{" "}
                  {new Date(update.createdAt).toLocaleDateString()}
                </Text>
                <NativeButton
                  label="Review exact public version"
                  tone="soft"
                  disabled={busy}
                  onPress={() => onReviewVersion(update.latestVersionId)}
                />
                {!update.seen ? (
                  <NativeButton
                    label="Mark as reviewed"
                    tone="soft"
                    disabled={busy}
                    onPress={() =>
                      void run(
                        api.markSubscriptionUpdateRead(update.areaId, update.latestVersionId),
                        (result) => {
                          setUpdates(result.updates);
                          const account = currentAccount.current;
                          if (account)
                            setUpdatesScope({ accountId: account, api: currentApi.current });
                        },
                      )
                    }
                  />
                ) : null}
              </View>
            ))
          )}
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {error}
        </Text>
      ) : null}

      <View className="gap-3">
        <NativeTextField
          label="Search decks"
          value={query}
          onChangeText={setQuery}
          placeholder="Title or description"
        />
        <NativeTextField
          label="Language filter"
          value={language}
          onChangeText={setLanguage}
          placeholder="e.g. en"
        />
        <NativeTextField
          label="Tag filter"
          value={tag}
          onChangeText={setTag}
          placeholder="e.g. biology"
        />
        <NativeButton
          label="Search public decks"
          tone="soft"
          disabled={busy}
          onPress={() => loadDiscovery(null)}
        />
      </View>
      {decks.map((deck) => (
        <View key={deck.id} className="gap-2 rounded-xl border border-recall-line p-3">
          <Text className="font-semibold">{deck.title}</Text>
          <Text className="text-sm text-recall-muted">
            {deck.authorName || "Community"} · {deck.language || "Language unspecified"} ·{" "}
            {deck.cardCount} cards · v{deck.version}
          </Text>
          <Text className="text-sm">{deck.description}</Text>
          <NativeButton
            label="View deck and versions"
            tone="soft"
            disabled={busy}
            onPress={() => loadDetail(deck.id)}
          />
        </View>
      ))}
      {nextCursor ? (
        <NativeButton
          label="Load more decks"
          tone="soft"
          disabled={busy}
          onPress={() => loadDiscovery(nextCursor)}
        />
      ) : null}

      <NativeTextField
        label="Optional unlisted deck token"
        value={accessToken}
        onChangeText={setAccessToken}
        secureTextEntry
        placeholder="Paste token to open an unlisted deck"
      />
      {visibleDetail ? (
        <View className="gap-3 border-t border-recall-line pt-4">
          <Text className="text-base font-bold">{visibleDetail.deck.title}</Text>
          <Text className="text-sm text-recall-muted">
            {visibleDetail.deck.visibility} · {visibleDetail.deck.status} ·{" "}
            {visibleDetail.deck.cardCount} cards
          </Text>
          {versionOptions.length ? (
            <NativeSelect
              label="Deck version"
              value={selectedVersion}
              options={versionOptions}
              onValueChange={setSelectedVersion}
              disabled={busy}
            />
          ) : null}
          <NativeButton
            label="Review selected version"
            disabled={busy || !selectedVersion}
            onPress={() => onReviewVersion(selectedVersion, accessToken.trim() || undefined)}
          />
          {accountId && currentArea && currentArea.sourceId === visibleDetail.deck.id ? (
            <NativeButton
              label={
                visibleSubscriptions.some(
                  (item) =>
                    item.deckId === visibleDetail.deck.id &&
                    item.areaId === currentArea.id &&
                    item.following,
                )
                  ? `Following in ${currentArea.title}`
                  : `Follow updates in ${currentArea.title}`
              }
              tone="soft"
              disabled={busy || !currentArea.sourceVersionId}
              onPress={() =>
                followVersion(
                  currentArea.sourceVersionId ?? "",
                  !visibleSubscriptions.some(
                    (item) =>
                      item.deckId === visibleDetail.deck.id &&
                      item.areaId === currentArea.id &&
                      item.following,
                  ),
                )
              }
            />
          ) : null}

          {visibleDetail.canManage ? (
            <View className="gap-3 rounded-xl bg-recall-muted/10 p-3">
              <Text className="font-semibold">Manage shared deck</Text>
              <NativeTextField
                label="Title"
                value={title}
                onChangeText={setTitle}
                maxLength={300}
              />
              <NativeTextField
                label="Description"
                value={description}
                onChangeText={setDescription}
                maxLength={4000}
                multiline
              />
              <NativeButton
                label="Save metadata"
                tone="soft"
                disabled={busy}
                onPress={() =>
                  void run(
                    api.updateDeck(visibleDetail.deck.id, { title: title.trim(), description }),
                    (result) => {
                      setDetail((current) =>
                        current ? { ...current, deck: result.deck } : current,
                      );
                      loadOwned();
                    },
                  )
                }
              />
              {visibleDetail.deck.status === "active" ? (
                <NativeButton
                  label="Withdraw deck"
                  tone="soft"
                  disabled={busy}
                  onPress={() =>
                    void run(
                      api.updateDeck(visibleDetail.deck.id, { status: "withdrawn" }),
                      (result) => {
                        setDetail((current) =>
                          current ? { ...current, deck: result.deck } : current,
                        );
                        loadOwned();
                      },
                    )
                  }
                />
              ) : null}
            </View>
          ) : null}

          {accountId && !visibleDetail.canManage ? (
            <View className="gap-3 rounded-xl border border-recall-line p-3">
              <Text className="font-semibold">Deck safety</Text>
              <NativeSelect
                label="Report reason"
                value={reportReason}
                options={[
                  { label: "Spam", value: "spam" },
                  { label: "Harmful content", value: "harmful" },
                  { label: "Copyright", value: "copyright" },
                  { label: "Broken deck", value: "broken" },
                ]}
                onValueChange={(value) => {
                  if (
                    value === "spam" ||
                    value === "harmful" ||
                    value === "copyright" ||
                    value === "broken"
                  )
                    setReportReason(value);
                }}
              />
              <NativeTextField
                label="Report details"
                value={reportMessage}
                onChangeText={setReportMessage}
                maxLength={2_000}
                multiline
              />
              <NativeButton
                label="Report selected version"
                tone="soft"
                disabled={busy || !selectedVersion || !reportMessage.trim()}
                onPress={() => {
                  const id = globalThis.crypto?.randomUUID?.();
                  if (!id) {
                    setError("The report could not be prepared on this device.");
                    return;
                  }
                  void run(
                    api.reportDeck(visibleDetail.deck.id, {
                      id,
                      versionId: selectedVersion,
                      reason: reportReason,
                      message: reportMessage.trim(),
                      ...(accessToken.trim() ? { token: accessToken.trim() } : {}),
                    }),
                    () => setReportMessage(""),
                  );
                }}
              />
              <NativeButton
                label={
                  visibleBlockedDecks.includes(visibleDetail.deck.id)
                    ? "Unblock publisher"
                    : "Block publisher"
                }
                tone="soft"
                disabled={busy}
                onPress={() =>
                  void run(
                    visibleBlockedDecks.includes(visibleDetail.deck.id)
                      ? api.unblockDeck(visibleDetail.deck.id, accessToken.trim() || undefined)
                      : api.blockDeck(visibleDetail.deck.id, accessToken.trim() || undefined),
                    (result) =>
                      setBlockedDecks((current) => {
                        const ids =
                          current?.accountId === currentAccount.current &&
                          current.api === currentApi.current
                            ? current.ids
                            : [];
                        return {
                          accountId: currentAccount.current,
                          api: currentApi.current,
                          ids: result.blocked
                            ? [...new Set([...ids, visibleDetail.deck.id])]
                            : ids.filter((id) => id !== visibleDetail.deck.id),
                        };
                      }),
                  )
                }
              />
            </View>
          ) : null}

          <View className="gap-3">
            <Text className="font-semibold">Feedback</Text>
            {accountId ? (
              <>
                <NativeSelect
                  label="Feedback type"
                  value={feedbackKind}
                  options={[
                    { label: "Suggestion", value: "suggestion" },
                    { label: "Issue", value: "issue" },
                  ]}
                  onValueChange={(value) =>
                    setFeedbackKind(value === "issue" ? "issue" : "suggestion")
                  }
                />
                <NativeTextField
                  label="Message"
                  value={feedbackMessage}
                  onChangeText={setFeedbackMessage}
                  maxLength={4000}
                  multiline
                  placeholder="Describe an issue or suggestion"
                />
                <NativeButton
                  label="Send feedback"
                  tone="soft"
                  disabled={busy || !feedbackMessage.trim()}
                  onPress={submitFeedback}
                />
              </>
            ) : (
              <Text className="text-sm text-recall-muted">Sign in to leave feedback.</Text>
            )}
            {visibleFeedback.map((item) => (
              <View key={item.id} className="gap-1 rounded-lg border border-recall-line p-3">
                <Text className="text-sm">
                  {item.kind} · {item.status} · v
                  {visibleDetail.versions.find((version) => version.id === item.versionId)
                    ?.version ?? "?"}
                </Text>
                <Text className="text-sm">{item.message}</Text>
                {visibleDetail.canManage ? (
                  <NativeButton
                    label={item.status === "open" ? "Mark resolved" : "Reopen"}
                    tone="soft"
                    disabled={busy}
                    onPress={() =>
                      void run(
                        api.updateFeedback(visibleDetail.deck.id, item.id, {
                          status: item.status === "open" ? "resolved" : "open",
                        }),
                        (result) => {
                          setFeedback(result.feedback);
                          setFeedbackScope({
                            accountId: currentAccount.current,
                            deckId: visibleDetail.deck.id,
                          });
                        },
                      )
                    }
                  />
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {accountId ? (
        <View className="gap-3 border-t border-recall-line pt-4">
          <Text className="font-bold">My shared decks</Text>
          {visibleMine.map((deck) => (
            <View key={deck.id} className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-sm">
                {deck.title} · {deck.status} · v{deck.version}
              </Text>
              <NativeButton
                label="Manage"
                tone="soft"
                disabled={busy}
                onPress={() => loadDetail(deck.id)}
              />
            </View>
          ))}
          <Text className="font-bold">Following</Text>
          {visibleSubscriptions.map((item) => (
            <View key={item.areaId} className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-sm">
                {visibleMine.find((deck) => deck.id === item.deckId)?.title ?? "Shared deck"} ·{" "}
                {item.following ? "following" : "paused"}
              </Text>
              <NativeButton
                label="Unfollow"
                tone="soft"
                disabled={busy}
                onPress={() =>
                  void run(api.deleteSubscription(item.areaId), (result) => {
                    setSubscriptions(result.subscriptions);
                    setSubscriptionsAccount(currentAccount.current);
                  })
                }
              />
            </View>
          ))}
        </View>
      ) : (
        <Text className="text-sm text-recall-muted">
          Sign in to manage shared decks and subscriptions.
        </Text>
      )}
    </View>
  );
}
