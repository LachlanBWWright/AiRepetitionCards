import { useEffect } from "react";
import { readRef } from "@/lib/read-ref";
import { Effect, Either } from "effect";
import { emptyActivityLibrary } from "@recall/domain";
import { loadWorkspace, mergeActivityLibraries, saveWorkspace } from "@recall/application";
import { DashboardView } from "@/features/dashboard/navigation/dashboard-navigation";
import { type Workspace } from "@/features/workspace/types";
import { toast } from "@recall/ui-web";
import { startDailyReminderRuntime } from "@/lib/daily-reminder-api";
import { prepareWorkspaceForSync } from "@/features/workspace/sync-outbox";
import { browserWorkspaceStore } from "@/features/workspace/browser-workspace-store";
import {
  createFreshStarterWorkspace,
  starterWorkspace as starter,
} from "@/features/dashboard/layout/RecallDashboardSupport";
import type { RecallDashboardCore } from "./useRecallDashboardController";

export function useRecallDashboardWorkspaceEffects(
  model: Pick<
    RecallDashboardCore,
    | "workspace"
    | "notesLoaded"
    | "updateActivityNotes"
    | "setActivityRestoreError"
    | "cardEditorMounted"
    | "cardEditor"
    | "areaEditor"
    | "demo"
    | "setActiveView"
    | "setReady"
    | "setWorkspace"
    | "setSelectedIdState"
    | "setCacheWritable"
    | "setCacheBlocked"
    | "setImportNotice"
    | "setNow"
    | "ready"
    | "cacheWritable"
    | "enqueueWorkspaceSave"
    | "workspaceRef"
    | "pendingReviewRef"
    | "reviewingRef"
    | "erased"
    | "importNotice"
    | "cacheBlocked"
    | "stale"
    | "libraryNotes"
    | "addingCard"
    | "addingArea"
    | "retainOpenDraft"
    | "snapshotOpenLibraryDraft"
  >,
) {
  const {
    workspace,
    notesLoaded,
    updateActivityNotes,
    setActivityRestoreError,
    cardEditorMounted: cardEditorMountedRef,
    cardEditor: cardEditorRef,
    areaEditor: areaEditorRef,
    demo,
    setActiveView,
    setReady,
    setWorkspace,
    setSelectedIdState,
    setCacheWritable,
    setCacheBlocked,
    setImportNotice,
    setNow,
    ready,
    cacheWritable,
    enqueueWorkspaceSave,
    workspaceRef,
    pendingReviewRef,
    reviewingRef,
    erased,
    importNotice,
    cacheBlocked,
    stale,
    libraryNotes,
    addingCard,
    addingArea,
    retainOpenDraft,
    snapshotOpenLibraryDraft,
  } = model;
  useEffect(() => {
    const restored = workspace.activityLibrary;
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
  }, [workspace.activityLibrary, notesLoaded, updateActivityNotes, setActivityRestoreError]);
  useEffect(() => {
    cardEditorMountedRef.current = true;
    return () => {
      cardEditorMountedRef.current = false;
      readRef(cardEditorRef).generation += 1;
      readRef(areaEditorRef).generation += 1;
    };
  }, [cardEditorMountedRef, cardEditorRef, areaEditorRef]);
  useEffect(() => {
    if (demo) return;
    return startDailyReminderRuntime(() => {
      setActiveView(DashboardView.Today);
    });
  }, [demo, setActiveView]);
  useEffect(() => {
    if (demo) {
      const hydration = window.setTimeout(() => {
        setReady(true);
      }, 0);
      return () => {
        window.clearTimeout(hydration);
      };
    }
    let active = true;
    const isActive = () => active;
    void Effect.runPromise(Effect.either(loadWorkspace(browserWorkspaceStore))).then(
      async (loadResult) => {
        if (!isActive()) return;
        let loaded: Workspace = starter;
        let canWriteCache = true;
        let cacheProblem: string | null = null;
        if (!window.recallDesktop) {
          loaded = starter;
        } else if (Either.isLeft(loadResult)) {
          canWriteCache = false;
          cacheProblem = "Saved data could not be read. Your saved data has been left untouched.";
        } else if (loadResult.right._tag === "Loaded") {
          loaded = loadResult.right.workspace;
        } else if (loadResult.right._tag === "Invalid") {
          canWriteCache = false;
          cacheProblem =
            loadResult.right.reason === "unsupported-version"
              ? "Saved data uses a newer Recall format. It has been left untouched."
              : "Saved data could not be decoded and has been left untouched.";
        } else {
          const fresh = await Effect.runPromise(Effect.either(createFreshStarterWorkspace()));
          if (!isActive()) return;
          if (Either.isRight(fresh)) loaded = fresh.right;
          else {
            canWriteCache = false;
            cacheProblem = "A fresh workspace could not be created. Reload before saving changes.";
          }
        }
        setWorkspace(prepareWorkspaceForSync(loaded, () => crypto.randomUUID()));
        setSelectedIdState((selected) =>
          loaded.areas.some((item) => item.id === selected)
            ? selected
            : (loaded.areas[0]?.id ?? ""),
        );
        setCacheWritable(canWriteCache);
        setCacheBlocked(!canWriteCache);
        setImportNotice(cacheProblem);
        setReady(true);
      },
    );
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    demo,
    setWorkspace,
    setReady,
    setSelectedIdState,
    setCacheWritable,
    setCacheBlocked,
    setImportNotice,
    setNow,
  ]);
  useEffect(() => {
    if (ready && !demo && cacheWritable) {
      void enqueueWorkspaceSave(() =>
        workspaceRef.current === workspace && !pendingReviewRef.current && !reviewingRef.current
          ? Effect.runPromise(Effect.either(saveWorkspace(browserWorkspaceStore, workspace)))
          : Promise.resolve(Either.right(undefined)),
      ).then((result) => {
        if (Either.isLeft(result)) {
          if (pendingReviewRef.current || reviewingRef.current) return;
          setCacheWritable(false);
          setCacheBlocked(true);
          setImportNotice(
            "Workspace storage could not save changes. They will stay in this session.",
          );
        }
      });
    }
  }, [
    cacheWritable,
    demo,
    ready,
    workspace,
    enqueueWorkspaceSave,
    workspaceRef,
    pendingReviewRef,
    reviewingRef,
    setCacheWritable,
    setCacheBlocked,
    setImportNotice,
  ]);
  useEffect(() => {
    const id = "workspace-notice";
    const notice = erased
      ? "This tab is read-only while its working copy is being cleared. Retry if cleanup fails."
      : importNotice;
    if (!notice) return;
    const options = {
      id,
      closeButton: true,
      duration: cacheBlocked ? Infinity : 6000,
      ...(cacheBlocked && !stale && !erased
        ? {
            action: {
              label: "Reload",
              onClick: () => {
                window.location.reload();
              },
            },
          }
        : {}),
    };
    if (cacheBlocked) toast.error(notice, options);
    else toast(notice, options);
    return () => {
      toast.dismiss(id);
    };
  }, [importNotice, cacheBlocked, erased, stale]);
  useEffect(() => {
    if (!libraryNotes.loaded || (!addingCard && !addingArea)) return;
    const timer = window.setTimeout(retainOpenDraft, 350);
    return () => {
      window.clearTimeout(timer);
    };
  }, [retainOpenDraft, libraryNotes.loaded, addingCard, addingArea]);
  useEffect(() => {
    if (!addingCard && !addingArea) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (snapshotOpenLibraryDraft()) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [addingCard, addingArea, snapshotOpenLibraryDraft]);
}
