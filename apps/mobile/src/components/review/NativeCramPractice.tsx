import * as Crypto from "expo-crypto";
import { adaptStudyCommandSave, useCramPractice } from "@recall/react";
import type { MediaStore } from "@recall/local-store";
import { useNativeCardMedia } from "../../hooks/use-native-card-media";
import { Text, View } from "react-native";
import type { LearningArea, Workspace } from "@recall/domain";
import { designTokens } from "@recall/design-tokens";
import { NativeTodayScreenReviewCard } from "./NativeTodayScreenReviewCard";
import { NativeButton } from "../ui/NativeButton";
import { NativeFilteredStudy } from "./NativeFilteredStudy";
import type { NativeStudyCommand } from "../../hooks/use-native-study-command";

export function NativeCramPractice({
  area,
  workspace,
  mediaStore,
  mediaRevision,
  onExit,
  save,
}: {
  readonly area: LearningArea;
  readonly workspace: Workspace;
  readonly mediaStore: MediaStore | null;
  readonly mediaRevision: number;
  readonly onExit: () => void;
  readonly save?: NativeStudyCommand | undefined;
}) {
  const { now, busy, message, mode, session, card, showAnswer, start, reveal, rate, restart } =
    useCramPractice(
      area,
      workspace,
      Date.now,
      save ? adaptStudyCommandSave(save) : undefined,
      Crypto.randomUUID,
    );
  const [mediaUris] = useNativeCardMedia(mediaStore, card, mediaRevision);
  const palette = designTokens.color;
  return (
    <View className="gap-3 py-4">
      <NativeFilteredStudy
        workspace={workspace}
        area={area}
        now={now}
        save={save}
        onStart={start}
      />
      <Text className="text-lg font-bold text-recall-ink">Extra practice · {area.title}</Text>
      <Text className="text-sm text-recall-muted">
        {mode === "reschedule"
          ? "Answers are recorded and original schedules updated."
          : "Preview leaves schedules and history unchanged."}{" "}
        Forgotten cards return at the end.
      </Text>
      {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      <Text accessibilityLiveRegion="polite">
        {session.answered} answers · {session.recalled} recalled · {session.remainingIds.length}{" "}
        remaining
      </Text>
      {card ? (
        <NativeTodayScreenReviewCard
          card={card}
          flagged={false}
          showAnswer={showAnswer}
          reviewPending={busy}
          mediaUris={mediaUris}
          reviewDelays={{}}
          ratingColors={{
            again: palette.coral,
            hard: palette.amber,
            good: palette.green,
            easy: palette.violet,
          }}
          onShowAnswer={reveal}
          onReview={rate}
        />
      ) : (
        <Text>Practice complete.</Text>
      )}
      <NativeButton tone="soft" label="Restart practice" onPress={restart} />
      <NativeButton label="Return to scheduled reviews" onPress={onExit} />
    </View>
  );
}
