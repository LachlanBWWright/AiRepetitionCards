import { useState } from "react";
import { Text, View } from "react-native";
import { Effect, Either } from "effect";
import { exportAnkiApkg } from "@recall/application";
import type { LearningArea, ReviewEvent } from "@recall/domain";
import type { MediaStore } from "@recall/local-store";
import { NativeButton } from "@recall/ui-native";
import { writeAnkiSqliteInNative } from "../../storage/interchange/anki-sqlite-writer";
import { sharePortableDeckPackage } from "../../storage/interchange/native-portable-deck-transfer";

export function NativeAnkiExportAction({
  area,
  mediaStore,
  includeScheduling,
  reviewEvents,
  suspendedCardIds,
  disabled,
}: {
  readonly area: LearningArea | null;
  readonly mediaStore: MediaStore;
  readonly includeScheduling: boolean;
  readonly reviewEvents?: readonly ReviewEvent[];
  readonly suspendedCardIds?: readonly string[];
  readonly disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  async function run() {
    if (!area) return;
    setBusy(true);
    setStatus("");
    const result = await Effect.runPromise(
      Effect.either(
        exportAnkiApkg(area, mediaStore, writeAnkiSqliteInNative, {
          now: new Date(),
          includeScheduling,
          ...(reviewEvents ? { reviewEvents } : {}),
          ...(suspendedCardIds ? { suspendedCardIds } : {}),
        }).pipe(
          Effect.flatMap((bytes) =>
            sharePortableDeckPackage(bytes, `${area.title.replace(/[^a-z0-9]+/gi, "-")}.apkg`),
          ),
        ),
      ),
    );
    setStatus(
      Either.isRight(result)
        ? "Anki package is ready to share. Actual answer history is included when private history is selected."
        : "Could not prepare or share Anki package.",
    );
    setBusy(false);
  }
  return (
    <View className="gap-2">
      <NativeButton
        label={busy ? "Preparing Anki…" : "Export Anki .apkg"}
        tone="soft"
        disabled={busy || disabled || !area}
        onPress={() => void run()}
      />
      <Text className="text-recall-muted text-[12px]">
        Anki files include text templates and attachments. Actual answer history is included when
        private history is selected. Use Recall ZIP to retain rich formatting, image masks and
        answer/speech preferences.
      </Text>
      {status && <Text className="text-recall-muted text-[13px]">{status}</Text>}
    </View>
  );
}
