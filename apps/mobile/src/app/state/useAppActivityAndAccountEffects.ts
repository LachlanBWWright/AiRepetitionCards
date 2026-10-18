import { emptyActivityLibrary } from "@recall/domain";
import { useEffect, useLayoutEffect } from "react";
import { Effect, Either, Schema } from "effect";
import * as Linking from "expo-linking";
import {
  clearWorkspaceAndMedia,
  loadWorkspace,
  saveWorkspace,
  mergeActivityLibraries,
} from "@recall/application";
import { createEmptyWorkspace } from "./workspace-utils";
import type { MediaStore, WorkspaceStore } from "@recall/local-store";
import {
  openSqliteMediaStore,
  openSqliteWorkspaceStore,
} from "../../storage/workspace/sqlite-workspace-store";
import { confirmNativeMagicLink, supabaseAuthClient } from "../../storage/auth/supabase-auth";
import type { AppCoreState } from "../useAppController";

type LocalMutation = <A, E>(
  operation: Effect.Effect<A, E>,
  onBlocked: () => E,
) => Effect.Effect<A, E>;
function createGuardedWorkspaceStore(
  rawStore: WorkspaceStore,
  rawMedia: MediaStore,
  clear: WorkspaceStore["clear"],
  generation: () => number,
  mayWrite: (expected: number) => boolean,
  coordinateMutation: LocalMutation,
): WorkspaceStore {
  return {
    ...rawStore,
    write: (serialized) =>
      coordinateMutation(
        rawStore.write(serialized),
        () =>
          ({
            _tag: "LocalStoreFailure",
            operation: "write",
          }) as const,
      ),
    clear,
    coordinateMediaCommit: (commit) => {
      const expected = generation();
      const guardedWorkspace: WorkspaceStore = {
        ...rawStore,
        write: (serialized) =>
          Effect.suspend(() =>
            mayWrite(expected)
              ? rawStore.write(serialized)
              : Effect.fail({ _tag: "LocalStoreFailure", operation: "write" } as const),
          ),
      };
      const guardedMedia: MediaStore = {
        ...rawMedia,
        put: (asset) =>
          Effect.suspend(() =>
            mayWrite(expected)
              ? rawMedia.put(asset)
              : Effect.fail({ _tag: "MediaStoreFailure", operation: "write" } as const),
          ),
      };
      return coordinateMutation(
        commit(guardedWorkspace, guardedMedia),
        () =>
          ({
            _tag: "WorkspaceMediaCommitFailure",
            reason: "workspace-write",
          }) as const,
      );
    },
  };
}

