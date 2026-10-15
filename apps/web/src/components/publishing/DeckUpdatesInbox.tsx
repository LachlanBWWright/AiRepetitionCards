"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Effect } from "effect";
import type { DeckSharingApi } from "@recall/application";
import type { DeckSubscriptionUpdate } from "@recall/contracts";
import { Button } from "@/components/ui/Button";
import { Alert } from "@recall/ui-web";

type Props = {
  readonly api: DeckSharingApi;
  readonly onReviewVersion: (versionId: string) => void | Promise<void>;
};
type Scope = {
  readonly api: DeckSharingApi;
  readonly onReviewVersion: Props["onReviewVersion"];
  readonly generation: number;
};

const run = <A,>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(Effect.either(effect));

export function DeckUpdatesInbox({ api, onReviewVersion }: Props) {
  const [updates, setUpdates] = useState<readonly DeckSubscriptionUpdate[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const busy = useRef(false);
  const requestSequence = useRef(0);
  const scope = useRef<Scope>({ api, onReviewVersion, generation: 0 });

  useLayoutEffect(() => {
    const previous = scope.current;
    if (previous.api !== api || previous.onReviewVersion !== onReviewVersion) {
      scope.current = { api, onReviewVersion, generation: previous.generation + 1 };
      requestSequence.current += 1;
      busy.current = false;
      setBusyId(null);
    }
  }, [api, onReviewVersion]);

  useEffect(() => {
    mounted.current = true;
    const generation = scope.current.generation;
    let active = true;
    const load = async () => {
      const sequence = ++requestSequence.current;
      const result = await run(api.listSubscriptionUpdates());
      if (
        !active ||
        !mounted.current ||
        scope.current.generation !== generation ||
        requestSequence.current !== sequence
      )
        return;
      if (result._tag === "Left") setError("Updates could not be loaded. Please try again.");
      else {
        setUpdates(result.right.updates);
        setError(null);
      }
    };
    void load();
    return () => {
      active = false;
      mounted.current = false;
      requestSequence.current += 1;
      busy.current = false;
    };
  }, [api, onReviewVersion]);

  const refresh = useCallback(async () => {
    if (busy.current || !mounted.current) return;
    const generation = scope.current.generation;
    const sequence = ++requestSequence.current;
    busy.current = true;
    setBusyId("refresh");
    const result = await run(api.listSubscriptionUpdates());
    if (
      mounted.current &&
      scope.current.generation === generation &&
      requestSequence.current === sequence
    ) {
      if (result._tag === "Left") setError("Updates could not be refreshed. Please try again.");
      else {
        setUpdates(result.right.updates);
        setError(null);
      }
      busy.current = false;
      setBusyId(null);
    }
  }, [api]);

  const reviewUpdate = async (update: DeckSubscriptionUpdate) => {
    if (busy.current || !mounted.current) return;
    const generation = scope.current.generation;
    busy.current = true;
    setBusyId(update.areaId);
    setError(null);
    try {
      await scope.current.onReviewVersion(update.latestVersionId);
    } catch {
      if (mounted.current && scope.current.generation === generation)
        setError("The preview could not be opened. The update remains unread.");
    } finally {
      if (mounted.current && scope.current.generation === generation) {
        busy.current = false;
        setBusyId(null);
      }
    }
  };

  const markRead = async (update: DeckSubscriptionUpdate) => {
    if (busy.current || !mounted.current || update.seen) return;
    const generation = scope.current.generation;
    busy.current = true;
    setBusyId(update.areaId);
    setError(null);
    const result = await run(api.markSubscriptionUpdateRead(update.areaId, update.latestVersionId));
    if (mounted.current && scope.current.generation === generation) {
      if (result._tag === "Left") setError("This update is still unread. Retry marking it read.");
      else {
        setUpdates(result.right.updates);
        setError(null);
      }
      busy.current = false;
      setBusyId(null);
    }
  };

  const unreadCount = updates.filter((update) => !update.seen).length;
  return (
    <section className="grid gap-3" aria-label="Deck updates">
      <div className="flex items-center gap-2">
        <h2 className="text-xl font-semibold">Deck updates</h2>
        {unreadCount > 0 && (
          <span
            className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground"
            aria-label={`${unreadCount} unread updates`}
          >
            {unreadCount}
          </span>
        )}
        <Button
          className="ml-auto"
          variant="outline"
          disabled={busyId !== null}
          onClick={() => void refresh()}
        >
          {busyId === "refresh" ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {error && <Alert variant="destructive">{error}</Alert>}
      {updates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No updates for your followed decks.</p>
      ) : (
        <div className="grid gap-3">
          {updates.map((update) => (
            <article
              key={`${update.areaId}:${update.latestVersionId}`}
              className="rounded-lg border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium">{update.title}</h3>
                {!update.seen && <span className="text-xs font-medium text-primary">Unread</span>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Version {update.latestVersion} · {new Date(update.createdAt).toLocaleDateString()}
              </p>
              {update.releaseNotes && (
                <p className="mt-2 whitespace-pre-wrap text-sm">{update.releaseNotes}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busyId !== null}
                  onClick={() => void reviewUpdate(update)}
                >
                  {busyId === update.areaId ? "Opening…" : "Review update"}
                </Button>
                {!update.seen && (
                  <Button disabled={busyId !== null} onClick={() => void markRead(update)}>
                    {busyId === update.areaId ? "Saving…" : "Mark as read"}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
