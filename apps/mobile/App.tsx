import { useEffect, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { Effect, Either } from "effect";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import { designTokens } from "@recall/design-tokens";
import {
  clearWorkspace,
  loadWorkspace,
  recordReview,
  saveWorkspace,
  verifyMediaAsset,
  persistMediaAssets,
} from "@recall/application";
import { newSchedule, type ReviewRating } from "@recall/scheduler";
import type { StudyCard, Workspace } from "@recall/domain";
import type { MediaStore, WorkspaceStore } from "@recall/local-store";
import {
  openSqliteMediaStore,
  openSqliteWorkspaceStore,
} from "./src/storage/sqlite-workspace-store";
import { supabaseAuthClient } from "./src/storage/supabase-auth";
import { syncNativeWorkspace } from "./src/storage/native-workspace-sync";
import {
  pickKnowledgeArea,
  pickWorkspaceBackup,
  shareKnowledgeArea,
  shareWorkspaceBackup,
} from "./src/storage/native-interchange";
import { NativeTodayScreen } from "./src/components/NativeTodayScreen";
import { NativeAccountPanel } from "./src/components/NativeAccountPanel";

const palette = designTokens.color;

function createStarterWorkspace(): Workspace {
  const areaId = Crypto.randomUUID();
  return {
    schemaVersion: 1,
    reviews: 0,
    reviewEvents: [],
    areas: [
      {
        id: areaId,
        title: "Cell biology",
        color: palette.green,
        objectives: [
          {
            id: Crypto.randomUUID(),
            title: "Cell structures",
            description: null,
            prerequisiteIds: [],
          },
          {
            id: Crypto.randomUUID(),
            title: "Gene expression",
            description: null,
            prerequisiteIds: [],
          },
        ],
        cards: [
          {
            id: Crypto.randomUUID(),
            front: "What is the main role of mitochondria?",
            back: "They produce most of the cell’s usable ATP through cellular respiration.",
            objective: "Cell structures",
            schedule: newSchedule(),
          },
          {
            id: Crypto.randomUUID(),
            front: "Where does transcription happen in a eukaryotic cell?",
            back: "In the nucleus, where DNA is used to make RNA.",
            objective: "Gene expression",
            schedule: newSchedule(),
          },
          {
            id: Crypto.randomUUID(),
            front: "What does the cell membrane regulate?",
            back: "The movement of substances into and out of the cell.",
            objective: "Cell structures",
            schedule: newSchedule(),
          },
        ],
      },
    ],
  };
}

function dueNow(card: StudyCard, now: number): boolean {
  return Date.parse(card.schedule.due) <= now;
}

export default function App() {
  const [store, setStore] = useState<WorkspaceStore | null>(null);
  const [mediaStore, setMediaStore] = useState<MediaStore | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [ready, setReady] = useState(false);
  const [cacheWritable, setCacheWritable] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [syncConflictWorkspace, setSyncConflictWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    let mounted = true;
    void Effect.runPromise(Effect.either(openSqliteWorkspaceStore())).then(async (opened) => {
      if (!mounted) return;
      if (Either.isLeft(opened)) {
        setWorkspace(createStarterWorkspace());
        setMessage("Local database is unavailable. Study changes will stay in this session.");
        setReady(true);
        return;
      }

      const localStore = opened.right;
      const openedMedia = await Effect.runPromise(Effect.either(openSqliteMediaStore()));
      if (mounted && Either.isRight(openedMedia)) setMediaStore(openedMedia.right);
      const loaded = await Effect.runPromise(Effect.either(loadWorkspace(localStore)));
      if (!mounted) return;
      setStore(localStore);
      if (Either.isLeft(loaded)) {
        setWorkspace(createStarterWorkspace());
        setMessage("Saved cards could not be read. Existing data was left untouched.");
        setReady(true);
        return;
      }

      if (loaded.right._tag === "Loaded") {
        setWorkspace(loaded.right.workspace);
        setCacheWritable(true);
      } else if (loaded.right._tag === "Empty") {
        const starter = createStarterWorkspace();
        const saved = await Effect.runPromise(Effect.either(saveWorkspace(localStore, starter)));
        setWorkspace(starter);
        setCacheWritable(Either.isRight(saved));
        if (Either.isLeft(saved))
          setMessage("Starter cards are temporary because the database is read-only.");
      } else {
        setWorkspace(createStarterWorkspace());
        setMessage(
          "Saved cards use an invalid or newer format. The original data was left untouched.",
        );
      }
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const activeArea =
    workspace?.areas.find((area) => area.id === activeAreaId) ?? workspace?.areas[0];
  const dueCards = useMemo(
    () => activeArea?.cards.filter((card) => dueNow(card, now)) ?? [],
    [activeArea, now],
  );
  const card = dueCards[0];
  const [mediaUris, setMediaUris] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    if (!mediaStore || !card?.media?.length) return;
    let active = true;
    const cacheAssets = Effect.forEach(card.media, (reference) =>
      Effect.gen(function* () {
        const asset = yield* mediaStore.get(reference.id);
        if (!asset || !verifyMediaAsset(asset)) return null;
        const extension: Record<typeof reference.mimeType, string> = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/gif": "gif",
          "image/webp": "webp",
          "audio/mpeg": "mp3",
          "audio/ogg": "ogg",
          "audio/wav": "wav",
        };
        const file = yield* Effect.try({
          try: () =>
            new File(Paths.cache, `recall-${reference.id}.${extension[reference.mimeType]}`),
          catch: () => ({ _tag: "MediaCacheFailure" }) as const,
        });
        yield* Effect.try({
          try: () => file.write(asset.bytes),
          catch: () => ({ _tag: "MediaCacheFailure" }) as const,
        });
        return { id: reference.id, uri: file.uri };
      }),
    );
    void Effect.runPromise(Effect.either(cacheAssets)).then((result) => {
      if (!active || Either.isLeft(result)) return;
      const nextUris = result.right.reduce<Record<string, string>>((uris, asset) => {
        if (asset) uris[asset.id] = asset.uri;
        return uris;
      }, {});
      setMediaUris(nextUris);
    });
    return () => {
      active = false;
    };
  }, [card?.id, card?.media, mediaStore]);

  async function review(rating: ReviewRating) {
    if (!workspace || !activeArea || !card) return;
    const transition = Effect.runSync(
      Effect.either(
        recordReview({
          workspace,
          areaId: activeArea.id,
          cardId: card.id,
          rating,
          eventId: Crypto.randomUUID(),
          ratedAt: new Date(now).toISOString(),
        }),
      ),
    );
    if (Either.isLeft(transition)) {
      setMessage("That review could not be recorded.");
      return;
    }
    if (store && cacheWritable) {
      const saved = await Effect.runPromise(
        Effect.either(saveWorkspace(store, transition.right.workspace)),
      );
      if (Either.isLeft(saved)) {
        setCacheWritable(false);
        setMessage("Database write failed. New reviews will remain in this session.");
      }
    }
    setWorkspace(transition.right.workspace);
    setShowAnswer(false);
    setNow(Date.now());
  }

  function resetLocalWorkspace() {
    if (!store) return;
    void Effect.runPromise(Effect.either(clearWorkspace(store))).then((result) => {
      if (Either.isLeft(result)) {
        setMessage("The saved workspace could not be cleared.");
        return;
      }
      const starter = createStarterWorkspace();
      void Effect.runPromise(Effect.either(saveWorkspace(store, starter))).then((saved) => {
        setWorkspace(starter);
        setActiveAreaId(starter.areas[0]?.id ?? null);
        setCacheWritable(Either.isRight(saved));
        setShowAnswer(false);
        setMessage(
          Either.isRight(saved) ? "Fresh sample cards are ready." : "Fresh cards are temporary.",
        );
      });
    });
  }

  async function syncCloudWorkspace(): Promise<string> {
    const authClient = supabaseAuthClient;
    if (!workspace || !authClient) return "Sign in and configure the Recall API before syncing.";
    const sessionResult = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => authClient.auth.getSession(),
          catch: () => ({ _tag: "SessionReadError" }) as const,
        }),
      ),
    );
    if (Either.isLeft(sessionResult)) return "Your sign-in session could not be read.";
    const token = sessionResult.right.data.session?.access_token;
    if (!token) return "Sign in again before syncing.";
    const synced = await Effect.runPromise(
      Effect.either(syncNativeWorkspace(workspace, token, () => Crypto.randomUUID())),
    );
    if (Either.isLeft(synced) || synced.right._tag === "Failed")
      return "Sync failed or a content conflict needs review. Your current offline data is unchanged.";
    if (synced.right._tag === "ContentConflict") {
      setSyncConflictWorkspace(synced.right.workspace);
      return "A server content change needs your review. Compare the area list below before loading it.";
    }
    setSyncConflictWorkspace(null);
    setWorkspace(synced.right.workspace);
    if (store && cacheWritable) {
      const saved = await Effect.runPromise(
        Effect.either(saveWorkspace(store, synced.right.workspace)),
      );
      if (Either.isLeft(saved)) {
        setCacheWritable(false);
        return "Cloud sync finished, but the updated copy could not be saved locally.";
      }
    }
    return "Your learning areas and reviews are synced.";
  }

  async function useServerWorkspace(): Promise<string> {
    if (!syncConflictWorkspace) return "There is no server version awaiting review.";
    setWorkspace(syncConflictWorkspace);
    setActiveAreaId(syncConflictWorkspace.areas[0]?.id ?? null);
    setSyncConflictWorkspace(null);
    if (store && cacheWritable) {
      const saved = await Effect.runPromise(
        Effect.either(saveWorkspace(store, syncConflictWorkspace)),
      );
      if (Either.isLeft(saved)) {
        setCacheWritable(false);
        return "Server content loaded for this session, but local storage failed.";
      }
    }
    return "Server content loaded. Your local review history was retained; sync again to upload it.";
  }

  async function importKnowledgeArea(): Promise<string> {
    if (!workspace) return "Your library is still loading.";
    if (!mediaStore) return "Local attachment storage is unavailable.";
    const areaColors = [palette.green, palette.coral, palette.violet, palette.amber];
    const color = areaColors[workspace.areas.length % areaColors.length] ?? palette.green;
    const imported = await Effect.runPromise(
      Effect.either(pickKnowledgeArea(color, () => Crypto.randomUUID(), mediaStore)),
    );
    if (Either.isLeft(imported))
      return "Import failed. Choose a valid Knowledge Area JSON or media ZIP file smaller than 25 MB.";
    if (!imported.right) return "Import canceled.";
    const next = { ...workspace, areas: [...workspace.areas, imported.right] };
    setWorkspace(next);
    setActiveAreaId(imported.right.id);
    if (store && cacheWritable) {
      const saved = await Effect.runPromise(Effect.either(saveWorkspace(store, next)));
      if (Either.isLeft(saved)) {
        setCacheWritable(false);
        return "Area imported for this session, but local storage failed.";
      }
    }
    return `${imported.right.title} imported. Its review history and schedule start fresh.`;
  }

  async function exportActiveArea(): Promise<string> {
    const area = workspace?.areas.find((item) => item.id === activeAreaId) ?? workspace?.areas[0];
    if (!area) return "There is no learning area to export.";
    if (!mediaStore) return "Local attachment storage is unavailable.";
    const result = await Effect.runPromise(Effect.either(shareKnowledgeArea(area, mediaStore)));
    return Either.isRight(result)
      ? `${area.title} is ready to share.`
      : "The learning area could not be exported.";
  }

  async function restorePrivateBackup(): Promise<string> {
    if (!store || !mediaStore) return "Local workspace or attachment storage is unavailable.";
    const selected = await Effect.runPromise(Effect.either(pickWorkspaceBackup()));
    if (Either.isLeft(selected)) return "The private backup is invalid or could not be read.";
    if (!selected.right) return "Restore canceled.";
    const accepted = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Replace this workspace?",
        "The backup will replace learning areas, review history, schedules, and local attachments on this device.",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Restore backup", style: "destructive", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (!accepted) return "Restore canceled.";

    const existingMedia = await Effect.runPromise(Effect.either(mediaStore.list));
    if (Either.isLeft(existingMedia)) return "Local attachments could not be checked.";
    const existingIds = new Set(existingMedia.right.map((reference) => reference.id));
    const persisted = await Effect.runPromise(
      Effect.either(persistMediaAssets(mediaStore, selected.right.media)),
    );
    if (Either.isLeft(persisted)) return "Backup attachments could not be saved.";
    const saved = await Effect.runPromise(
      Effect.either(saveWorkspace(store, selected.right.workspace)),
    );
    if (Either.isLeft(saved)) {
      const newlyAdded = selected.right.media.filter(
        (asset) => !existingIds.has(asset.reference.id),
      );
      await Effect.runPromise(
        Effect.forEach(
          newlyAdded,
          (asset) => mediaStore.delete(asset.reference.id).pipe(Effect.ignore),
          {
            concurrency: 1,
          },
        ),
      );
      return "The workspace could not be replaced. The previous workspace remains saved.";
    }
    setWorkspace(selected.right.workspace);
    setActiveAreaId(selected.right.workspace.areas[0]?.id ?? null);
    setMediaUris({});
    setShowAnswer(false);
    setCacheWritable(true);
    setMessage(null);
    return "Private backup restored, including review history, schedules, and attachments.";
  }

  async function exportPrivateBackup(): Promise<string> {
    if (!workspace || !mediaStore) return "Workspace or attachment storage is unavailable.";
    const result = await Effect.runPromise(
      Effect.either(shareWorkspaceBackup(workspace, mediaStore)),
    );
    return Either.isRight(result)
      ? "Private workspace backup is ready to share."
      : "The private workspace backup could not be exported.";
  }

  return (
    <View style={{ flex: 1 }}>
      <NativeTodayScreen
        ready={ready}
        workspace={workspace}
        activeAreaId={activeAreaId}
        now={now}
        message={message}
        mediaUris={mediaUris}
        showAnswer={showAnswer}
        canReset={store !== null}
        onSelectArea={setActiveAreaId}
        onHideAnswer={() => setShowAnswer(false)}
        onShowAnswer={() => setShowAnswer(true)}
        onReview={(rating) => void review(rating)}
        onReset={resetLocalWorkspace}
      />
      <NativeAccountPanel
        onSync={syncCloudWorkspace}
        conflictAreas={syncConflictWorkspace?.areas.map((area) => area.title) ?? null}
        onUseServerVersion={useServerWorkspace}
        onImport={importKnowledgeArea}
        onExport={exportActiveArea}
        onBackupRestore={restorePrivateBackup}
        onBackupExport={exportPrivateBackup}
      />
    </View>
  );
}