export function useAppActivityAndAccountEffects(
  model: Pick<
    AppCoreState,
    | "workspace"
    | "notesLoaded"
    | "updateActivityNotes"
    | "setActivityRestoreError"
    | "authSession"
    | "syncConflictGeneration"
    | "syncConflictAuthGeneration"
    | "setSyncConflictWorkspace"
    | "setSyncOwnershipIssue"
    | "setAccountUserId"
    | "setAccountEmail"
    | "setWorkspace"
    | "setMessage"
    | "setReady"
    | "workspaceLifetime"
    | "localWriteLane"
    | "setMediaStore"
    | "clearLocalStores"
    | "setStore"
    | "setCacheWritable"
    | "setNow"
    | "cacheWritable"
    | "tutorLifetime"
  >,
) {
  const {
    workspace,
    notesLoaded,
    updateActivityNotes,
    setActivityRestoreError,
    authSession,
    syncConflictGeneration,
    syncConflictAuthGeneration,
    setSyncConflictWorkspace,
    setSyncOwnershipIssue,
    setAccountUserId,
    setAccountEmail,
    setWorkspace,
    setMessage,
    setReady,
    workspaceLifetime,
    localWriteLane,
    setMediaStore,
    clearLocalStores,
    setStore,
    setCacheWritable,
    setNow,
    cacheWritable,
    tutorLifetime,
  } = model;
  useEffect(() => {
    const restored = workspace?.activityLibrary;
    if (!restored || !notesLoaded) return;
    updateActivityNotes((notes) => {
      const merged = Effect.runSync(
        Effect.either(
          mergeActivityLibraries(restored, notes.activityLibrary ?? emptyActivityLibrary),
        ),
      );
      if (Either.isLeft(merged)) {
        setActivityRestoreError(merged.left.message);
        return notes;
      }
      setActivityRestoreError(null);
      return { ...notes, activityLibrary: merged.right };
    });
  }, [workspace?.activityLibrary, notesLoaded, updateActivityNotes, setActivityRestoreError]);
  useEffect(() => {
    const client = supabaseAuthClient;
    if (!client) return;
    let active = true;
    const isActive = () => active;
    const loadSession = Effect.tryPromise({
      try: () => client.auth.getSession(),
      catch: () => ({ _tag: "SessionReadError" }) as const,
    });
    const updateSession = (
      session: {
        readonly user: { readonly id: string; readonly email?: string };
        readonly access_token: string;
      } | null,
    ) => {
      if (!isActive()) return;
      const decoded = Schema.decodeUnknownEither(Schema.UUID)(session?.user.id);
      const userId = Either.isRight(decoded) ? decoded.right.toLowerCase() : null;
      const token = userId ? (session?.access_token ?? null) : null;
      if (authSession.current.userId !== userId || authSession.current.token !== token) {
        authSession.current = { userId, token, generation: authSession.current.generation + 1 };
        syncConflictGeneration.current = null;
        syncConflictAuthGeneration.current = null;
        setSyncConflictWorkspace(null);
        setSyncOwnershipIssue(null);
      }
      setAccountUserId(userId);
      setAccountEmail(userId ? (session?.user.email ?? "Signed-in account") : null);
    };
    const initialGeneration = authSession.current.generation;
    void Effect.runPromise(Effect.either(loadSession)).then((result) => {
      if (
        isActive() &&
        Either.isRight(result) &&
        initialGeneration === authSession.current.generation
      )
        updateSession(result.right.data.session);
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      updateSession(session);
    });
    const handleUrl = (url: string | null) => {
      if (url) void Effect.runPromise(Effect.either(confirmNativeMagicLink(url)));
    };
    const initialUrl = Effect.tryPromise({
      try: () => Linking.getInitialURL(),
      catch: () => ({ _tag: "InitialLinkReadError" }) as const,
    });
    void Effect.runPromise(Effect.either(initialUrl)).then((result) => {
      if (Either.isRight(result)) handleUrl(result.right);
    });
    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleUrl(url);
    });
    return () => {
      active = false;
      subscription.remove();
      data.subscription.unsubscribe();
    };
  }, [
    authSession,
    setAccountEmail,
    setAccountUserId,
    setSyncConflictWorkspace,
    setSyncOwnershipIssue,
    syncConflictAuthGeneration,
    syncConflictGeneration,
  ]);
  useEffect(() => {
    let mounted = true;
    const isMounted = () => mounted;
    void Effect.runPromise(Effect.either(openSqliteWorkspaceStore())).then(async (opened) => {
      if (!isMounted()) return;
      if (Either.isLeft(opened)) {
        setWorkspace(createEmptyWorkspace());
        setMessage(
          "Couldn’t open this app’s local storage. Study changes won’t be saved if you continue.",
        );
        setReady(true);
        return;
      }

      const rawStore = opened.right;
      const openedMedia = await Effect.runPromise(Effect.either(openSqliteMediaStore()));
      if (!isMounted()) return;
      const rawMedia = Either.isRight(openedMedia) ? openedMedia.right : null;
      const mayWrite = (generation: number) =>
        mounted && !workspaceLifetime.isBlocked() && generation === workspaceLifetime.generation();
      function coordinateMutation<A, E>(operation: Effect.Effect<A, E>, onBlocked: () => E) {
        const generation = workspaceLifetime.generation();
        return localWriteLane.withPermits(1)(
          Effect.suspend(() => (mayWrite(generation) ? operation : Effect.fail(onBlocked()))),
        );
      }
      const localStore = rawMedia
        ? createGuardedWorkspaceStore(
            rawStore,
            rawMedia,
            localWriteLane.withPermits(1)(rawStore.clear),
            () => workspaceLifetime.generation(),
            mayWrite,
            coordinateMutation,
          )
        : ({
            read: rawStore.read,
            write: (serialized: string) =>
              coordinateMutation(
                rawStore.write(serialized),
                () => ({ _tag: "LocalStoreFailure", operation: "write" }) as const,
              ),
            clear: localWriteLane.withPermits(1)(rawStore.clear),
          } satisfies WorkspaceStore);
      if (rawMedia) {
        setMediaStore({
          ...rawMedia,
          put: (asset) =>
            coordinateMutation(
              rawMedia.put(asset),
              () => ({ _tag: "MediaStoreFailure", operation: "write" }) as const,
            ),
          delete: (id) =>
            coordinateMutation(
              rawMedia.delete(id),
              () => ({ _tag: "MediaStoreFailure", operation: "delete" }) as const,
            ),
        });
        // Cleanup bypasses the paused-write fence while holding the same lane as paired commits.
        clearLocalStores.current = localWriteLane.withPermits(1)(
          clearWorkspaceAndMedia(rawStore, rawMedia),
        );
      }
      const loaded = await Effect.runPromise(Effect.either(loadWorkspace(localStore)));
      if (!isMounted()) return;
      setStore(localStore);
      if (Either.isLeft(loaded)) {
        setWorkspace(createEmptyWorkspace());
        setMessage("Saved cards could not be read. Existing data was left untouched.");
        setReady(true);
        return;
      }

      if (loaded.right._tag === "Loaded") {
        setWorkspace(loaded.right.workspace);
        setCacheWritable(true);
      } else if (loaded.right._tag === "Empty") {
        const emptyWorkspace = createEmptyWorkspace();
        const saved = await Effect.runPromise(
          Effect.either(saveWorkspace(localStore, emptyWorkspace)),
        );
        setWorkspace(emptyWorkspace);
        setCacheWritable(Either.isRight(saved));
        if (Either.isLeft(saved))
          setMessage("Local storage is read-only. Changes won’t be saved after you leave.");
      } else {
        setWorkspace(createEmptyWorkspace());
        setMessage(
          "Saved cards use an invalid or newer format. The original data was left untouched.",
        );
      }
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, [
    localWriteLane,
    setWorkspace,
    workspaceLifetime,
    clearLocalStores,
    setCacheWritable,
    setMediaStore,
    setMessage,
    setReady,
    setStore,
  ]);
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [setNow]);
  useLayoutEffect(() => {
    if (cacheWritable) tutorLifetime.lifetime.resumeWrites();
    else tutorLifetime.lifetime.pauseWrites();
    return () => {
      tutorLifetime.lifetime.pauseWrites();
    };
  }, [tutorLifetime, cacheWritable]);
}
