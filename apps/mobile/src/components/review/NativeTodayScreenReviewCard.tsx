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
      <Card className="rounded-[12px] bg-recall-surface border border-recall-line p-[23px] min-h-[260px] justify-between">
        <View className="flex-row justify-between items-center">
          <Text className="text-recall-muted text-[12px]">
            {showAnswer ? "Answer" : "Question"}
          </Text>
        </View>
        <Text className="text-recall-ink text-[23px] leading-[32px] font-medium my-[28px]">
          {showAnswer ? card.back : card.front}
        </Text>
        {card.media?.map((reference) => {
          const uri = mediaUris[reference.id];
          if (!uri) return null;
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
