import { Effect } from "effect";
import type { DeckSharingApi } from "@recall/application";
import type {
  NativeDeckSharingDifficulty,
  NativeDeckSharingStudyTime,
} from "./NativeDeckSharingPanelDiscovery";

export type NativeDeckSharingPanelFilters = {
  readonly query: string;
  readonly language: string;
  readonly tag: string;
  readonly difficulty: NativeDeckSharingDifficulty;
  readonly activityType: string;
  readonly studyTime: NativeDeckSharingStudyTime;
};

export const createNativeDeckSharingDiscoveryRequest = (
  filters: NativeDeckSharingPanelFilters,
  requestedCursor?: string | null,
) => ({
  ...(filters.query.trim() ? { q: filters.query.trim() } : {}),
  ...(filters.language.trim() ? { language: filters.language.trim() } : {}),
  ...(filters.tag.trim() ? { tag: filters.tag.trim() } : {}),
  ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
  ...(filters.activityType ? { activityType: filters.activityType } : {}),
  ...(filters.studyTime === "short" ? { maxMinutes: 10 } : {}),
  ...(filters.studyTime === "medium" ? { minMinutes: 11, maxMinutes: 30 } : {}),
  ...(filters.studyTime === "long" ? { minMinutes: 31 } : {}),
  limit: 20,
  ...(requestedCursor ? { cursor: requestedCursor } : {}),
});

type DiscoveryResult = Effect.Effect.Success<ReturnType<DeckSharingApi["discover"]>>;
type SubscriptionsResult = Effect.Effect.Success<ReturnType<DeckSharingApi["listSubscriptions"]>>;
type UpdatesResult = Effect.Effect.Success<ReturnType<DeckSharingApi["listSubscriptionUpdates"]>>;
type MineResult = Effect.Effect.Success<ReturnType<DeckSharingApi["listMine"]>>;

export type NativeDeckSharingPanelInitialLoad = {
  readonly api: DeckSharingApi;
  readonly accountId: string | null;
  readonly filters: NativeDeckSharingPanelFilters;
  readonly isCurrent: () => boolean;
  readonly onDiscovery: (result: DiscoveryResult) => void;
  readonly onSubscriptions: (result: SubscriptionsResult) => void;
  readonly onUpdates: (result: UpdatesResult) => void;
  readonly onMine: (result: MineResult) => void;
};

export function loadNativeDeckSharingPanelInitialData({
  api,
  accountId,
  filters,
  isCurrent,
  onDiscovery,
  onSubscriptions,
  onUpdates,
  onMine,
}: NativeDeckSharingPanelInitialLoad): void {
  void Effect.runPromise(
    Effect.either(api.discover(createNativeDeckSharingDiscoveryRequest(filters))),
  ).then((result) => {
    if (!isCurrent() || result._tag === "Left") return;
    onDiscovery(result.right);
  });
  if (!accountId) return;
  void Effect.runPromise(Effect.either(api.listSubscriptions())).then((result) => {
    if (!isCurrent() || result._tag === "Left") return;
    onSubscriptions(result.right);
  });
  void Effect.runPromise(Effect.either(api.listSubscriptionUpdates())).then((result) => {
    if (!isCurrent() || result._tag === "Left") return;
    onUpdates(result.right);
  });
  void Effect.runPromise(Effect.either(api.listMine())).then((result) => {
    if (!isCurrent() || result._tag === "Left") return;
    onMine(result.right);
  });
}
