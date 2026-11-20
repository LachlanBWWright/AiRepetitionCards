import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { Effect, Either } from "effect";
import type { AppCoreState } from "../useAppController";
import type { createAppSyncActions } from "../actions/AppSyncActions";

export function useNativeBackgroundSync(
  model: Pick<
    AppCoreState & ReturnType<typeof createAppSyncActions>,
    | "ready"
    | "cacheWritable"
    | "accountUserId"
    | "mediaStore"
    | "workspace"
    | "workspaceRef"
    | "syncOwnershipIssue"
    | "syncConflictWorkspace"
    | "setMessage"
    | "syncCloudWorkspace"
  >,
) {
  const [progressState, setProgressState] = useState<{
    readonly owner: string | null;
    readonly confirmed: string | null;
    readonly busy: boolean;
    readonly error: boolean;
  }>({ owner: null, confirmed: null, busy: false, error: false });
  const latest = useRef(model);
  const scheduleRef = useRef<() => void>(() => undefined);
  const settled = useRef<string | null>(null);
  const enabled =
    model.ready &&
    model.cacheWritable &&
    Boolean(model.accountUserId) &&
    Boolean(model.mediaStore) &&
    !model.syncOwnershipIssue &&
    !model.syncConflictWorkspace;
  useEffect(() => {
    latest.current = model;
  });
  useEffect(() => {
    if (!enabled) return;
    const lifecycle = { active: true, running: false, requested: false };
    const isActive = () => lifecycle.active;
    let timer: ReturnType<typeof setTimeout> | undefined;
    settled.current = null;
    const schedule = (delay: number) => {
      if (!isActive()) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        void run();
      }, delay);
    };
    const run = async () => {
      if (!isActive() || AppState.currentState !== "active") return;
      if (lifecycle.running) {
        lifecycle.requested = true;
        return;
      }
      lifecycle.running = true;
      setProgressState((current) => ({
        ...current,
        owner: latest.current.accountUserId,
        busy: true,
        error: false,
      }));
      const progress = { completed: false, more: false };
      const result = await Effect.runPromise(
        Effect.either(
          Effect.tryPromise({
            try: () =>
              latest.current.syncCloudWorkspace(false, (workspace, pending) => {
                if (!isActive()) return;
                progress.completed = true;
                progress.more = pending;
                settled.current = pending ? null : JSON.stringify(workspace);
              }),
            catch: () => ({ _tag: "NativeBackgroundSyncFailure" }) as const,
          }),
        ),
      );
      lifecycle.running = false;
      if (!isActive()) return;
      if (
        !progress.completed &&
        Either.isRight(result) &&
        result.right !== "Sync failed. Your current offline data remains available." &&
        !latest.current.syncOwnershipIssue &&
        !latest.current.syncConflictWorkspace
      ) {
        latest.current.setMessage(result.right);
      }
      const changed = settled.current !== JSON.stringify(latest.current.workspaceRef.current);
      setProgressState({
        owner: latest.current.accountUserId,
        confirmed: progress.completed ? settled.current : null,
        busy: false,
        error: !progress.completed || Either.isLeft(result),
      });
      const delay =
        lifecycle.requested || (progress.completed && changed)
          ? 400
          : !progress.completed || progress.more || Either.isLeft(result)
            ? 5_000
            : 30_000;
      lifecycle.requested = false;
      schedule(delay);
    };
    scheduleRef.current = () => {
      schedule(400);
    };
    schedule(400);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") schedule(0);
      else if (timer !== undefined) clearTimeout(timer);
    });
    return () => {
      lifecycle.active = false;
      scheduleRef.current = () => undefined;
      if (timer !== undefined) clearTimeout(timer);
      subscription.remove();
    };
  }, [enabled, model.accountUserId]);
  useEffect(() => {
    if (enabled && settled.current !== JSON.stringify(model.workspace)) scheduleRef.current();
  }, [enabled, model.workspace]);
  return {
    busy: enabled && progressState.owner === model.accountUserId && progressState.busy,
    error: progressState.owner === model.accountUserId && progressState.error,
    confirmed:
      enabled &&
      progressState.owner === model.accountUserId &&
      progressState.confirmed === JSON.stringify(model.workspace),
  };
}
