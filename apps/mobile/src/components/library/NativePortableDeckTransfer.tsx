import { useEffect, useRef, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { Effect, Either, Schema } from "effect";
import { KnowledgeAreaSchema, type LearningArea, type Workspace } from "@recall/domain";
import type { MediaStore } from "@recall/local-store";
import {
  exportPortableDeckPackage,
  importPortableDeckPackage,
  toKnowledgeArea,
  type ImportedPortableDeckPackage,
} from "@recall/application";
import { NativeButton } from "@recall/ui-native";
import {
  pickPortableDeckPackage,
  sharePortableDeckPackage,
} from "../../storage/interchange/native-portable-deck-transfer";

export function NativePortableDeckTransfer({
  area,
  workspace,
  mediaStore,
  onImport,
  disabled = false,
}: {
  readonly area: LearningArea | null;
  readonly workspace: Workspace;
  readonly mediaStore: MediaStore;
  readonly onImport: (
    preview: ImportedPortableDeckPackage,
    restorePrivateHistory: boolean,
  ) => Promise<boolean>;
  readonly disabled?: boolean;
}) {
  const mounted = useRef(true);
  const [includePrivate, setIncludePrivate] = useState(false);
  const [restorePrivate, setRestorePrivate] = useState(false);
  const [preview, setPreview] = useState<{
    readonly filename: string;
    readonly value: ImportedPortableDeckPackage;
  } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const exportDeck = async () => {
    setBusy(true);
    setStatus("");
    if (!area) {
      setBusy(false);
      return;
    }
    const converted = Effect.runSync(Effect.either(toKnowledgeArea(area, true, true)));
    if (Either.isLeft(converted)) {
      setStatus("This deck cannot be packaged yet.");
      setBusy(false);
      return;
    }
    const content = {
      ...converted.right,
      ...(workspace.activityLibrary
        ? {
            activities: workspace.activityLibrary.activities.filter(
              (item) => item.areaId === area.id && !item.archived,
            ),
          }
        : {}),
    };
    const validated = Schema.decodeUnknownEither(KnowledgeAreaSchema)(content);
    if (Either.isLeft(validated)) {
      setStatus("This deck cannot be packaged yet.");
      setBusy(false);
      return;
    }
    const privateHistory = includePrivate
      ? {
          currentArea: area,
          reviewEvents: (workspace.reviewEvents ?? []).filter((event) => event.areaId === area.id),
          cardVersions: (workspace.cardVersions ?? []).filter(
            (version) => version.areaId === area.id,
          ),
          ...(workspace.activityLibrary ? { activityLibrary: workspace.activityLibrary } : {}),
        }
      : undefined;
    const packaged = await Effect.runPromise(
      Effect.either(exportPortableDeckPackage(validated.right, mediaStore, privateHistory)),
    );
    if (Either.isLeft(packaged)) {
      setStatus("Could not export this deck. Check that all media is available.");
      setBusy(false);
      return;
    }
    const slug =
      area.title
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase() || "deck";
    const shared = await Effect.runPromise(
      Effect.either(
        sharePortableDeckPackage(
          packaged.right,
          `${slug}${includePrivate ? ".private" : ""}.recall-deck.zip`,
        ),
      ),
    );
    if (mounted.current)
      setStatus(
        Either.isRight(shared)
          ? "Deck package is ready to save or share."
          : "Could not share the deck package.",
      );
    if (mounted.current) setBusy(false);
  };

  const chooseFile = async () => {
    setBusy(true);
    setPreview(null);
    setStatus("");
    const selected = await Effect.runPromise(Effect.either(pickPortableDeckPackage()));
    if (Either.isLeft(selected)) {
      if (mounted.current) setStatus("Could not read that deck package.");
    } else if (selected.right) {
      const imported = await Effect.runPromise(
        Effect.either(importPortableDeckPackage(selected.right.bytes)),
      );
      if (Either.isLeft(imported)) {
        if (mounted.current) setStatus("This file is not a valid Recall deck package.");
      } else if (mounted.current) {
        setPreview({ filename: selected.right.name, value: imported.right });
        setRestorePrivate(false);
      }
    }
    if (mounted.current) setBusy(false);
  };

  const approve = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const applied = await onImport(preview.value, restorePrivate);
      if (!mounted.current) return;
      if (applied) {
        setStatus(`Imported ${preview.value.knowledgeArea.title} as a personal copy.`);
        setPreview(null);
      }
    } catch {
      if (mounted.current)
        setStatus("Import could not be completed. Your current deck was left unchanged.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <View className="rounded-recall-card border border-recall-line bg-recall-surface p-4 gap-3">
      <Text className="text-recall-ink text-[16px] font-bold">Portable deck file</Text>
      <Text className="text-recall-muted text-[13px] leading-[20px]">
        Move one deck with its definitions and media. Private study data stays out unless you choose
        it.
      </Text>
      <View className="flex-row items-center gap-3">
        <Switch
          value={includePrivate}
          onValueChange={setIncludePrivate}
          disabled={busy || disabled || !area}
        />
        <Text className="flex-1 text-recall-ink text-[13px]">
          Include private history for current cards, saved schedules, attempts and drafts.
          Deleted-card history stays in a full workspace backup.
        </Text>
      </View>
      <NativeButton
        label={busy ? "Working…" : "Export deck ZIP"}
        onPress={() => void exportDeck()}
        disabled={busy || disabled || !area}
      />
      <NativeButton
        label="Choose deck ZIP"
        tone="soft"
        onPress={() => void chooseFile()}
        disabled={busy || disabled}
      />
      {preview ? (
        <View className="rounded-recall-card border border-recall-line p-3 gap-2">
          <Text className="text-recall-ink text-[14px] font-bold">
            Review import: {preview.filename}
          </Text>
          <Text className="text-recall-muted text-[13px]">
            {preview.value.knowledgeArea.title} · {preview.value.knowledgeArea.cards.length} cards ·{" "}
            {preview.value.knowledgeArea.objectives.length} objectives ·{" "}
            {(preview.value.knowledgeArea.activities ?? []).length} activities ·{" "}
            {preview.value.media.length} media files
          </Text>
          <Text className="text-recall-muted text-[13px]">
            {preview.value.privacy === "private"
              ? "Private single-deck copy"
              : "Public-safe content"}
            . Import creates a personal copy.
          </Text>
          {preview.value.privacy === "private" ? (
            <View className="flex-row items-center gap-3">
              <Switch
                value={restorePrivate}
                onValueChange={setRestorePrivate}
                disabled={busy || disabled}
              />
              <Text className="flex-1 text-recall-ink text-[13px]">
                Restore private history and saved schedules. Original IDs must be unused here.
              </Text>
            </View>
          ) : null}
          <NativeButton
            label={restorePrivate ? "Restore private copy" : "Import personal copy"}
            onPress={() => void approve()}
            disabled={busy || disabled}
          />
          <Pressable
            onPress={() => {
              setPreview(null);
            }}
            disabled={busy || disabled}
          >
            <Text className="text-recall-muted text-[13px]">Cancel</Text>
          </Pressable>
        </View>
      ) : null}
      {status ? (
        <Text accessibilityRole="alert" className="text-recall-muted text-[13px]">
          {status}
        </Text>
      ) : null}
    </View>
  );
}
