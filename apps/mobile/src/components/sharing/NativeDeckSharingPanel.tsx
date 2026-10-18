import { randomUUID } from "expo-crypto";
import { Effect } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { DeckSharingApi } from "@recall/application";
import type {
  DeckFeedback,
  DeckSubscription,
  DeckSubscriptionUpdate,
  DeckSummary,
} from "@recall/contracts";
import { useNativeDeckSharingBrowseFilters } from "./browse/useNativeDeckSharingBrowseFilters";
import { NativeDeckSharingAccessToken } from "./NativeDeckSharingAccessToken";
import { NativeDeckSharingPanelBrowse } from "./browse/NativeDeckSharingPanelBrowse";
import { NativeDeckSharingPanelAccount } from "../account/NativeDeckSharingPanelAccount";
import { NativeDeckSharingPanelDiscovery } from "./NativeDeckSharingPanelDiscovery";
import {
  createNativeDeckSharingDiscoveryRequest,
  loadNativeDeckSharingPanelInitialData,
} from "./NativeDeckSharingPanelLoad";
import {
  NativeDeckSharingPanelDetail,
  type NativeDeckSharingPanelDetail as NativeDeckSharingPanelDetailModel,
} from "./detail/NativeDeckSharingPanelDetail";
import { useNativeDeckSharingPanelDetailSlots } from "./detail/NativeDeckSharingPanelDetailSlots";
import {
  type NativeDeckSharingFeedbackKind,
  type NativeDeckSharingReportReason,
} from "./NativeDeckSharingPanelSafety";

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

