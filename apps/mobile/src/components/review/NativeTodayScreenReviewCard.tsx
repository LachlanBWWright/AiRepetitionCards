import { useNativeReviewerControls } from "./useNativeReviewerControls";
import { defaultReviewerSettings, type ReviewerSettings } from "@recall/domain";
import { occlusionAnswerLabel, occlusionSafeMediaUrls } from "@recall/application";
import { NativeImageOcclusionView } from "../occlusion/NativeImageOcclusionView";
import { NativeReviewSpeech } from "./NativeReviewSpeech";
import { NativeCardRichText } from "../authoring/rich/NativeCardRichText";
import { NativeTypedReviewAnswer } from "./NativeTypedReviewAnswer";
import type { Assessment } from "@recall/domain";
import type { ReviewRating } from "@recall/scheduler";
import { Image, Pressable, Text, View } from "react-native";
import { NativeAudioAttachment } from "../media/NativeAudioAttachment";
import { NativeButton } from "../ui/NativeButton";
import { Card } from "../../../components/ui/card";

const ratings = [
  ["again", "Again"],
  ["hard", "Hard"],
  ["good", "Good"],
  ["easy", "Easy"],
] as const satisfies readonly (readonly [ReviewRating, string])[];

export type NativeTodayScreenReviewCardProps = {
  readonly card: Assessment;
  readonly automationPaused?: boolean;
  readonly reviewerSettings?: ReviewerSettings | undefined;
  readonly flagged: boolean;
  readonly onFlag?: (id: string) => void;
  readonly showAnswer: boolean;
  readonly reviewPending: boolean;
  readonly mediaUris: Readonly<Record<string, string>>;
  readonly reviewDelays: Readonly<Partial<Record<ReviewRating, string>>>;
  readonly ratingColors: Readonly<Record<ReviewRating, string>>;
  readonly onReview: (rating: ReviewRating) => void;
  readonly onShowAnswer: () => void;
};

type RatingButtonsProps = Pick<
  NativeTodayScreenReviewCardProps,
  "reviewDelays" | "ratingColors" | "reviewPending" | "onReview"
>;

function RatingButtons({
  reviewDelays,
  ratingColors,
  reviewPending,
  onReview,
}: RatingButtonsProps) {
  return (
    <View className="flex-row flex-wrap gap-[8px]">
      {ratings.map(([rating, label]) => (
        <Pressable
          key={rating}
          accessibilityRole="button"
          disabled={reviewPending}
          accessibilityState={{ disabled: reviewPending, busy: reviewPending }}
          onPress={() => {
            onReview(rating);
          }}
          className="grow basis-[45%] items-center justify-center min-h-[47px] rounded-[14px]"
          style={[
            {
              backgroundColor: ratingColors[rating],
              opacity: reviewPending ? 0.5 : 1,
            },
          ]}
        >
          <Text className="text-recall-ink text-[15px] font-bold">{label}</Text>
          {reviewDelays[rating] && (
            <Text className="text-sm text-recall-ink">{reviewDelays[rating]}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

export function NativeTodayScreenReviewCard({
  card,
  reviewerSettings = defaultReviewerSettings,
  automationPaused = false,
  flagged,
  onFlag,
  showAnswer,
  reviewPending,
  mediaUris,
  reviewDelays,
  ratingColors,
  onReview,
  onShowAnswer,
}: NativeTodayScreenReviewCardProps) {
  const controls = useNativeReviewerControls({
    cardId: card.id,
    revealed: showAnswer,
    disabled: reviewPending || automationPaused,
    settings: reviewerSettings,
    onReveal: onShowAnswer,
    onRate: onReview,
  });
  return (
    <View>
      {onFlag && (
        <NativeButton
          label={flagged ? "Flagged for editing" : "Improve later"}
          tone="soft"
          disabled={reviewPending}
          onPress={() => {
            onFlag(card.id);
          }}
        />
      )}
      {(reviewerSettings.showTimer || controls.canAutoAdvance) && (
        <View className="flex-row items-center justify-end gap-3 pb-2">
          {reviewerSettings.showTimer && (
            <Text accessibilityLabel="Time on this side" className="text-sm text-recall-muted">
              {Math.floor(controls.elapsedSeconds / 60)}:
              {String(controls.elapsedSeconds % 60).padStart(2, "0")}
            </Text>
          )}
          {controls.canAutoAdvance && (
            <NativeButton
              label={controls.running ? "Stop auto-advance" : "Start auto-advance"}
              tone="soft"
              disabled={reviewPending}
              onPress={controls.toggle}
            />
          )}
        </View>
      )}
      <Card className="rounded-[12px] bg-recall-surface border border-recall-line p-[23px] min-h-[260px] justify-between">
        <View className="flex-row justify-between items-center">
          <Text className="text-recall-muted text-[12px]">
            {showAnswer ? "Answer" : "Question"}
          </Text>
        </View>
        <View {...controls.panHandlers}>
          <NativeCardRichText
            appearance={card.presentation?.appearance}
            text={showAnswer ? occlusionAnswerLabel(card.imageOcclusion, card.back) : card.front}
            mediaUrls={occlusionSafeMediaUrls(card.imageOcclusion, mediaUris)}
          />
        </View>
        <NativeReviewSpeech card={card} revealed={showAnswer} />
        <NativeTypedReviewAnswer
          key={card.id}
          card={card}
          revealed={showAnswer}
          disabled={reviewPending}
          onReveal={onShowAnswer}
        />
        {card.media?.map((reference) => {
          const uri = mediaUris[reference.id];
          if (!uri) return null;
          if (card.imageOcclusion?.imageMediaId === reference.id)
            return (
              <NativeImageOcclusionView
                key={reference.id}
                image={card.imageOcclusion}
                uri={uri}
                revealed={showAnswer}
              />
            );
          return reference.mimeType.startsWith("image/") ? (
            <Image
              key={reference.id}
              source={{ uri }}
              accessibilityLabel="Study card image attachment"
              alt="Study card image attachment"
              resizeMode="contain"
              className="w-full h-[220px] rounded-[14px] my-[18px] bg-recall-green"
            />
          ) : (
            <NativeAudioAttachment key={reference.id} uri={uri} />
          );
        })}
        {reviewPending && (
          <Text accessibilityLiveRegion="polite" className="text-recall-muted text-[13px]">
            Saving review…
          </Text>
        )}
        {showAnswer ? (
          <View className="gap-3">
            <Text className="text-sm text-recall-muted">
              Again: forgot · Hard: recalled with difficulty · Good: recalled · Easy: effortless
            </Text>
            <RatingButtons
              reviewDelays={reviewDelays}
              ratingColors={ratingColors}
              reviewPending={reviewPending}
              onReview={onReview}
            />
          </View>
        ) : (
          <NativeButton label="Show answer" disabled={reviewPending} onPress={onShowAnswer} />
        )}
      </Card>
    </View>
  );
}
