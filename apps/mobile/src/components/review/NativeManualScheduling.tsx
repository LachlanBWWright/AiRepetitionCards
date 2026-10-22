import { useManualScheduling, adaptStudyCommandSave } from "@recall/react";
import { useState } from "react";
import { Text, View } from "react-native";
import { Effect, Either } from "effect";
import * as Crypto from "expo-crypto";
import type { LearningArea, Workspace } from "@recall/domain";
import { CARD_SEARCH_HELP } from "@recall/application";
import { NativeTextField } from "@recall/ui-native";
import { NativeButton } from "../ui/NativeButton";
import { type NativeStudyCommand } from "../../hooks/use-native-study-command";

export function NativeManualScheduling({
  workspace,
  area,
  now,
  save,
}: {
  readonly workspace: Workspace;
  readonly area: LearningArea;
  readonly now: number;
  readonly save?: NativeStudyCommand | undefined;
}) {
  const [confirmation, setConfirmation] = useState("");
  const {
    query,
    setQuery,
    due,
    setDue,
    position,
    setPosition,
    error,
    controls,
    matches: result,
    cards,
    apply,
  } = useManualScheduling({
    workspace,
    area,
    now,
    save: save ? adaptStudyCommandSave(save) : undefined,
    dueInput: "zoned",
    createId: () =>
      Effect.try({
        try: () => Crypto.randomUUID(),
        catch: () => ({ message: "A scheduling identifier could not be created. Retry." }),
      }),
  });
  return (
    <View className="gap-3 border-t border-recall-line py-4">
      <Text className="text-lg font-bold text-recall-ink">Manage scheduling · {area.title}</Text>
      <Text className="text-sm text-recall-muted">
        Administrative changes preserve answer history and are kept in private backups.
      </Text>
      <NativeTextField
        label="Find cards to change"
        value={query}
        maxLength={500}
        autoCapitalize="none"
        onChangeText={setQuery}
      />
      <Text className="text-sm text-recall-muted">{CARD_SEARCH_HELP}</Text>
      {Either.isLeft(result) ? (
        <Text accessibilityRole="alert">{result.left.message}</Text>
      ) : (
        <Text>
          {cards.length} cards affected:{" "}
          {cards
            .slice(0, 3)
            .map((card) => card.front.slice(0, 60))
            .join("; ")}
        </Text>
      )}
      <NativeTextField
        label="Due date and time with zone"
        value={due}
        autoCapitalize="none"
        placeholder="2026-10-20T09:00:00+11:00"
        onChangeText={setDue}
      />
      <NativeButton
        label={`Set due date for ${String(cards.length)} cards`}
        tone="soft"
        disabled={!save || controls.busy || !cards.length || !due}
        onPress={() => {
          apply("due");
        }}
      />
      <NativeTextField
        label="Starting new-card position"
        keyboardType="number-pad"
        value={position}
        onChangeText={setPosition}
      />
      <NativeButton
        label="Reposition matching new cards"
        tone="soft"
        disabled={
          !save || controls.busy || !cards.length || cards.some((card) => card.schedule.state !== 0)
        }
        onPress={() => {
          apply("reposition");
        }}
      />
      <Text>
        Resetting restarts memory estimates and learning progress. Type RESET to confirm resetting
        all matching cards; answer history stays intact.
      </Text>
      <NativeTextField
        label="Reset confirmation"
        value={confirmation}
        onChangeText={setConfirmation}
      />
      <NativeButton
        label={`Reset ${String(cards.length)} cards to new`}
        tone="soft"
        disabled={!save || controls.busy || !cards.length || confirmation !== "RESET"}
        onPress={() => {
          apply("reset");
          setConfirmation("");
        }}
      />
      {error || controls.message ? (
        <Text accessibilityLiveRegion="polite">{error || controls.message}</Text>
      ) : null}
    </View>
  );
}