export function NativeDeckSharingPanel({
  api,
  accountId,
  currentArea,
  onReviewVersion,
}: NativeDeckSharingPanelProps) {
  const { filters, updateFilter } = useNativeDeckSharingBrowseFilters();
  const [accessToken, setAccessToken] = useState("");
  const [decks, setDecks] = useState<readonly DeckSummary[]>([]);
  const [mine, setMine] = useState<readonly DeckSummary[]>([]);
  const [mineAccount, setMineAccount] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NativeDeckSharingPanelDetailModel | null>(null);
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
  const [feedbackKind, setFeedbackKind] = useState<NativeDeckSharingFeedbackKind>("suggestion");
  const [reportReason, setReportReason] = useState<NativeDeckSharingReportReason>("broken");
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
        api.discover(createNativeDeckSharingDiscoveryRequest(filters, requestedCursor)),
        (result) => {
          setDecks((current) => (requestedCursor ? [...current, ...result.decks] : result.decks));
          setNextCursor(result.nextCursor);
        },
      );
    },
    [api, filters, run],
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
    loadNativeDeckSharingPanelInitialData({
      api,
      accountId,
      filters,
      isCurrent: () => identity === fence.current,
      onDiscovery: (result) => {
        setDecks(result.decks);
        setNextCursor(result.nextCursor);
      },
      onSubscriptions: (result) => {
        setSubscriptions(result.subscriptions);
        setSubscriptionsAccount(accountId);
      },
      onUpdates: (result) => {
        if (!accountId) return;
        setUpdates(result.updates);
        setUpdatesScope({ accountId, api });
      },
      onMine: (result) => {
        setMine(result.decks);
        setMineAccount(accountId);
      },
    });
  }, [accountId, api, filters]);

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
  const visibleDetailId = visibleDetail?.deck.id ?? "";

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
    const id = randomUUID();
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

  const toggleBlock = () => {
    if (!visibleDetail) return;
    const deckId = visibleDetail.deck.id;
    void run(
      visibleBlockedDecks.includes(deckId)
        ? api.unblockDeck(deckId, accessToken.trim() || undefined)
        : api.blockDeck(deckId, accessToken.trim() || undefined),
      (result) => {
        setBlockedDecks((current) => {
          const ids =
            current?.accountId === currentAccount.current && current.api === currentApi.current
              ? current.ids
              : [];
          return {
            accountId: currentAccount.current,
            api: currentApi.current,
            ids: result.blocked
              ? [...new Set([...ids, deckId])]
              : ids.filter((id) => id !== deckId),
          };
        });
      },
    );
  };

  const updateFeedback = (item: DeckFeedback) => {
    if (!visibleDetail) return;
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
    );
  };

  const handleUnfollow = useCallback(
    (areaId: string) => {
      void run(api.deleteSubscription(areaId), (result) => {
        setSubscriptions(result.subscriptions);
        setSubscriptionsAccount(currentAccount.current);
      });
    },
    [api, run],
  );

  const detailActionSlots = useNativeDeckSharingPanelDetailSlots({
    detail: visibleDetail,
    identity: { accountId, currentArea },
    version: {
      busy,
      selected: selectedVersion,
      onSelectedChange: setSelectedVersion,
      accessToken,
      subscriptions: visibleSubscriptions,
      onReview: onReviewVersion,
      onFollow: followVersion,
    },
    owner: {
      title,
      onTitleChange: setTitle,
      description,
      onDescriptionChange: setDescription,
      onSaveMetadata: () =>
        void run(
          api.updateDeck(visibleDetailId, { title: title.trim(), description }),
          (result) => {
            setDetail((current) => (current ? { ...current, deck: result.deck } : current));
            loadOwned();
          },
        ),
      onWithdraw: () =>
        void run(api.updateDeck(visibleDetailId, { status: "withdrawn" }), (result) => {
          setDetail((current) => (current ? { ...current, deck: result.deck } : current));
          loadOwned();
        }),
      updates: visibleUpdates,
      mine: visibleMine,
      onManageDeck: loadDetail,
      onUnfollow: handleUnfollow,
    },
    safety: {
      feedback: visibleFeedback,
      blocked: visibleBlockedDecks.includes(visibleDetailId),
      reportReason,
      onReportReasonChange: setReportReason,
      reportMessage,
      onReportMessageChange: setReportMessage,
      onReport: () => {
        const id = randomUUID();
        void run(
          api.reportDeck(visibleDetailId, {
            id,
            versionId: selectedVersion,
            reason: reportReason,
            message: reportMessage.trim(),
            ...(accessToken.trim() ? { token: accessToken.trim() } : {}),
          }),
          () => {
            setReportMessage("");
          },
        );
      },
      onToggleBlock: toggleBlock,
      feedbackKind,
      onFeedbackKindChange: setFeedbackKind,
      feedbackMessage,
      onFeedbackMessageChange: setFeedbackMessage,
      onSubmitFeedback: submitFeedback,
      onUpdateFeedback: updateFeedback,
    },
  });

  return (
    <View className="gap-4 rounded-xl border border-recall-line bg-recall-surface p-4">
      <Text accessibilityRole="header" className="text-lg font-bold">
        Shared decks
      </Text>
      <Text className="text-sm text-recall-muted">
        Find decks, review a specific version, and follow updates in a personal area.
      </Text>
      <NativeDeckSharingPanelBrowse
        account={
          <NativeDeckSharingPanelAccount
            section="updates"
            accountId={accountId}
            busy={busy}
            updates={visibleUpdates}
            mine={visibleMine}
            subscriptions={visibleSubscriptions}
            onMarkUpdateRead={(areaId, versionId) => {
              void run(api.markSubscriptionUpdateRead(areaId, versionId), (result) => {
                setUpdates(result.updates);
                const account = currentAccount.current;
                if (account) setUpdatesScope({ accountId: account, api: currentApi.current });
              });
            }}
          />
        }
        discovery={
          <NativeDeckSharingPanelDiscovery
            filters={filters}
            onFilterChange={updateFilter}
            results={{ decks, nextCursor, busy }}
            actions={{ onSearch: loadDiscovery, onOpenDeck: loadDetail }}
          />
        }
        error={error}
      />
      <NativeDeckSharingAccessToken value={accessToken} onChange={setAccessToken} />
      {visibleDetail && detailActionSlots ? (
        <NativeDeckSharingPanelDetail detail={visibleDetail} {...detailActionSlots} />
      ) : null}
    </View>
  );
}
